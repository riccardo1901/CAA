// M11-9 · Rifinitura (PIANO-M11.md 3.8, 3.10): collegamento «Vai al testo», zone con nome per i lettori di schermo,
// testi in italiano semplice.
import { expect, test } from "@playwright/test";
import { apriCompleto } from "./schermi";

/* eslint-disable @typescript-eslint/no-explicit-any */

test("«Vai al testo» è il primo elemento con Tab: si vede quando ha il fuoco e Invio porta nel testo", async ({ page }) => {
  await apriCompleto(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Tab");
  const vai = page.getByRole("link", { name: "Vai al testo" });
  await expect(vai).toBeFocused();
  await expect(vai).toBeInViewport();
  const r = await vai.boundingBox();
  expect(r!.width).toBeGreaterThan(20);
  await page.keyboard.press("Enter");
  await expect(page.locator(".ProseMirror")).toBeFocused();
  // Senza fuoco non si vede (non occupa spazio e non copre niente).
  const box = await vai.evaluate((e) => e.getBoundingClientRect().width * e.getBoundingClientRect().height);
  expect(box).toBeLessThanOrEqual(1);
});

test("«Vai al testo» non entra nella stampa", async ({ page }) => {
  await apriCompleto(page);
  await page.emulateMedia({ media: "print" });
  expect(await page.locator(".skip-link").evaluate((e) => getComputedStyle(e).display)).toBe("none");
});

test("le zone del programma hanno un ruolo e un nome per i lettori di schermo", async ({ page }) => {
  await apriCompleto(page);
  await expect(page.getByRole("banner")).toHaveCount(1); // intestazione
  await expect(page.getByRole("toolbar", { name: "Strumenti" })).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1); // il foglio
  await expect(page.getByRole("complementary", { name: "Pannello laterale" })).toHaveCount(1);
  await expect(page.getByRole("contentinfo")).toHaveCount(1); // barra di stato
  await expect(page.getByRole("region", { name: "Avvisi del documento" })).toHaveCount(1);
});

test("3.10: nei testi non restano le parole vecchie", async ({ page }) => {
  await apriCompleto(page);
  const testo = await page.evaluate(() => document.body.innerText);
  for (const vecchio of ["Motore attivo", "Contorna simbolo e parola", "Clicca qui per chiudere", "Butta via", "○ Biblioteca"]) expect(testo).not.toContain(vecchio);
});
