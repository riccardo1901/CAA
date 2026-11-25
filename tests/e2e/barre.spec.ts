// M11-4 · Nuova struttura delle barre e pannello laterale richiudibile (PIANO-M11.md 3.1, 3.2, blocco M11-4;
// difetti K3, K8, K9, K10, K11).
import { expect, test, type Page } from "@playwright/test";
import { apriCompleto, caratteriFissi, tuttiGliAvvisi } from "./schermi";

/* eslint-disable @typescript-eslint/no-explicit-any */

const clicSimbolo = (page: Page, parola: string) => page.locator(".w", { hasText: new RegExp(`^${parola}$`) }).first().click({ position: { x: 20, y: 8 } });
const altezza = (page: Page, sel: string) => page.locator(sel).evaluate((e) => e.getBoundingClientRect().height);
const pannello = (page: Page) => page.locator(".side-panel");
/** Il cursore dentro una parola del testo. */
const cursoreSu = (page: Page, parola: string) =>
  page.evaluate((w) => {
    const p = (window as any).caaProto;
    let at = -1;
    p.view.state.doc.descendants((n: any, pos: number) => {
      if (at < 0 && n.isText && n.text.includes(w)) at = pos + n.text.indexOf(w) + 1;
    });
    p.setCaret(at);
  }, parola);

for (const [w, h] of [[1280, 720], [1366, 768]] as const) {
  test(`${w}×${h}: barra degli strumenti su una riga, poche barre sopra e sotto il foglio`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await caratteriFissi(page);
    await apriCompleto(page);
    expect(await altezza(page, ".toolbar"), "barra degli strumenti").toBeLessThanOrEqual(48);
    const barre = (await altezza(page, ".app-header")) + (await altezza(page, ".toolbar")) + (await altezza(page, ".statusbar"));
    expect(barre, "intestazione + strumenti + stato").toBeLessThanOrEqual(124);
    // Con i due avvisi del documento (lessico nuovo, originale aggiornato).
    await tuttiGliAvvisi(page);
    const conAvvisi = barre + (await altezza(page, ".strip-zone"));
    expect(conAvvisi, "con due avvisi").toBeLessThanOrEqual(210);
  });
}

test("schermo stretto: il pannello parte chiuso e si apre da solo (clic sul simbolo, Alt+↓, F8), sopra il foglio", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await apriCompleto(page);
  await expect(pannello(page)).toHaveClass(/closed/);
  const foglio = await page.locator(".sheet").boundingBox();
  // Clic sul simbolo.
  await clicSimbolo(page, "mamma");
  await expect(pannello(page)).toHaveClass(/sopra/);
  await expect(page.locator(".pm-cell").first()).toBeVisible();
  // Il foglio non si è spostato sotto il pannello in larghezza: è il pannello che sta sopra (e la parola scelta si vede).
  expect((await page.locator(".sheet").boundingBox())!.width).toBe(foglio!.width);
  const parola = (await page.locator(".cur").boundingBox())!;
  const coperto = (await page.locator(".side-inner").boundingBox())!.x;
  expect(parola.x + parola.width, "la parola scelta non resta sotto il pannello").toBeLessThanOrEqual(coperto);
  // Esc torna al testo e richiude il pannello.
  await page.keyboard.press("Escape");
  await expect(pannello(page)).toHaveClass(/closed/);
  await expect(page.locator(".ProseMirror")).toBeFocused();
  // Alt+↓ sulla parola al cursore.
  await cursoreSu(page, "gatto");
  await page.keyboard.press("Alt+ArrowDown");
  await expect(pannello(page)).toHaveClass(/sopra/);
  await page.keyboard.press("Escape");
  await expect(pannello(page)).toHaveClass(/closed/);
  // F8: la prossima parola da controllare.
  await page.keyboard.press("F8");
  await expect(pannello(page)).toHaveClass(/sopra/);
  await expect(page.locator(".pm-titles strong")).toHaveText("dubbio");
});

test("il pulsante del pannello lo chiude e lo riapre; schermo largo: il foglio ha il posto accanto", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await apriCompleto(page);
  await expect(pannello(page)).toHaveClass(/open/);
  await expect(pannello(page)).not.toHaveClass(/sopra/);
  await page.getByRole("button", { name: "Chiudi il pannello dei simboli" }).click();
  await expect(pannello(page)).toHaveClass(/closed/);
  await expect(page.locator(".side")).toBeHidden();
  // Un clic sul simbolo lo riapre.
  await clicSimbolo(page, "mamma");
  await expect(pannello(page)).toHaveClass(/open/);
  await page.getByRole("button", { name: "Chiudi il pannello dei simboli" }).click();
  await page.getByRole("button", { name: "Apri il pannello dei simboli" }).click();
  await expect(pannello(page)).toHaveClass(/open/);
  await expect(page.locator(".side")).toBeVisible();
});

