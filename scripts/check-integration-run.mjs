// Fails CI when a PostgreSQL integration suite that CI is set up to run was skipped.
//
// The suites skip themselves when their database URL or configuration is missing, which is
// what lets `vp test` pass on a laptop. In CI that would turn a renamed variable into a
// silently green check, so every integration suite must run every test, except the ones
// listed below with the reason CI cannot run them. A new suite must run unless it is added
// here on purpose.
//
// Usage: node scripts/check-integration-run.mjs <vitest JSON report>
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

/** Suites CI does not run, and why. */
const NOT_RUN_IN_CI = {
  "src/auth/identity.integration.test.ts": "needs a running build of the server over HTTP",
  "src/auth/access-snapshot.integration.test.ts": "needs a running build of the server over HTTP",
  "src/auth/access-dispatcher.integration.test.ts": "needs the backend's events receiver",
};

const reportPath = process.argv[2];
if (!reportPath) {
  console.error("usage: check-integration-run.mjs <vitest JSON report>");
  process.exit(2);
}
const root = process.cwd();
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const results = new Map(
  report.testResults.map((file) => [relative(root, resolve(root, file.name)), file]),
);

const suites = readdirSync("src", { recursive: true, encoding: "utf8" })
  .map((path) => `src/${path}`)
  .filter((path) => /\.integration\.test\.[cm]?[jt]s$/.test(path))
  .sort();

const problems = [];
for (const suite of suites) {
  if (suite in NOT_RUN_IN_CI) continue;
  const result = results.get(suite);
  const tests = result?.assertionResults ?? [];
  const notRun = tests.filter((test) => test.status !== "passed" && test.status !== "failed");
  if (tests.length === 0) problems.push(`${suite}: no test ran`);
  else if (notRun.length > 0)
    problems.push(`${suite}: ${notRun.length} of ${tests.length} tests did not run`);
}
for (const suite of Object.keys(NOT_RUN_IN_CI))
  if (!suites.includes(suite)) problems.push(`${suite}: listed as not run in CI, but missing`);

if (problems.length > 0) {
  console.error(
    "Integration suites CI is expected to run were skipped. Check the job's database and\n" +
      "configuration variables, or list a suite in scripts/check-integration-run.mjs with the\n" +
      "reason CI cannot run it:\n" +
      problems.map((problem) => `  ${problem}`).join("\n"),
  );
  process.exit(1);
}
console.info(
  `All ${suites.length - Object.keys(NOT_RUN_IN_CI).length} integration suites CI runs ran every test.`,
);
