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

// ---- Difetti trovati dalla revisione indipendente di M11 (prima la prova, poi la correzione) ----

const testo = (page: import("@playwright/test").Page) => page.evaluate(() => (window as any).caaProto.view.state.doc.textContent as string);

test("revisione 1: con una finestra aperta le scorciatoie non cambiano il documento dietro (Ctrl+Z, Ctrl+1–4, F8, Ctrl+P, F1)", async ({ page }) => {
  await apriCompleto(page, undefined, "");
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Il gatto");
  const prima = await testo(page);
  const dim = await page.evaluate(() => (window as any).caaProto.getPrefs().size);
  await page.getByRole("button", { name: "Documenti" }).click();
  const docs = page.locator(".docs-panel");
  await expect(docs).toBeVisible();
  await page.keyboard.press("Tab");
  for (const k of ["Control+z", "Control+z", "Control+y", "Control+4", "F8", "Control+p", "F1"]) await page.keyboard.press(k);
  expect(await testo(page)).toBe(prima);
  expect(await page.evaluate(() => (window as any).caaProto.getPrefs().size)).toBe(dim);
  await expect(page.getByRole("dialog", { name: "Scorciatoie da tastiera" })).toHaveCount(0);
  await expect(docs).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(docs).toHaveCount(0);
  // Chiusa la finestra, le scorciatoie tornano a funzionare.
  await page.keyboard.press("Control+4");
  expect(await page.evaluate(() => (window as any).caaProto.getPrefs().size)).not.toBe(dim);
});

test("revisione 2: in Documenti › Biblioteca non collegata il Tab resta nella finestra (anche sul «Dettagli» chiuso)", async ({ page }) => {
  await apriCompleto(page, { configured: false, candidates: ["G:/Drive condivisi/CAA Istituto/CAA"] });
  await page.getByRole("button", { name: "Documenti" }).click();
  await page.locator(".docs-panel").getByRole("tab", { name: "Biblioteca" }).click();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest(".docs-panel"))).toBe(true);
  }
});

test("revisione 3: «Personalizzato» scelto dal menu «Altro» su schermo piccolo: Esc chiude la tabella e il fuoco torna su «Altro»", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await apriCompleto(page);
  const altro = page.getByRole("button", { name: "Altro", exact: true });
  await altro.click();
  const sel = page.locator("#menu-altro select[aria-label='Politica delle parole funzionali']");
  await expect(sel).toBeVisible();
  await sel.selectOption("custom");
  await expect(page.locator(".policy-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".policy-dialog")).toBeHidden();
  await expect(altro).toBeFocused();
});

test("revisione 4: chiedere due volte di chiudere con il salvataggio non riuscito apre una domanda sola", async ({ page }) => {
  await apriCompleto(page, undefined, "");
  await page.evaluate(() => {
    (window as any).__caaRetryMs = 60_000;
    delete (window as any).__caaConferma;
  });
  await page.locator(".ProseMirror").click();
  await page.evaluate(() => ((window as any).__mock.saveFail = 100));
  await page.keyboard.type("Testo che non si salva");
  await expect(page.locator(".save-status")).toContainText(/Non salvato|non ancora/, { timeout: 5000 });
  await page.evaluate(() => {
    const p = (window as any).caaProto;
    (window as any).__c1 = p.closeRequest();
    (window as any).__c2 = p.closeRequest();
  });
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  await page.getByRole("alertdialog").getByRole("button", { name: "Resta nel programma" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await page.evaluate(async () => [await (window as any).__c1, await (window as any).__c2])).toEqual([false, false]);
});

test("revisione 6: pannello sopra il foglio (schermo stretto): Esc sulle linguette lo chiude e torna al testo", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await apriCompleto(page);
  await page.locator(".w", { hasText: /^mamma$/ }).first().click({ position: { x: 20, y: 8 } });
  const tab = page.getByRole("tab", { name: "Pagina" });
  await tab.click();
  await tab.focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".side-panel")).toHaveClass(/closed/);
  await expect(page.locator(".ProseMirror")).toBeFocused();
});

test("revisione 6: se il pannello si chiude da solo (finestra più stretta) mentre ha il fuoco, il fuoco va sul suo pulsante", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await apriCompleto(page);
  const tab = page.getByRole("tab", { name: "Memoria" });
  await tab.click();
  await tab.focus();
  await page.setViewportSize({ width: 1024, height: 600 });
  await expect(page.locator(".side-panel")).toHaveClass(/closed/);
  await expect(page.getByRole("button", { name: "Apri il pannello laterale" })).toBeFocused();
});

test("revisione 9: «Pubblica…» spento (Drive non raggiungibile) si raggiunge con le frecce e dice perché", async ({ page }) => {
  const { documentiSalvati } = await import("./schermi");
  await apriCompleto(page, { configured: true, path: "G:/CAA", name: "Maria Rossi", entries: [], reachable: false, cached: [] });
  await documentiSalvati(page);
  await page.getByRole("button", { name: "Documenti" }).click();
  const piu = page.locator(".docs-panel .docs-row", { hasText: "La storia del gatto Pepe" }).getByRole("button", { name: /^Altre azioni/ });
  await piu.focus();
  await page.keyboard.press("Enter");
  const pubblica = page.getByRole("menuitem", { name: /^Pubblica/ });
  await expect(pubblica).toBeFocused();
  await expect(pubblica).toHaveAttribute("aria-disabled", "true");
  await expect(pubblica).toHaveAccessibleDescription(/Drive/);
  await page.keyboard.press("Enter"); // non fa niente
  await expect(page.getByRole("button", { name: /Indietro/ })).toHaveCount(0);
});
