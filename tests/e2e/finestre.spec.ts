// M11-3 · Finestre, conferme e notifiche (PIANO-M11.md 3.3 e 3.4; difetti K5, K6, K7).
// Qui le conferme sono quelle vere: la risposta automatica delle altre prove (fixtures.ts) si toglie.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { open } from "./fixtures";
import { apriCompleto, documentiSalvati } from "./schermi";

/* eslint-disable @typescript-eslint/no-explicit-any */

const UI = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "ui", "src");
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const foto = { name: "foto.png", mimeType: "image/png", buffer: PNG_1X1 };

const conferme = (page: Page) =>
  page.evaluate(() => {
    delete (window as any).__caaConferma;
  });
const clicSimbolo = (page: Page, parola: string) => page.locator(".w", { hasText: new RegExp(`^${parola}$`) }).first().click({ position: { x: 20, y: 8 } });

/** Con Tab e Maiusc+Tab il fuoco non esce mai dalla finestra. */
async function tabRestaDentro(page: Page, box: Locator, giri = 25): Promise<void> {
  for (const tasto of ["Tab", "Shift+Tab"]) {
    for (let i = 0; i < giri; i++) {
      await page.keyboard.press(tasto);
      expect(await box.evaluate((b) => b.contains(document.activeElement)), `${tasto} n. ${i + 1}: il fuoco è uscito dalla finestra`).toBe(true);
    }
  }
}

/** Il fuoco è sul controllo con questo nome. */
const fuocoSu = (page: Page, nome: RegExp) =>
  expect.poll(() => page.evaluate(() => (document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent || "").trim())).toMatch(nome);

test.describe("finestre: Tab dentro, Esc chiude, il fuoco torna a chi le ha aperte", () => {
  test("Informazioni", async ({ page }) => {
    await apriCompleto(page);
    // «Informazioni» sta nel menu «Altro» (M11-4): tutto da tastiera.
    await page.getByRole("button", { name: "Altro", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Testo di esempio" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "Informazioni" })).toBeFocused();
    await page.keyboard.press("Enter");
    const box = page.locator(".about-dialog");
    await expect(box).toBeVisible();
    await expect(box).toHaveAttribute("aria-modal", "true");
    await tabRestaDentro(page, box);
    await page.keyboard.press("Escape");
    await expect(box).toHaveCount(0);
    await fuocoSu(page, /^Altro$/);
  });

  test("Stampa", async ({ page }) => {
    await apriCompleto(page);
    await page.getByRole("button", { name: "Stampa…" }).focus();
    await page.keyboard.press("Enter");
    const box = page.locator(".print-dialog");
    await expect(box).toBeVisible();
    await tabRestaDentro(page, box);
    await page.keyboard.press("Escape");
    await expect(box).toHaveCount(0);
    await fuocoSu(page, /^Stampa…$/);
  });

  test("Documenti (e mentre è aperta il resto della pagina non si raggiunge)", async ({ page }) => {
    await apriCompleto(page);
    await documentiSalvati(page);
    await page.getByRole("button", { name: "Documenti" }).focus();
    await page.keyboard.press("Enter");
    const box = page.locator(".docs-panel");
    await expect(box.locator(".docs-row").first()).toBeVisible();
    expect(await page.locator("#app").getAttribute("inert")).toBe("");
    await tabRestaDentro(page, box);
    await page.keyboard.press("Escape");
    await expect(box).toHaveCount(0);
    expect(await page.locator("#app").getAttribute("inert")).toBeNull();
    await fuocoSu(page, /^Documenti$/);
  });

  test("Documenti: aprendo un documento il cursore va nel testo", async ({ page }) => {
    await apriCompleto(page);
    await documentiSalvati(page);
    await page.getByRole("button", { name: "Documenti" }).click();
    await page.locator(".docs-row", { hasText: "In mensa" }).getByRole("button", { name: "Apri" }).click();
    await expect(page.locator(".docs-panel")).toHaveCount(0);
    await expect(page.locator(".ProseMirror")).toBeFocused();
  });

  test("ritaglio del simbolo personale (Esc annulla)", async ({ page }) => {
    await apriCompleto(page);
    await clicSimbolo(page, "mamma");
    await page.locator(".side input[type=file]").setInputFiles(foto);
    const box = page.locator(".crop-dialog");
    await expect(box).toBeVisible();
    await tabRestaDentro(page, box);
    await page.keyboard.press("Escape");
    await expect(box).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__mock.imports.length)).toBe(0);
  });

  test("primo avvio: Tab dentro, ma né Esc né un clic fuori la chiudono (il nome serve)", async ({ page }) => {
    await apriCompleto(page, { configured: true, path: "G:/CAA", name: "", entries: [] }, "");
    const box = page.locator(".first-box");
    await expect(box).toBeVisible();
    await expect(box.getByLabel("Il tuo nome")).toBeFocused();
    await box.getByLabel("Il tuo nome").fill("Maria Rossi");
    await tabRestaDentro(page, box, 6);
    await page.keyboard.press("Escape");
    await page.mouse.click(5, 5);
    await expect(box).toBeVisible();
    await box.getByRole("button", { name: "Continua" }).click();
    await expect(box).toHaveCount(0);
  });
});

