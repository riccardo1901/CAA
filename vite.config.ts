import { defineConfig } from "vite";

// Il frontend sta in ui/; la build finisce in ui/dist (letta da Tauri).
export default defineConfig({
  root: "ui",
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true, target: "es2021" },
});
