import { describe, expect, it } from "vite-plus/test";

import { DEV_LOGIN_KIND } from "../src/dev/shared.ts";
import { DEV_LOGIN_MARKER, findBundleProblems, findDevLoginLeaks } from "./check-server-bundle.mjs";

const core = `function defineRequestState(initFn) {}
throw new Error("No request state found. Please make sure...");`;
const betterAuth = `var { get: getOAuthServerContext, set: setOAuthServerContext } = defineRequestState(() => null);`;
const oauthProvider = `var oAuthState = defineRequestState$1(() => null);`;

describe("server bundle check", () => {
  it("passes when every piece of request state is bundled once", () => {
    const sources = [{ path: "_ssr/router.mjs", code: `${core}\n${betterAuth}\n${oauthProvider}` }];

    expect(findBundleProblems(sources)).toEqual([]);
  });

  it("finds request state assignments in an inlined server bundle", () => {
    const inlined = `({get: getOAuthServerContext, set: setOAuthServerContext} = defineRequestState(() => null));\noAuthState = defineRequestState(() => null);`;
    expect(findBundleProblems([{ path: "index.mjs", code: `${core}\n${inlined}` }])).toEqual([]);
    expect(
      findBundleProblems([
        { path: "index.mjs", code: `${core}\n${inlined}` },
        { path: "other.mjs", code: betterAuth },
      ]),
    ).toEqual([
      "request state `{get: getOAuthServerContext, set: setOAuthServerContext}` is bundled 2 times (index.mjs, other.mjs).",
    ]);
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

  it("looks for the same marker the dev sign-in carries", () => {
    expect(DEV_LOGIN_MARKER).toBe(DEV_LOGIN_KIND);
  });

  it("fails when the dev sign-in reaches a production bundle", () => {
    const sources = [
      { path: "_ssr/router.mjs", code: core },
      {
        path: "assets/index.js",
        code: `fetch("/api/dev/login").then(r => r.kind === "${DEV_LOGIN_KIND}")`,
      },
    ];

    expect(findDevLoginLeaks(sources)).toEqual([
      "the development-only sign-in is bundled into assets/index.js. Import `src/dev/` only behind `import.meta.env.DEV`.",
    ]);
  });
});
