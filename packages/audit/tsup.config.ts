import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  target: "es2022",
  platform: "node",
  dts: true,
  clean: true,
  splitting: false,
  external: ["playwright"],
  noExternal: ["@arb/browser-driver", "@arb/core", "@arb/schemas", "zod"]
});
