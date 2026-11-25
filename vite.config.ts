import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as { version: string };

// Il frontend sta in ui/; la build finisce in ui/dist (letta da Tauri).
export default defineConfig({
  root: "ui",
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 1420, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true, target: "es2021" },
});
