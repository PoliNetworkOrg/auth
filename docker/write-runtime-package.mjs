// Writes a minimal package.json for the runtime image.
//
// Nitro traces and inlines the server's dependencies into .output/server, so
// the only packages that must exist in the runtime image's node_modules are
// the ones imported by the entry points that run outside the bundle:
// instrument.server.mjs and scripts/*.mjs. Versions are read from the
// installed node_modules (i.e. from pnpm-lock.yaml) so they cannot drift from
// the versions bundled into .output, which matters for Sentry in particular.
import { readFileSync, writeFileSync } from "node:fs";

const runtimePackages = ["@sentry/tanstackstart-react", "drizzle-orm", "pg", "zod"];

const dependencies = Object.fromEntries(
  runtimePackages.map((name) => {
    const { version } = JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8"));
    return [name, version];
  }),
);

writeFileSync(
  "runtime-package.json",
  `${JSON.stringify({ name: "auth-runtime", private: true, type: "module", dependencies }, null, 2)}\n`,
);
console.info("runtime dependencies:", dependencies);
