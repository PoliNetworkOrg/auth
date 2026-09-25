import { defineConfig, lazyPlugins } from "vite-plus";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

const config = defineConfig({
  fmt: {
    ignorePatterns: [".agents/**", "src/routeTree.gen.ts"],
  },
  lint: {
    ignorePatterns: [".agents/**", "src/routeTree.gen.ts"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  resolve: { tsconfigPaths: true },
  // Better Auth carries the in-flight OpenID Connect request across the upstream
  // provider redirect in per-request state, keyed by module-private tokens that
  // `defineRequestState()` mints once per module evaluation. Left alone, the server
  // build inlines `better-auth` into the SSR bundle while giving each
  // `@better-auth/*` plugin its own chunk with a second copy inlined, so the plugin
  // writes the pending request under one key and Better Auth reads another. Nothing
  // fails loudly: sign-in succeeds, the authorization is silently dropped, and the
  // application that sent the user here never receives its code. Bundling them
  // together keeps one module instance, and one set of keys. Match by pattern so a
  // newly installed `@better-auth/*` plugin is covered without editing this list;
  // `scripts/check-server-bundle.mjs` fails the build if anything is duplicated anyway.
  ssr: {
    noExternal: [/^better-auth(\/|$)/, /^@better-auth\//],
  },
  plugins: lazyPlugins(() =>
    process.env.VITEST
      ? []
      : [
          devtools(),
          nitro({ rollupConfig: { external: [/^@sentry\//] } }),
          tailwindcss(),
          tanstackStart(),
          viteReact(),
          babel({ presets: [reactCompilerPreset()] }),
        ],
  ),
});

export default config;
