// M11-8 · Primo avvio, invito sul foglio vuoto, scorciatoie (F1), dimensione dell'interfaccia; difetti K16 e K18
// (PIANO-M11.md 3.5, 3.6, 3.7, 3.8, blocco M11-8).
import { expect, test, type Page } from "@playwright/test";
import { open } from "./fixtures";
import { BIBLIOTECA, apriCompleto } from "./schermi";

/* eslint-disable @typescript-eslint/no-explicit-any */

const invito = (page: Page) => page.locator(".invito");
const altro = (page: Page) => page.getByRole("button", { name: "Altro", exact: true });
const clicSimbolo = (page: Page, parola: string) => page.locator(".w", { hasText: new RegExp(`^${parola}$`) }).first().click({ position: { x: 20, y: 8 } });

test("docente nuovo: benvenuto, invito, si scrive, si corregge un simbolo, si stampa (senza altri passaggi)", async ({ page }) => {
  await apriCompleto(page, { ...BIBLIOTECA, name: "" }, "");
  // 1. Benvenuto: segno e nome del programma, una frase su cosa fa, il nome.
  const box = page.locator(".first-box");
  await expect(box).toBeVisible();
  await expect(box.locator(".brand-mark")).toBeVisible();
  await expect(box.getByRole("heading")).toContainText("Editor CAA");
  await expect(box).toContainText(/simbol/);
  await box.getByLabel("Il tuo nome").fill("Anna Verdi");
  await box.getByRole("button", { name: "Continua" }).click();
  await expect(box).toHaveCount(0);
  // 2. Foglio vuoto con l'invito, che sta sopra il foglio ma non dentro (non si stampa, non è nel documento).
  await expect(invito(page)).toBeVisible();
  await expect(invito(page)).toContainText("Scrivi qui il tuo testo");
  await expect(invito(page).locator("li")).toHaveCount(3);
  await expect(invito(page).getByRole("button", { name: "Prova con un testo di esempio" })).toBeVisible();
  expect(await page.locator(".sheet .invito").count()).toBe(0);
  // 3. Si scrive: l'invito sparisce alla prima lettera.
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Marco mangia il pane");
  await expect(invito(page)).toBeHidden();
  // 4. Clic sul simbolo, una scelta.
  await page.waitForSelector(".w[style*='--img']");
  await clicSimbolo(page, "mangia");
  await page.locator(".pm-cell").nth(1).click();
  // 5. Stampa: la scheda Pagina, pronta («Stampa…» con il fuoco).
  await page.locator(".app-header").getByRole("button", { name: /^Stampa/ }).click();
  await expect(page.getByRole("tab", { name: "Pagina" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".page-panel").getByRole("button", { name: /^Stampa/ })).toBeFocused();
});

test("l'invito torna con un documento vuoto, «Prova con un testo di esempio» lo toglie, e non si stampa", async ({ page }) => {
  await apriCompleto(page, BIBLIOTECA, "");
  await expect(invito(page)).toBeVisible();
  // Non si stampa e non entra nel documento.
  await page.emulateMedia({ media: "print" });
  await expect(invito(page)).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  expect(await page.evaluate(() => (window as any).caaProto.view.state.doc.textContent)).toBe("");
  await invito(page).getByRole("button", { name: "Prova con un testo di esempio" }).click();
  await expect(invito(page)).toBeHidden();
  await expect.poll(() => page.evaluate(() => ((window as any).caaProto.view.state.doc.textContent as string).length)).toBeGreaterThan(20);
  // Documento nuovo: torna.
  await page.getByRole("button", { name: "Nuovo" }).click();
  await expect(invito(page)).toBeVisible();
  // Con il testo l'invito non c'è.
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("C");
  await expect(invito(page)).toBeHidden();
});

test("F1 apre le scorciatoie (anche da «Altro»), divise per argomento e scritte come tasti; Esc chiude", async ({ page }) => {
  await apriCompleto(page);
  await page.keyboard.press("F1");
  const d = page.getByRole("dialog", { name: "Scorciatoie da tastiera" });
  await expect(d).toBeVisible();
  for (const g of ["Scrivere", "Correggere un simbolo", "Documento e stampa"]) await expect(d.getByRole("heading", { name: g })).toBeVisible();
  // Si apre dall'inizio: il titolo e il primo gruppo sono in vista, anche su un portatile.
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.keyboard.press("Escape");
  await page.keyboard.press("F1");
  await expect(d.getByRole("heading", { name: "Scorciatoie da tastiera" })).toBeInViewport();
  await expect(d.getByRole("heading", { name: "Scrivere" })).toBeInViewport();
  await expect(d.getByRole("button", { name: "Chiudi" })).toBeInViewport();
  await expect(d.locator("kbd", { hasText: "F8" })).toBeVisible();
  await expect(d.locator("kbd", { hasText: "Ctrl" }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(d).toHaveCount(0);
  // Da «Altro»: il fuoco torna su «Altro».
  await altro(page).click();
  await page.getByRole("menuitem", { name: "Scorciatoie da tastiera" }).click();
  await expect(d).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(altro(page)).toBeFocused();
});

test("dimensione dell'interfaccia: Grande e Molto grande ingrandiscono barre e pannelli, il foglio resta uguale; si ricorda", async ({ page }) => {
  await open(page, "Marco mangia pane");
  const misure = () =>
    page.evaluate(() => ({
      ui: parseFloat(getComputedStyle(document.body).fontSize),
      testo: getComputedStyle(document.querySelector(".ProseMirror")!).fontSize,
      foglio: (document.querySelector(".sheet") as HTMLElement).offsetWidth,
      barra: document.querySelector(".toolbar")!.getBoundingClientRect().height,
    }));
  const prima = await misure();
  expect(prima.ui).toBe(15);
  await altro(page).click();
  await page.getByRole("menuitemradio", { name: "Molto grande" }).click();
  const dopo = await misure();
  expect(dopo.ui).toBeCloseTo(19, 0);
  expect(dopo.barra).toBeGreaterThan(prima.barra);
  // Il foglio non cambia: testo a 20 px, A4 a 794 px.
  expect(dopo.testo).toBe("20px");
  expect(dopo.foglio).toBe(794);
  // Si ricorda sul computer.
  await page.reload();
  await page.waitForFunction(() => (window as any).caaProto);
  expect(parseFloat(await page.evaluate(() => getComputedStyle(document.body).fontSize))).toBeCloseTo(19, 0);
  await page.evaluate(() => localStorage.removeItem("caa.dimensioneInterfaccia"));
});

test("la scelta della dimensione è segnata nel menu (Normale, Grande, Molto grande)", async ({ page }) => {
  await open(page, "Marco");
  await altro(page).click();
  await expect(page.getByRole("menuitemradio", { name: "Normale" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemradio", { name: "Grande", exact: true }).click();
  await altro(page).click();
  await expect(page.getByRole("menuitemradio", { name: "Grande", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("menuitemradio", { name: "Normale" })).toHaveAttribute("aria-checked", "false");
  await page.getByRole("menuitemradio", { name: "Normale" }).click();
});

test("K16: il titolo mostra subito la prima riga (in grigio), prima del salvataggio", async ({ page }) => {
  await apriCompleto(page, BIBLIOTECA, "");
  await page.evaluate(() => {
    (window as any).__caaAutosaveMs = 60_000;
  });
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("La merenda di Luca");
  await expect(page.getByLabel("Titolo del documento")).toHaveAttribute("placeholder", "La merenda di Luca");
  await expect(page.getByLabel("Titolo del documento")).toHaveValue("");
});

test("K18: in «Informazioni» la voce Pittogrammi non ripete «Pittogrammi:»; l'attribuzione stampata non cambia", async ({ page }) => {
  await open(page, "Marco");
  await altro(page).click();
  await page.getByRole("menuitem", { name: "Informazioni" }).click();
  const dd = page.locator(".about-dialog dt", { hasText: /^Pittogrammi$/ }).locator("xpath=following-sibling::dd[1]");
  await expect(dd).toContainText("Sergio Palao per ARASAAC");
  await expect(dd).not.toContainText("Pittogrammi:");
  await page.keyboard.press("Escape");
  expect(await page.locator("#caa-page").evaluate((e) => e.textContent)).toContain("Pittogrammi: Sergio Palao per ARASAAC");
});
