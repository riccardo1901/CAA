// M11-5 · La scheda «Pagina» (PIANO-M11.md 3.4, 3.9 flusso A, K2): le impostazioni di stampa nel pannello laterale,
// accanto al foglio; «Stampa…» dell'intestazione e Ctrl+P la aprono con il fuoco sul suo «Stampa…».
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { open } from "./fixtures";
import { apriCompleto } from "./schermi";

/* eslint-disable @typescript-eslint/no-explicit-any */

const STORIA = [
  "Marco mangia il pane. La mamma beve il latte. Il gatto dorme sul divano. Anna legge un libro. Il cane corre nel parco.",
  "Luca va a scuola con il suo amico. La maestra scrive alla lavagna. I bambini giocano in cortile.",
].join("\n");

const scheda = (page: Page) => page.locator(".page-panel");
const stampaIntestazione = (page: Page) => page.locator(".app-header").getByRole("button", { name: "Stampa…" });
const classi = (page: Page) => page.evaluate(() => [...document.documentElement.classList]);
const fermaStampa = (page: Page) =>
  page.evaluate(() => {
    (window as any).__stampe = 0;
    window.print = () => void ((window as any).__stampe += 1);
  });
const stampe = (page: Page) => page.evaluate(() => (window as any).__stampe as number);

/** Un PDF dalla pagina in resa di stampa (come le prove di stampa di M10 in motore.spec.ts). */
async function pdfOf(page: Page): Promise<string> {
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0);
  await page.emulateMedia({ media: "print" });
  const buf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: "screen" });
  const dir = mkdtempSync(join(tmpdir(), "caa-pagina-"));
  const file = join(dir, "p.pdf");
  writeFileSync(file, buf);
  return file;
}

/** Le pagine del PDF come immagini (byte dei pixel, in grigio, a bassa risoluzione). */
function immagini(file: string): Buffer[] {
  const dir = mkdtempSync(join(tmpdir(), "caa-pagina-img-"));
  execFileSync("pdftoppm", ["-r", "50", "-gray", file, join(dir, "p")]);
  return readdirSync(dir)
    .filter((n) => n.endsWith(".pgm"))
    .sort()
    .map((n) => readFileSync(join(dir, n)));
}
const testoPdf = (file: string): string => execFileSync("pdftotext", ["-layout", file, "-"]).toString();

test("Ctrl+P apre la scheda Pagina (anche a pannello chiuso) con il fuoco su «Stampa…»; un secondo Invio stampa", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 }); // il pannello parte chiuso
  await open(page, "Marco mangia pane");
  await fermaStampa(page);
  await expect(page.locator(".side-panel")).toHaveClass(/closed/);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("Control+p");
  await expect(scheda(page)).toBeVisible();
  await expect(page.locator("#scheda-pagina")).toHaveAttribute("aria-selected", "true");
  const stampa = scheda(page).getByRole("button", { name: "Stampa…" });
  await expect(stampa).toBeFocused();
  expect(await stampe(page)).toBe(0); // aprire la scheda non stampa
  await page.keyboard.press("Enter");
  await expect.poll(() => stampe(page)).toBe(1);
  // Niente finestra né velo: il resto del programma resta usabile.
  await expect(page.locator(".print-overlay, .print-dialog")).toHaveCount(0);
  expect(await page.locator("#app").getAttribute("inert")).toBeNull();
  // Esc: il pannello (sopra il foglio, su schermo stretto) si richiude e si torna al testo.
  await page.keyboard.press("Escape");
  await expect(page.locator(".side-panel")).toHaveClass(/closed/);
  await expect(page.locator(".ProseMirror")).toBeFocused();
});

