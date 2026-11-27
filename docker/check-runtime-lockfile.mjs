// Fails the image build if the runtime install resolved any package version that
// the reviewed pnpm-lock.yaml does not contain.
//
// The runtime stage installs from a smaller package.json (see
// write-runtime-package.mjs), so pnpm cannot install it with --frozen-lockfile.
// It is seeded with the reviewed lockfile instead, which makes pnpm keep the
// versions already locked there. This check makes sure it did: a release that
// was never reviewed in a pull request must not reach the production image.
//
// It compares `name@version` pairs, not the whole dependency graph: a package could in
// principle resolve to another version that the lockfile holds for a different dependent.
// pnpm still checks every installed package against the integrity hash locked for it.
//
// Usage: node check-runtime-lockfile.mjs <reviewed lockfile> <runtime lockfile>
import { readFileSync } from "node:fs";

/**
 * The `name@version` keys of a pnpm lockfile's `packages:` section. Throws on a key it cannot
 * read, such as a git or tarball dependency, rather than leaving that package unchecked.
 */
function lockedPackages(path) {
  const keys = new Set();
  let inPackages = false;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (/^\S/.test(line)) inPackages = line === "packages:";
    else if (inPackages && /^ {2}\S/.test(line)) {
      const key = /^ {2}'?([^\s':][^':]*@[^\s@':]+)'?:\s*$/.exec(line)?.[1];
      if (!key) throw new Error(`${path}: cannot read the package key ${JSON.stringify(line)}`);
      keys.add(key);
    }
  }
  return keys;
}

const [reviewedPath, runtimePath] = process.argv.slice(2);
if (!reviewedPath || !runtimePath) {
  console.error("usage: check-runtime-lockfile.mjs <reviewed lockfile> <runtime lockfile>");
  process.exit(2);
}
const reviewed = lockedPackages(reviewedPath);
const runtime = lockedPackages(runtimePath);
if (runtime.size === 0) {
  console.error(`No packages found in ${runtimePath}; refusing to vouch for an empty install.`);
  process.exit(1);
}
const unreviewed = [...runtime]
  .filter((key) => !reviewed.has(key))
  .sort((a, b) => a.localeCompare(b));
if (unreviewed.length > 0) {
  console.error(
    `The runtime install resolved ${unreviewed.length} package version(s) that pnpm-lock.yaml does not lock:\n` +
      unreviewed.map((key) => `  ${key}`).join("\n") +
      "\nRun `pnpm install` and commit the lockfile so these versions are reviewed first.",
  );
  process.exit(1);
}
console.info(
  `Runtime dependencies: all ${runtime.size} package versions come from pnpm-lock.yaml.`,
);
