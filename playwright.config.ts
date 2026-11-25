import { defineConfig } from "@playwright/test";

// Prove automatiche dell'editor (M3). Predefinito: solo la resa A (quella che passa in CI).
// `npm run test:e2e:confronto` esegue A e B per il confronto.
// La porta del server delle prove: CAA_PORTA permette di far girare più copie del progetto insieme (una porta
// ciascuna), senza che una prova veda il programma di un'altra copia.
const PORTA = Number(process.env.CAA_PORTA ?? 1421);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORTA}`,
    viewport: { width: 1280, height: 900 },
    trace: "off",
    permissions: ["clipboard-read", "clipboard-write"],
  },
  webServer: {
    command: `npx vite --port ${PORTA} --strictPort`,
    url: `http://localhost:${PORTA}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