test("«Stampa…» dell'intestazione apre la scheda Pagina; un clic su un simbolo torna alla scheda Simbolo", async ({ page }) => {
  await apriCompleto(page);
  await stampaIntestazione(page).click();
  await expect(scheda(page)).toBeVisible();
  await expect(scheda(page).getByRole("button", { name: "Stampa…" })).toBeFocused();
  // Le sezioni hanno un titolo.
  for (const t of ["Foglio", "Testo", "Contorni", "Piè di pagina"]) await expect(scheda(page).getByRole("region", { name: t })).toBeVisible();
  await page.locator(".w", { hasText: /^mamma$/ }).first().click({ position: { x: 20, y: 8 } });
  await expect(scheda(page)).toBeHidden();
  await expect(page.locator(".pm-cell").first()).toBeVisible();
});

test("ogni impostazione cambia subito il foglio, con la scheda aperta", async ({ page }) => {
  await open(page, "Marco mangia pane", true);
  await stampaIntestazione(page).click();
  const d = scheda(page);
  await d.getByLabel("Orientamento").selectOption("landscape");
  expect(await classi(page)).toContain("p-landscape");
  expect(Math.round(await page.locator(".sheet").evaluate((e) => e.getBoundingClientRect().width))).toBe(1123);
  await d.getByLabel("Margini (mm)").fill("25");
  await d.getByLabel("Margini (mm)").dispatchEvent("change");
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--p-margin"))).toBe("25mm");
  await d.getByLabel("Posizione del testo").selectOption("above");
  expect(await classi(page)).toContain("p-above");
  await d.getByLabel("Carattere").selectOption("lexend");
  expect(await classi(page)).toContain("pf-lexend");
  await d.getByLabel(/Tutto maiuscolo/).check();
  expect(await classi(page)).toContain("p-upper");
  await d.getByLabel("Una frase per riga").check();
  expect(await classi(page)).toContain("p-oneper");
  await d.getByLabel("Bordo attorno al solo simbolo").check();
  expect(await classi(page)).toContain("p-border");
  await d.getByLabel("Riquadro attorno a simbolo e parola").check();
  await expect(page.locator(".sheet")).toHaveClass(/cards/);
  // Le scelte vanno nel documento, come con la finestra di M10.
  await expect.poll(async () => (await page.evaluate(() => (window as any).__mock.saves.at(-1)))?.prefs?.print?.border).toBe(true);
  expect((await page.evaluate(() => (window as any).__mock.saves.at(-1))).prefs).toMatchObject({
    cards: true,
    print: { orientation: "landscape", margin: 25, textAbove: true, font: "lexend", uppercase: true, onePerLine: true, border: true },
  });
  // Spegnendo, il foglio torna come prima.
  await d.getByLabel("Orientamento").selectOption("portrait");
  await d.getByLabel("Bordo attorno al solo simbolo").uncheck();
  expect(await classi(page)).not.toContain("p-landscape");
  expect(await classi(page)).not.toContain("p-border");
});

test("cambiando l'orientamento il pannello resta aperto e il fuoco resta sulla scelta (anche se il foglio non ci sta più accanto)", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await open(page, "Marco mangia pane");
  await expect(page.locator(".side-panel")).toHaveClass(/open/);
  await expect(page.locator(".side-panel")).not.toHaveClass(/sopra/);
  await page.keyboard.press("Control+p");
  const orientamento = scheda(page).getByLabel("Orientamento");
  await orientamento.focus();
  await orientamento.selectOption("landscape");
  // L'A4 orizzontale non sta accanto al pannello: il pannello passa sopra il foglio, ma non si chiude.
  await expect(page.locator(".side-panel")).toHaveClass(/sopra/);
  await expect(scheda(page)).toBeVisible();
  await expect(orientamento).toBeFocused();
  await orientamento.selectOption("portrait");
  await expect(scheda(page)).toBeVisible();
  await expect(orientamento).toBeFocused();
});