test("A4 orizzontale: il pannello si richiude da solo perché il foglio stia intero (1366×768)", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await apriCompleto(page);
  await expect(pannello(page)).toHaveClass(/open/);
  await page.evaluate(() => {
    const p = (window as any).caaProto;
    p.setPrefs({ print: { ...p.getPrefs().print, orientation: "landscape" } });
  });
  await expect(pannello(page)).toHaveClass(/closed/);
  const r = await page.evaluate(() => {
    const w = document.querySelector<HTMLElement>(".sheet-wrap")!;
    return { scroll: w.scrollWidth, client: w.clientWidth };
  });
  expect(r.scroll).toBeLessThanOrEqual(r.client);
});

test("Ctrl+Z e Ctrl+Y funzionano anche con il fuoco nella barra laterale (K3)", async ({ page }) => {
  await apriCompleto(page);
  await clicSimbolo(page, "mamma");
  await page.locator(".pm-all input").uncheck();
  const img = () => page.locator(".w", { hasText: /^mamma\.?$/ }).first().getAttribute("style");
  const prima = await img();
  await page.locator(".pm-cell").nth(1).click();
  await expect.poll(img).not.toBe(prima);
  const dopo = await img();
  // Il fuoco sulla barra laterale (non nel testo).
  await page.locator(".side").focus();
  await page.keyboard.press("Control+z");
  await expect.poll(img).not.toBe(dopo);
  await page.keyboard.press("Control+y");
  await expect.poll(img).toBe(dopo);
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(img).toBe(dopo);
  // Nel titolo del documento Ctrl+Z resta del campo (non annulla il testo).
  await page.getByLabel("Titolo del documento").fill("Prova");
  await page.getByLabel("Titolo del documento").press("Control+z");
  await expect.poll(img).toBe(dopo);
});

test("il contatore delle parole da controllare è un pulsante che si raggiunge con Tab (K8)", async ({ page }) => {
  await apriCompleto(page);
  const contatore = page.getByRole("button", { name: /parol[ae] da controllare/ });
  await expect(contatore).toBeVisible();
  await contatore.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".pm-titles strong")).toHaveText("dubbio");
});

test("la tabella «Personalizzato»: il fuoco entra, Esc e un clic fuori la chiudono (K10)", async ({ page }) => {
  await apriCompleto(page);
  await page.getByLabel("Politica delle parole funzionali").selectOption("custom");
  const t = page.locator(".policy-dialog");
  await expect(t).toBeVisible();
  await expect(t.getByLabel("Articoli")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(t).toBeHidden();
  await expect(page.getByRole("button", { name: "Modifica…" })).toBeFocused();
  await page.getByRole("button", { name: "Modifica…" }).click();
  await expect(t).toBeVisible();
  await page.mouse.click(300, 400); // sul foglio
  await expect(t).toBeHidden();
});

test("menu «Altro»: si usa da tastiera, Esc torna al pulsante; i comandi che non stanno nella barra ci sono e funzionano", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await caratteriFissi(page);
  await apriCompleto(page);
  const altro = page.getByRole("button", { name: "Altro", exact: true });
  await altro.focus();
  await page.keyboard.press("ArrowDown");
  await expect(altro).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("menuitem", { name: "Testo di esempio" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Informazioni" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(altro).toHaveAttribute("aria-expanded", "false");
  await expect(altro).toBeFocused();
  // A 1024 punti «Contorna simbolo e parola» non sta nella barra: è nel menu e funziona da lì.
  await expect(page.locator(".toolbar").getByLabel("Contorna simbolo e parola")).toHaveCount(0);
  await altro.click();
  const contorno = page.locator("#menu-altro").getByLabel("Contorna simbolo e parola");
  await expect(contorno).toBeVisible();
  await contorno.check();
  await expect(page.locator(".sheet")).toHaveClass(/cards/);
  await page.mouse.click(300, 400);
  await expect(page.locator("#menu-altro")).toBeHidden();
  // Allargando la finestra il gruppo torna nella barra.
  await page.setViewportSize({ width: 1700, height: 900 });
  await expect(page.locator(".toolbar").getByLabel("Contorna simbolo e parola")).toBeVisible();
});

test("scegliendo «Personalizzato» dal menu «Altro» il menu si chiude e la tabella resta in vista", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await apriCompleto(page);
  const politica = page.getByLabel("Politica delle parole funzionali");
  if (!(await politica.isVisible())) await page.getByRole("button", { name: "Altro", exact: true }).click();
  await politica.selectOption("custom");
  await expect(page.locator(".policy-dialog")).toBeVisible();
  await expect(page.locator("#menu-altro")).toBeHidden();
});
