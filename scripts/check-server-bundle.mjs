import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * Better Auth keeps the in-flight OpenID Connect request in per-request state,
 * keyed by module-private tokens `defineRequestState()` mints once per module
 * evaluation. Two copies of a module in one bundle means two sets of keys: the
 * OAuth provider plugin stores the pending authorization under one, Better Auth
 * looks for it under the other, and the sign-in completes without ever resuming
 * the authorization. The user lands back on the sign-in page, signed in, while
 * the application that sent them there waits for a code that never arrives.
 *
 * Nothing about that failure is loud, so this guards the shape of the bundle
 * instead: the modules that own per-request state must each appear exactly once.
 * `vite.config.ts` keeps them in one chunk through `ssr.noExternal`.
 */
const stateModules = [
  { marker: "No request state found", module: "@better-auth/core request state" },
  { marker: "addOAuthServerContext", module: "better-auth OAuth request state" },
];

const serverDir = fileURLToPath(new URL("../.output/server", import.meta.url));

async function serverChunks(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return serverChunks(path);
      return entry.name.endsWith(".mjs") ? [path] : [];
    }),
  );
  return files.flat();
}

const chunks = await serverChunks(serverDir);
const sources = await Promise.all(
  chunks.map(async (path) => ({ path, code: await readFile(path, "utf8") })),
);

const problems = [];
for (const { marker, module } of stateModules) {
  const holders = sources.filter(({ code }) => code.includes(marker));
  if (holders.length === 0) {
    problems.push(
      `${module}: marker "${marker}" is gone from the build, so this check no longer guards anything. Update the marker.`,
    );
  } else if (holders.length > 1) {
    const where = holders.map(({ path }) => path.slice(serverDir.length + 1)).join(", ");
    problems.push(
      `${module}: bundled ${holders.length} times (${where}). Signing in through an` +
        " application would succeed without ever returning an authorization code." +
        " Keep every better-auth package in `ssr.noExternal` in vite.config.ts.",
    );
  }
}

if (problems.length) {
  console.error(`Server bundle check failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}

console.info("Server bundle check passed: per-request state is not duplicated.");