test("con le stesse impostazioni il PDF è identico, che arrivino dalla scheda (aperta sopra il foglio) o dal documento", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  const prepara = async () => {
    await open(page, STORIA, true);
    await page.evaluate(() => (window as any).caaProto.setAuthor("Maria Rossi"));
    await page.getByLabel("Titolo del documento").fill("La storia");
  };
  // Dalla scheda, che resta aperta (sopra il foglio) mentre si stampa.
  await prepara();
  await stampaIntestazione(page).click();
  const d = scheda(page);
  await d.getByLabel("Orientamento").selectOption("landscape");
  await d.getByLabel("Margini (mm)").fill("20");
  await d.getByLabel("Margini (mm)").dispatchEvent("change");
  await d.getByLabel("Posizione del testo").selectOption("above");
  await d.getByLabel("Carattere").selectOption("atkinson");
  await d.getByLabel(/Tutto maiuscolo/).check();
  await d.getByLabel("Bordo attorno al solo simbolo").check();
  await d.getByLabel("Riquadro attorno a simbolo e parola").check();
  await d.getByLabel("il titolo").check();
  await d.getByLabel(/^il tuo nome/).check();
  await d.getByLabel("il numero di pagina").check();
  await expect(d).toBeVisible();
  await expect(page.locator(".side-panel")).toHaveClass(/sopra/);
  const regolaA = await page.locator("#caa-page").evaluate((e) => e.textContent);
  const a = await pdfOf(page);
  // Le stesse impostazioni messe direttamente nel documento (come fa la prova del foglio congelato), pannello chiuso.
  await prepara();
  await page.evaluate(() => {
    const p = (window as any).caaProto;
    p.setPrefs({ cards: true, print: { ...p.getPrefs().print, orientation: "landscape", margin: 20, textAbove: true, font: "atkinson", uppercase: true, border: true, footerTitle: true, footerAuthor: true, footerPage: true } });
  });
  await expect(page.locator(".side-panel")).toHaveClass(/closed/);
  const regolaB = await page.locator("#caa-page").evaluate((e) => e.textContent);
  const b = await pdfOf(page);
  expect(regolaA).toBe(regolaB);
  expect(regolaA).toContain("Maria Rossi");
  const ia = immagini(a);
  const ib = immagini(b);
  expect(ia.length).toBe(ib.length);
  for (let i = 0; i < ia.length; i++) expect(ia[i].equals(ib[i]), `pagina ${i + 1}`).toBe(true);
  // Nel PDF niente della scheda.
  const t = testoPdf(a);
  for (const ui of ["Stampa…", "Piè di pagina", "Riquadro attorno", "Orientamento"]) expect(t).not.toContain(ui);
  expect(t).toContain("La storia · Maria Rossi · pag. 1");
});

test("«Riquadro» e «Bordo» stanno nella scheda, con la figura; il riquadro non è più nella barra degli strumenti", async ({ page }) => {
  await apriCompleto(page);
  await expect(page.locator(".toolbar, #menu-altro").getByLabel(/Contorna|Riquadro/)).toHaveCount(0);
  await expect(page.locator(".tb-cards")).toHaveCount(0);
  await stampaIntestazione(page).click();
  const contorni = scheda(page).getByRole("region", { name: "Contorni" });
  const riquadro = contorni.getByLabel("Riquadro attorno a simbolo e parola");
  const bordo = contorni.getByLabel("Bordo attorno al solo simbolo");
  await expect(riquadro).toBeVisible();
  await expect(bordo).toBeVisible();
  // Una figura per ciascuna, accanto alla casella, fuori dal foglio.
  await expect(contorni.locator("svg.pg-fig-riquadro")).toBeVisible();
  await expect(contorni.locator("svg.pg-fig-bordo")).toBeVisible();
  await expect(page.locator(".sheet svg.pg-fig")).toHaveCount(0);
  // Il riquadro vale per il documento e il computer ricorda l'ultima scelta (come «Contorna» prima).
  await riquadro.check();
  await expect(page.locator(".sheet")).toHaveClass(/cards/);
  expect(await page.evaluate(() => localStorage.getItem("caa.cards"))).toBe("1");
  expect(await page.evaluate(() => (window as any).caaProto.getPrefs().cards)).toBe(true);
  await bordo.check();
  expect(await classi(page)).toContain("p-border");
  // Aprendo un documento con le sue preferenze la scheda si rimette in pari.
  await page.evaluate(() => (window as any).caaProto.setPrefs({ cards: false, print: { ...(window as any).caaProto.getPrefs().print, border: false } }));
  await expect(riquadro).not.toBeChecked();
  await expect(bordo).not.toBeChecked();
  await expect(page.locator(".sheet")).not.toHaveClass(/cards/);
});

