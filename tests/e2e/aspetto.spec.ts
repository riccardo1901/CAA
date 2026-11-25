// M11 · Schermate dell'interfaccia per il confronto prima/dopo di ogni blocco. Non controlla niente: fotografa gli
// stati principali del programma su quattro schermi (piccolo, portatile, Full HD al 150%, grande) e salva le
// immagini in aspetto/<etichetta>/<schermo>/<stato>.png (fuori da git). Poi `node scripts/confronto-ui.mjs` mette
// due etichette una accanto all'altra in una pagina HTML.
//
//   CAA_ASPETTO=m10 npx playwright test aspetto      # le schermate «prima» (codice di partenza)
//   CAA_ASPETTO=m11-0 npx playwright test aspetto    # le schermate dopo il blocco M11-0
//   node scripts/confronto-ui.mjs m10 m11-0
//
// Senza CAA_ASPETTO le prove si saltano (non servono nella CI). Quando un blocco sposta un pulsante, si aggiorna qui
// il modo di arrivare allo stato; il nome dello stato resta, così il confronto continua a funzionare.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BIBLIOTECA, LIB_ENTRIES, SCHERMI_CONFRONTO, apriCompleto, attendi, documentiSalvati, tuttiGliAvvisi } from "./schermi";

/* eslint-disable @typescript-eslint/no-explicit-any */

const ETICHETTA = process.env.CAA_ASPETTO ?? "";
const RADICE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "aspetto");

const clicSimbolo = (page: Page, parola: string) => page.locator(".w", { hasText: new RegExp(`^${parola}$`) }).first().click({ position: { x: 20, y: 8 } });
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