test.describe("conferme del programma", () => {
  test("Elimina: domanda, verbo rosso, fuoco su Annulla, Esc = Annulla; poi Elimina", async ({ page }) => {
    await apriCompleto(page);
    await documentiSalvati(page);
    await conferme(page);
    await page.getByRole("button", { name: "Documenti" }).click();
    const riga = page.locator(".docs-row", { hasText: "In mensa" });
    await riga.getByRole("button", { name: "Elimina" }).click();
    const c = page.getByRole("alertdialog");
    await expect(c).toBeVisible();
    await expect(c.getByRole("heading")).toHaveText("Eliminare «In mensa»?");
    await expect(c).toContainText("Non si può annullare.");
    await expect(c.getByRole("button", { name: "Elimina" })).toHaveClass(/danger/);
    await expect(c.getByRole("button", { name: "Annulla" })).toBeFocused();
    await expect(c.getByRole("button", { name: /^OK$/ })).toHaveCount(0);
    await tabRestaDentro(page, c, 4);
    // Esc = Annulla: il documento resta, e Documenti è ancora aperta sotto.
    await page.keyboard.press("Escape");
    await expect(c).toHaveCount(0);
    await expect(page.locator(".docs-panel")).toBeVisible();
    await expect(riga).toBeVisible();
    // Ora sì.
    await riga.getByRole("button", { name: "Elimina" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Elimina" }).click();
    await expect(riga).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__mock.docsStore.has("Mensa.caa"))).toBe(false);
  });

  test("chiudere il programma con il salvataggio non riuscito: «Resta nel programma» o «Esci senza salvare»", async ({ page }) => {
    await open(page, "", true);
    await conferme(page);
    await page.evaluate(() => {
      (window as any).__caaRetryMs = 60_000;
    });
    await page.locator(".ProseMirror").click();
    await page.evaluate(() => {
      (window as any).__mock.saveFail = 100;
    });
    await page.keyboard.type("Testo che non si salva");
    await expect(page.locator(".save-status")).toContainText(/Non salvato|non ancora/, { timeout: 5000 });
    // «Resta nel programma»
    await page.evaluate(() => {
      (window as any).__chiusura = (window as any).caaProto.closeRequest();
    });
    const c = page.getByRole("alertdialog");
    await expect(c.getByRole("heading")).toHaveText("Il documento non si è salvato. Uscire comunque?");
    await c.getByRole("button", { name: "Resta nel programma" }).click();
    expect(await page.evaluate(() => (window as any).__chiusura)).toBe(false);
    // «Esci senza salvare»
    await page.evaluate(() => {
      (window as any).__chiusura = (window as any).caaProto.closeRequest();
    });
    await page.getByRole("alertdialog").getByRole("button", { name: "Esci senza salvare" }).click();
    expect(await page.evaluate(() => (window as any).__chiusura)).toBe(true);
  });

  test("nel codice dell'interfaccia non c'è più la conferma del sistema (window.confirm)", () => {
    const file = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? file(join(d, n)) : n.endsWith(".ts") ? [join(d, n)] : []));
    const trovati = file(UI).filter((f) => /\bwindow\.confirm\s*\(|(^|[^.\w])confirm\s*\(\s*["'`]/m.test(readFileSync(f, "utf8")));
    expect(trovati).toEqual([]);
  });
});

test.describe("notifiche", () => {
  test("un problema resta finché non si chiude; ha il ruolo «alert»", async ({ page }) => {
    await open(page, "pane, casa mare");
    await page.evaluate(() => {
      (window as any).__caaNotificaMs = 300;
      (window as any).caaProto.setCaret(1, 10);
    });
    await page.keyboard.press("Control+Shift+u");
    const t = page.locator(".toast", { hasText: "senza punteggiatura" });
    await expect(t).toBeVisible();
    await expect(t).toHaveAttribute("role", "alert");
    await expect(t).toHaveClass(/toast-avviso/);
    await page.waitForTimeout(1200);
    await expect(t).toBeVisible(); // le notifiche di problema non spariscono da sole
    await t.getByRole("button", { name: "Chiudi il messaggio" }).click();
    await expect(t).toHaveCount(0);
  });

  test("una riuscita sparisce da sola (ma non mentre ci si tiene sopra il mouse); ha il ruolo «status»", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__withSharedFlag = true;
      (window as any).__sharedInit = {};
    });
    await open(page, "Marco mangia pane");
    await page.evaluate(() => {
      (window as any).__caaNotificaMs = 800;
    });
    await clicSimbolo(page, "pane");
    await page.locator(".side input[type=file]").setInputFiles(foto);
    const box = page.locator(".crop-dialog");
    await box.getByRole("checkbox").check();
    await box.getByRole("button", { name: "Usa questo simbolo" }).click();
    const t = page.locator(".toast", { hasText: "Simbolo condiviso con la scuola" });
    await expect(t).toBeVisible();
    await expect(t).toHaveAttribute("role", "status");
    await expect(t).toHaveClass(/toast-ok/);
    await t.hover();
    await page.waitForTimeout(1200);
    await expect(t).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(t).toHaveCount(0, { timeout: 3000 });
  });

  test("un errore è un errore: resta e si legge bene (contrasto)", async ({ page }) => {
    await open(page, "Marco mangia pane");
    await clicSimbolo(page, "pane");
    await page.locator(".side input[type=file]").setInputFiles({ name: "rotto.png", mimeType: "image/png", buffer: Buffer.from("non sono un'immagine") });
    const t = page.locator(".toast", { hasText: "Non riesco a leggere questa immagine" });
    await expect(t).toHaveClass(/toast-errore/);
    await expect(t).toHaveAttribute("role", "alert");
  });
});
