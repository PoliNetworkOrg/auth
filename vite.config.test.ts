import { describe, expect, it } from "vite-plus/test";

import packageJson from "./package.json" with { type: "json" };
import config from "./vite.config";

const betterAuthPackages = Object.keys({
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
}).filter((name) => name === "better-auth" || name.startsWith("@better-auth/"));

function isBundled(id: string) {
  const noExternal = config.ssr?.noExternal;
  if (noExternal === true) return true;
  const rules = noExternal === undefined ? [] : [noExternal].flat();
  return rules.some((rule) => (typeof rule === "string" ? rule === id : rule.test(id)));
}

describe("server bundle", () => {
  // Nothing type checks or fails at runtime when Better Auth is duplicated across the
  // server bundle: the OAuth authorization request is simply lost while the browser is
  // away at the login provider, and the person lands on this app's home page instead of
  // the application that sent them. `scripts/check-server-bundle.mjs` catches that in the
  // build; this catches the setting that causes it without building.
  it("finds the Better Auth packages this app depends on", () => {
    expect(betterAuthPackages).toContain("better-auth");
  });

  it.each(betterAuthPackages)("bundles %s and its subpaths into the server graph", (name) => {
    expect(isBundled(name)).toBe(true);
    expect(isBundled(`${name}/client`)).toBe(true);
    expect([config.ssr?.external ?? []].flat()).not.toContain(name);
  });
});
