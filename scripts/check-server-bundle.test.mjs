import { describe, expect, it } from "vite-plus/test";

import { findBundleProblems } from "./check-server-bundle.mjs";

const core = `function defineRequestState(initFn) {}
throw new Error("No request state found. Please make sure...");`;
const betterAuth = `var { get: getOAuthServerContext, set: setOAuthServerContext } = defineRequestState(() => null);`;
const oauthProvider = `var oAuthState = defineRequestState$1(() => null);`;

describe("server bundle check", () => {
  it("passes when every piece of request state is bundled once", () => {
    const sources = [{ path: "_ssr/router.mjs", code: `${core}\n${betterAuth}\n${oauthProvider}` }];

    expect(findBundleProblems(sources)).toEqual([]);
  });

  it("fails when a module that defines request state is bundled twice", () => {
    const sources = [
      { path: "_ssr/router.mjs", code: `${core}\n${betterAuth}` },
      { path: "_libs/oauth-provider.mjs", code: `${betterAuth}\n${oauthProvider}` },
    ];

    expect(findBundleProblems(sources)).toEqual([
      "request state `{ get: getOAuthServerContext, set: setOAuthServerContext }` is bundled 2 times (_ssr/router.mjs, _libs/oauth-provider.mjs).",
    ]);
  });

  it("fails when the core request state module is bundled twice", () => {
    const sources = [
      { path: "_ssr/router.mjs", code: `${core}\n${betterAuth}` },
      { path: "_libs/core.mjs", code: core },
    ];

    expect(findBundleProblems(sources)).toEqual([
      "@better-auth/core request state is bundled 2 times (_ssr/router.mjs, _libs/core.mjs).",
    ]);
  });

  it("fails when it can no longer find what it guards", () => {
    expect(findBundleProblems([{ path: "_ssr/router.mjs", code: "" }])).toHaveLength(2);
  });
});
