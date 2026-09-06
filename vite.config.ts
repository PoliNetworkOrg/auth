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
