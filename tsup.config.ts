import { defineConfig } from "tsup"

export default defineConfig({
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    minify: true,
    treeshake: true,
    splitting: false,
    bundle: true,
    outDir: "dist",
    target: "es2022",
    platform: "neutral",
    esbuildOptions: (options) => {
        options.banner = {
            js: "// @ts-nocheck",
        }
    },
})