/** Gli stati da fotografare: nome del file e come arrivarci. */
const STATI: Array<[string, (page: Page) => Promise<void>]> = [
  ["01-foglio", (page) => apriCompleto(page)],
  ["02-alternative", async (page) => {
    await apriCompleto(page);
    await clicSimbolo(page, "mamma");
    await page.locator(".pm-cell").first().waitFor();
  }],
  ["02b-ricerca", async (page) => {
    await apriCompleto(page);
    await clicSimbolo(page, "mamma");
    await page.locator(".pm-cell").first().waitFor();
    await page.locator(".pm-search").click();
    await page.keyboard.type("mare");
    await page.waitForTimeout(200);
  }],
  ["03-personalizzato", async (page) => {
    await apriCompleto(page);
    // Sugli schermi stretti la politica sta nel menu «Altro» (M11-4).
    const politica = page.getByLabel("Politica delle parole funzionali");
    if (!(await politica.isVisible())) await page.getByRole("button", { name: "Altro", exact: true }).click();
    await politica.selectOption("custom");
    await page.locator(".policy-dialog").waitFor();
  }],
  ["04-documenti", async (page) => {
    await apriCompleto(page);
    await documentiSalvati(page);
    await page.getByRole("button", { name: "Documenti" }).click();
    await page.locator(".docs-row").first().waitFor();
  }],
  ["04b-pubblica", async (page) => {
    await apriCompleto(page);
    await documentiSalvati(page);
    await page.getByRole("button", { name: "Documenti" }).click();
    await page.locator(".docs-panel .docs-row", { hasText: "La storia del gatto Pepe" }).getByRole("button", { name: "Pubblica" }).click();
    await page.locator(".pub-form").waitFor();
  }],
  ["05-biblioteca", async (page) => {
    await apriCompleto(page);
    await page.getByRole("button", { name: "Documenti" }).click();
    await page.locator(".docs-panel").getByRole("button", { name: "Biblioteca" }).click();
    await page.locator(".docs-panel .docs-row").first().waitFor();
  }],
  ["06-stampa", async (page) => {
    await apriCompleto(page);
    // Da M11-5 la scheda «Pagina» del pannello laterale (prima la finestra Stampa).
    await page.locator(".app-header").getByRole("button", { name: /^Stampa/ }).click();
    await page.locator(".page-panel").waitFor();
    await page.waitForTimeout(100);
  }],
  ["07-informazioni", async (page) => {
    await apriCompleto(page);
    await page.getByRole("button", { name: "Altro", exact: true }).click();
    await page.getByRole("menuitem", { name: "Informazioni" }).click();
    await page.locator(".about-dialog").waitFor();
  }],
  ["08-ritaglio", async (page) => {
    await apriCompleto(page);
    await clicSimbolo(page, "mamma");
    await page.locator(".side input[type=file]").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: PNG_1X1 });
    await page.locator(".crop-dialog").waitFor();
  }],
  ["09-messaggio", async (page) => {
    await apriCompleto(page);
    // «Unisci» con la virgola in mezzo: il programma spiega perché non si può.
    await page.evaluate(() => {
      // Posizioni del documento (non del testo semplice: titoli e paragrafi contano anche loro).
      const p = (window as any).caaProto;
      let da = -1;
      p.view.state.doc.descendants((n: any, pos: number) => {
        if (da < 0 && n.isText && n.text.includes("città, perché")) da = pos + n.text.indexOf("città, perché");
      });
      p.setCaret(da, da + "città, perché".length);
    });
    await page.keyboard.press("Control+Shift+u");
    await page.waitForTimeout(100);
  }],
  ["10-tutti-gli-avvisi", (page) => tuttiGliAvvisi(page)],
  ["11-primo-avvio", async (page) => {
    await apriCompleto(page, { ...BIBLIOTECA, name: "" }, "");
    await page.locator(".first-box").waitFor();
  }],
  ["12-documenti-vuoto", async (page) => {
    await apriCompleto(page, BIBLIOTECA, "");
    await page.getByRole("button", { name: "Documenti" }).click();
    await page.waitForTimeout(200);
  }],
  ["12b-biblioteca-da-collegare", async (page) => {
    await apriCompleto(page, { configured: false, name: "Maria Rossi", candidates: [{ path: "G:/Drive condivisi/CAA Istituto/CAA", drive: "CAA Istituto" }], entries: LIB_ENTRIES }, "");
    await page.getByRole("button", { name: "Documenti" }).click();
    await page.locator(".docs-panel").getByRole("button", { name: "Biblioteca" }).click();
    await page.waitForTimeout(200);
  }],
  ["13-simboli-scuola", async (page) => {
    await page.addInitScript(() => {
      (window as any).__withSharedFlag = true;
      (window as any).__sharedInit = { symbols: [
        { uuid: "s1", label: "autobus", author: "Luca", can_retire: false },
        { uuid: "s2", label: "palestra", author: "Maria", can_retire: true },
        { uuid: "s3", label: "mensa scolastica", author: "Anna", can_retire: false },
      ] };
      (window as any).__customInit = [{ id: 2147483648, uuid: "u-mela", label: "mela" }, { id: 2147483649, uuid: "u-pane", label: "pane" }];
    });
    await apriCompleto(page);
    await clicSimbolo(page, "mamma");
    await page.getByRole("button", { name: "Simboli della scuola…" }).click();
    await page.locator(".pm-school .pm-mini-cell").first().waitFor();
  }],
  ["14-orizzontale-grande", async (page) => {
    await apriCompleto(page);
    await page.evaluate(() => {
      const p = (window as any).caaProto;
      p.setPrefs({ size: 151, print: { ...p.getPrefs().print, orientation: "landscape" } });
    });
    await attendi(page);
  }],
  ["15-conferma", async (page) => {
    await apriCompleto(page);
    await documentiSalvati(page);
    await page.evaluate(() => {
      delete (window as any).__caaConferma; // la finestra vera
    });
    await page.getByRole("button", { name: "Documenti" }).click();
    await page.locator(".docs-row", { hasText: "In mensa" }).getByRole("button", { name: "Elimina" }).click();
    await page.getByRole("alertdialog").waitFor();
  }],
  ["16-notifica-errore", async (page) => {
    await apriCompleto(page);
    await clicSimbolo(page, "mamma");
    await page.locator(".side input[type=file]").setInputFiles({ name: "rotto.png", mimeType: "image/png", buffer: Buffer.from("non sono un'immagine") });
    await page.locator(".toast").waitFor();
  }],
  ["17-menu-altro", async (page) => {
    await apriCompleto(page);
    await page.getByRole("button", { name: "Altro", exact: true }).click();
    await page.locator("#menu-altro").waitFor();
  }],
  // M11-7: la scheda «Memoria» con qualche scelta ricordata (una della politica) e i miei simboli.
  ["18-memoria", async (page) => {
    await page.addInitScript(() => {
      (window as any).__memInit = [{ lemma: "pane", cat: "NOUN", form: "", picto: 1003 }, { lemma: "il", cat: "ART", form: "", picto: 1004 }, { lemma: "", cat: "", form: "Pepe", picto: 1005 }];
      (window as any).__customInit = [{ id: 2147483648, uuid: "u-mela", label: "mela" }, { id: 2147483649, uuid: "u-pane", label: "pane" }];
    });
    await apriCompleto(page);
    // Sugli schermi stretti il pannello è chiuso: la linguetta compare aprendolo.
    const linguetta = page.getByRole("tab", { name: "Memoria" });
    if (!(await linguetta.isVisible())) await page.getByRole("button", { name: "Apri il pannello dei simboli" }).click();
    await linguetta.click();
    await page.locator(".side-memory li").first().waitFor();
  }],
  // M11-7: la scheda «Simbolo» di un articolo: «ricorda per sempre» spento con la nota (K4).
  ["19-simbolo-articolo", async (page) => {
    await apriCompleto(page);
    await clicSimbolo(page, "il");
    await page.locator(".pm-cell").first().waitFor();
  }],
];

for (const s of SCHERMI_CONFRONTO) {
  test.describe(`aspetto · ${s.nome}`, () => {
    // Ora e fuso fissi: «Salvato alle 10:30» deve essere uguale in tutte le schermate, prima e dopo.
    test.use({ viewport: s.css, deviceScaleFactor: s.scala, timezoneId: "Europe/Rome", locale: "it-IT" });
    for (const [nome, prepara] of STATI) {
      test(nome, async ({ page }) => {
        test.skip(!ETICHETTA, "solo con CAA_ASPETTO=<etichetta>");
        await page.clock.setFixedTime(new Date("2026-11-24T10:30:00+01:00"));
        await prepara(page);
        await page.mouse.move(0, 0);
        // La foto si fa a salvataggio automatico finito, altrimenti l'indicatore in alto cambia da un giro all'altro.
        await expect(page.locator(".save-status")).not.toHaveText(/non ancora|Salvataggio|Salvo/, { timeout: 5000 });
        await page.waitForTimeout(400);
        const dir = join(RADICE, ETICHETTA, `${s.larghezza}x${s.altezza}-${Math.round(s.scala * 100)}`);
        mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: join(dir, `${nome}.png`), animations: "disabled", caret: "hide" });
      });
    }
  });
}