test("K2: la casella del piè di pagina dice «il tuo nome» e mostra il nome vero; senza nome lo dice", async ({ page }) => {
  await apriCompleto(page); // nome da mostrare: «Maria Rossi»
  await stampaIntestazione(page).click();
  const nome = scheda(page).getByLabel(/^il tuo nome/);
  await expect(nome).toBeVisible();
  await expect(scheda(page).locator("label.pg-check", { hasText: /^il tuo nome/ })).toHaveText("il tuo nome («Maria Rossi»)");
  await expect(scheda(page)).not.toContainText("l'autore");
  // La stampa non cambia: con la casella accesa il nome va nel piè di pagina come prima.
  await nome.check();
  expect(await page.locator("#caa-page").evaluate((e) => e.textContent)).toContain('"Maria Rossi"');
  // Senza nome (nessun nome scritto) la casella lo dice.
  await page.evaluate(() => (window as any).caaProto.setAuthor(""));
  await expect(scheda(page).locator("label.pg-check", { hasText: /^il tuo nome/ })).toHaveText(/il tuo nome \(non è ancora scritto/);
});

test("il nome scritto al primo avvio arriva subito al piè di pagina (senza riavviare il programma)", async ({ page }) => {
  await apriCompleto(page, { configured: true, path: "G:/CAA", name: "", entries: [] }, "");
  const box = page.locator(".first-box");
  await box.getByLabel("Il tuo nome").fill("Anna Verdi");
  await box.getByRole("button", { name: "Continua" }).click();
  await expect(box).toHaveCount(0);
  await stampaIntestazione(page).click();
  await expect(scheda(page).locator("label.pg-check", { hasText: /^il tuo nome/ })).toHaveText("il tuo nome («Anna Verdi»)");
});

test("da tastiera si usa tutta la scheda: Tab passa per ogni impostazione nell'ordine dello schermo, Spazio la cambia", async ({ page }) => {
  await open(page, "Marco mangia pane");
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("Control+p");
  const nome = () =>
    page.evaluate(() => {
      const e = document.activeElement as HTMLElement;
      return (e.getAttribute("aria-label") || e.closest("label")?.textContent || e.textContent || "").trim();
    });
  // All'indietro dal pulsante «Stampa…» fino al primo controllo.
  const visti: string[] = [];
  for (let i = 0; i < 11; i++) {
    await page.keyboard.press("Shift+Tab");
    visti.unshift(await nome());
  }
  expect(visti).toEqual([
    "Orientamento",
    "Margini (mm)",
    "Posizione del testo",
    "Carattere",
    "Tutto maiuscolo (il testo scritto non cambia)",
    "Una frase per riga",
    "Riquadro attorno a simbolo e parola",
    "Bordo attorno al solo simbolo",
    "il titolo",
    "il tuo nome (non è ancora scritto: non si stampa niente)",
    "il numero di pagina",
  ]);
  // In avanti si torna su «Stampa…».
  for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
  expect(await nome()).toBe("il titolo");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
  expect(await nome()).toBe("Stampa…");
  // Le caselle con lo Spazio, le scelte con le frecce, i margini scrivendo.
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab"); // «Bordo attorno al solo simbolo»
  expect(await nome()).toBe("Bordo attorno al solo simbolo");
  await page.keyboard.press("Space");
  expect(await classi(page)).toContain("p-border");
  await scheda(page).getByLabel("Margini (mm)").focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("30");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--p-margin"))).toBe("30mm");
  // Esc torna dove si era prima di Ctrl+P.
  await page.keyboard.press("Escape");
  await expect(page.locator(".ProseMirror")).toBeFocused();
});
