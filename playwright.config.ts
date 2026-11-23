import { defineConfig } from "@playwright/test";

// Prove automatiche dell'editor (M3). Predefinito: solo la resa A (quella che passa in CI).
// `npm run test:e2e:confronto` esegue A e B per il confronto.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:1421",
    viewport: { width: 1280, height: 900 },
    trace: "off",
    permissions: ["clipboard-read", "clipboard-write"],
  },
  webServer: {
    command: "npx vite --port 1421 --strictPort",
    url: "http://localhost:1421",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
