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
 * instead: every `defineRequestState()` call must appear exactly once, and so
 * must the core module that owns the request state. Checking every call, rather
 * than a fixed list, also covers state added by future Better Auth releases.
 * `vite.config.ts` keeps them in one chunk through `ssr.noExternal`.
 */
const stateCall = /\b(?:var|let|const)\s+([^=;]+?)\s*=\s*defineRequestState(?:\$\d+)?\(/g;
const coreMarker = "No request state found";

/** @param {{ path: string, code: string }[]} sources */
export function findBundleProblems(sources) {
  const calls = new Map();
  for (const { path, code } of sources) {
    for (const [, binding] of code.matchAll(stateCall)) {
      const name = binding.replace(/\s+/g, " ").trim();
      calls.set(name, [...(calls.get(name) ?? []), path]);
    }
  }

  const problems = [];
  if (calls.size === 0) {
    problems.push(
      "no `defineRequestState()` call found in the build, so this check no longer guards anything. Update it.",
    );
  }
  for (const [name, paths] of calls) {
    if (paths.length > 1) {
      problems.push(
        `request state \`${name}\` is bundled ${paths.length} times (${paths.join(", ")}).`,
      );
    }
  }

  const coreHolders = sources.filter(({ code }) => code.includes(coreMarker));
  if (coreHolders.length === 0) {
    problems.push(
      `marker "${coreMarker}" is gone from the build, so this check no longer guards anything. Update the marker.`,
    );
  } else if (coreHolders.length > 1) {
    const where = coreHolders.map(({ path }) => path).join(", ");
    problems.push(
      `@better-auth/core request state is bundled ${coreHolders.length} times (${where}).`,
    );
  }
  return problems;
}

async function serverChunks(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return serverChunks(path);
      return /\.[cm]?js$/.test(entry.name) ? [path] : [];
    }),
  );
  return files.flat();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const serverDir = fileURLToPath(new URL("../.output/server", import.meta.url));
  const chunks = await serverChunks(serverDir);
  const sources = await Promise.all(
    chunks.map(async (path) => ({
      path: path.slice(serverDir.length + 1),
      code: await readFile(path, "utf8"),
    })),
  );

  const problems = findBundleProblems(sources);
  if (problems.length) {
    console.error(
      `Server bundle check failed:\n- ${problems.join("\n- ")}\n` +
        "Signing in through an application would succeed without ever returning an" +
        " authorization code. Keep every better-auth package in `ssr.noExternal` in vite.config.ts.",
    );
    process.exit(1);
  }

  console.info("Server bundle check passed: per-request state is not duplicated.");
}
