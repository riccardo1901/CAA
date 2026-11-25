// M11 · Prova a matrice degli schermi (PIANO-M11.md, sezione 0, punto 7). Il programma deve funzionare su tutti
// i computer della scuola: dal portatile piccolo al monitor 4K, con il «ridimensionamento» di Windows dal 100% al
// 200%. Per ognuno dei 19 schermi di SCHERMI si controlla:
//
//   scorrimento     nessuna barra di scorrimento orizzontale nell'interfaccia
//   foglio-verticale    A4 verticale intero nella larghezza disponibile
//   foglio-orizzontale  A4 orizzontale intero nella larghezza disponibile
//   una-riga        la barra degli strumenti sta su una riga
//   niente-a-capo   nessun pulsante o etichetta delle barre va a capo o ha il testo tagliato
//   niente-coperto  nessun controllo delle barre è fuori dallo schermo o coperto da un altro
//   azioni          tutte le azioni principali si raggiungono (anche dal menu «Altro», quando ci sarà)
//   avvisi          con tutti gli avvisi del documento accesi, le barre di avviso non superano un quarto dell'altezza
//
// Molti controlli oggi falliscono: è proprio quello che M11 deve sistemare. Questi fallimenti sono scritti in
// ATTESI qui sotto: la prova li segna come «fallimento atteso» (resta verde) e, appena un blocco li sistema,
// Playwright avvisa che il controllo ora passa, e la riga si toglie da ATTESI. Così l'elenco è la lista dei
// lavori ancora da fare, e niente torna indietro senza che ce ne accorgiamo.
//
// Per misurare l'interfaccia allo stesso modo su ogni macchina, «Segoe UI» qui diventa Atkinson Hyperlegible (vedi
// caratteriFissi in schermi.ts): i risultati sono uguali qui e nella CI, ma non sono quelli esatti di Windows. Per rifare l'elenco ATTESI:  CAA_SCHERMI_RAPPORTO=1 npx playwright test schermi
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { SCHERMI, apriCompleto, caratteriFissi, tuttiGliAvvisi, type Schermo } from "./schermi";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Controllo = "scorrimento" | "foglio-verticale" | "foglio-orizzontale" | "una-riga" | "niente-a-capo" | "niente-coperto" | "azioni" | "avvisi";

/** Fallimenti noti del codice di partenza (M10), per controllo: gli schermi (nome di SCHERMI) dove oggi fallisce,
 *  e il blocco di M11 che deve sistemarlo. "*" = tutti gli schermi. */
const ATTESI: Partial<Record<Controllo, { schermi: string[] | "*"; blocco: string }>> = {
  // Schermi larghi meno di circa 1200 punti: un A4 orizzontale (1123 px) più i margini non ci sta nemmeno con il
  // pannello chiuso. Senza zoom del foglio (deciso dall'utente per M11: rischio su cursore e clic) si scorre.
  "foglio-orizzontale": { blocco: "nessun blocco: deciso, niente zoom del foglio in M11", schermi: ["1024x600 al 100%", "1366x768 al 125%", "1440x900 al 125%"] },
};

/** Le azioni principali: devono essere raggiungibili su ogni schermo. */
const AZIONI: Array<[ruolo: "button" | "combobox", nome: RegExp]> = [
  ["button", /^Documenti$/],
  ["button", /^Nuovo$/],
  ["button", /^Annulla$/],
  ["button", /^Ripeti$/],
  ["button", /^Unisci$/],
  ["button", /^(Dividi|Riunisci)$/],
  ["button", /^Piccolo$/],
  ["button", /^Medio$/],
  ["button", /^Grande$/],
  ["button", /^Molto grande$/],
  ["button", /^Stampa/],
  ["button", /^Informazioni$/],
  ["button", /^Testo di esempio$/],
  ["combobox", /^Politica delle parole funzionali$/],
];

/** Dove stanno le barre dell'interfaccia (tutto quello che non è foglio né barra laterale). */
const BARRE = ".toolbar, .statusbar, .docbar, header, [role=toolbar]";
const AVVISI = ".banner, .lexbar, .origbar, .strip";

/** Con CAA_SCHERMI_RAPPORTO=1 l'elenco ATTESI si ignora: si vede lo stato vero di ogni controllo (per riscriverlo). */
const RAPPORTO = process.env.CAA_SCHERMI_RAPPORTO === "1";

function atteso(c: Controllo, s: Schermo): string | null {
  if (RAPPORTO) return null;
  const a = ATTESI[c];
  if (!a) return null;
  return a.schermi === "*" || a.schermi.includes(s.nome) ? a.blocco : null;
}

const misure = (page: Page) =>
  page.evaluate(
    ([barre]) => {
      const vis = (e: Element) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
      };
      // Scorrimento orizzontale: la pagina e ogni contenitore che scorre.
      const scorrono: string[] = [];
      const doc = document.scrollingElement!;
      if (doc.scrollWidth > window.innerWidth + 1) scorrono.push(`pagina (${doc.scrollWidth} > ${window.innerWidth})`);
      for (const e of document.querySelectorAll<HTMLElement>("body *")) {
        const ox = getComputedStyle(e).overflowX;
        if ((ox === "auto" || ox === "scroll") && vis(e) && e.scrollWidth > e.clientWidth + 1) scorrono.push(`${e.className || e.tagName} (${e.scrollWidth} > ${e.clientWidth})`);
      }
      // Il foglio dentro lo spazio visibile accanto alla barra laterale.
      const sheet = document.querySelector(".sheet")!.getBoundingClientRect();
      const wrap = document.querySelector<HTMLElement>(".sheet-wrap")!;
      const w = wrap.getBoundingClientRect();
      const foglio = sheet.left >= w.left - 1 && sheet.right <= w.left + wrap.clientWidth + 1 ? "" : `foglio ${Math.round(sheet.width)} px, spazio ${wrap.clientWidth} px`;
      // Le barre: controlli visibili.
      const controlli = [...document.querySelectorAll<HTMLElement>(barre)]
        .filter(vis)
        .flatMap((b) => [...b.querySelectorAll<HTMLElement>("button, select, input, label, [role=button], .save-status, .lib-status, .update-note")])
        .filter(vis);
      const proprio = (e: HTMLElement) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("");
      const nome = (e: HTMLElement) => (e.getAttribute("aria-label") || (e.tagName === "LABEL" ? proprio(e) : e.textContent) || e.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
      // Testo che va a capo: i pezzi del controllo (righe di testo e controlli contenuti, come la tendina dentro
      // un'etichetta) si raggruppano per riga; due pezzi sono sulla stessa riga se si sovrappongono in verticale.
      const aCapo: string[] = [];
      for (const e of controlli) {
        const range = document.createRange();
        range.selectNodeContents(e);
        const pezzi = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1).sort((a, b) => a.top - b.top);
        const righe: Array<{ top: number; bottom: number }> = [];
        for (const r of pezzi) {
          const centro = (r.top + r.bottom) / 2;
          const riga = righe.find((g) => centro >= g.top && centro <= g.bottom);
          if (riga) {
            riga.top = Math.min(riga.top, r.top);
            riga.bottom = Math.max(riga.bottom, r.bottom);
          } else righe.push({ top: r.top, bottom: r.bottom });
        }
        if (righe.length > 1) aCapo.push(`«${nome(e)}» va a capo`);
        if (e.tagName === "BUTTON" && e.scrollWidth > e.clientWidth + 1) aCapo.push(`«${nome(e)}» tagliato`);
      }
      // Fuori dallo schermo o coperti da un altro elemento (si guarda chi c'è al centro del controllo).
      const coperti: string[] = [];
      for (const e of controlli) {
        if (e.tagName === "LABEL" && e.querySelector("input, select")) continue;
        const r = e.getBoundingClientRect();
        if (r.left < -1 || r.top < -1 || r.right > window.innerWidth + 1 || r.bottom > window.innerHeight + 1) {
          coperti.push(`«${nome(e)}» fuori dallo schermo`);
          continue;
        }
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (top && top !== e && !e.contains(top) && !top.contains(e)) coperti.push(`«${nome(e)}» coperto da ${(top as HTMLElement).className || top.tagName}`);
      }
      // La barra degli strumenti su una riga: i centri dei controlli stanno in una sola fascia.
      const tb = document.querySelector<HTMLElement>("[role=toolbar]");
      let righeBarra = 0;
      if (tb) {
        const centri = [...tb.querySelectorAll<HTMLElement>("button, select, input")].filter(vis).map((e) => {
          const r = e.getBoundingClientRect();
          return { c: r.top + r.height / 2, h: r.height };
        });
        const fasce: number[] = [];
        for (const { c, h } of centri.sort((a, b) => a.c - b.c)) if (!fasce.length || c - fasce[fasce.length - 1] > h * 0.6) fasce.push(c);
        righeBarra = fasce.length;
      }
      return { scorrono, foglio, aCapo, coperti, righeBarra, altezzaBarra: tb ? Math.round(tb.getBoundingClientRect().height) : 0 };
    },
    [BARRE] as const,
  );

/** Un'azione si raggiunge se è visibile, dentro lo schermo e non coperta; altrimenti la si cerca nel menu «Altro». */
async function raggiungibile(page: Page, ruolo: "button" | "combobox", nome: RegExp): Promise<boolean> {
  const diretta = async (): Promise<boolean> => {
    const tutti = page.getByRole(ruolo, { name: nome });
    for (let i = 0; i < (await tutti.count()); i++) {
      const el = tutti.nth(i);
      if (!(await el.isVisible())) continue;
      const ok = await el.evaluate((e) => {
        const r = e.getBoundingClientRect();
        if (r.left < 0 || r.top < 0 || r.right > window.innerWidth || r.bottom > window.innerHeight) return false;
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!top && (top === e || e.contains(top) || top.contains(e) || !!top.closest("label")?.contains(e));
      });
      if (ok) return true;
    }
    return false;
  };
  if (await diretta()) return true;
  const altro = page.getByRole("button", { name: /^Altro/ });
  if ((await altro.count()) === 0 || !(await altro.first().isVisible())) return false;
  await altro.first().click();
  const ok = (await page.getByRole("menuitem", { name: nome }).count()) > 0 || (await diretta());
  await page.keyboard.press("Escape");
  return ok;
}

for (const s of SCHERMI) {
  test.describe(`schermo ${s.nome} (${s.css.width}×${s.css.height} punti)`, () => {
    let context: BrowserContext;
    let page: Page;
    let base: Awaited<ReturnType<typeof misure>>;

    const nuovaPagina = async (browser: Browser) => {
      context = await browser.newContext({ viewport: s.css, deviceScaleFactor: s.scala, baseURL: `http://localhost:${process.env.CAA_PORTA ?? 1421}` });
      page = await context.newPage();
      await caratteriFissi(page);
    };

    test.beforeAll(async ({ browser }) => {
      await nuovaPagina(browser);
      await apriCompleto(page);
      await page.mouse.move(0, 0);
      base = await misure(page);
    });
    test.afterAll(async () => {
      await context?.close();
    });

    const prova = (c: Controllo, fn: () => Promise<void>) =>
      test(c, async () => {
        const blocco = atteso(c, s);
        test.fail(!!blocco, blocco?.startsWith("nessun blocco") ? `fallimento accettato (${blocco})` : `fallimento atteso, da sistemare in ${blocco}`);
        await fn();
      });

    prova("scorrimento", async () => expect(base.scorrono).toEqual([]));
    prova("foglio-verticale", async () => expect(base.foglio).toBe(""));
    prova("una-riga", async () => expect(base.righeBarra, `barra degli strumenti alta ${base.altezzaBarra} px`).toBe(1));
    prova("niente-a-capo", async () => expect(base.aCapo).toEqual([]));
    prova("niente-coperto", async () => expect(base.coperti).toEqual([]));
    prova("azioni", async () => {
      const mancano: string[] = [];
      for (const [ruolo, nome] of AZIONI) if (!(await raggiungibile(page, ruolo, nome))) mancano.push(String(nome));
      expect(mancano).toEqual([]);
    });
    prova("foglio-orizzontale", async () => {
      await page.evaluate(() => {
        const p = (window as any).caaProto;
        p.setPrefs({ print: { ...p.getPrefs().print, orientation: "landscape" } });
      });
      // Il pannello laterale si richiude al fotogramma dopo il cambio di orientamento (M11-4): si aspetta.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const m = await misure(page);
      await page.evaluate(() => {
        const p = (window as any).caaProto;
        p.setPrefs({ print: { ...p.getPrefs().print, orientation: "portrait" } });
      });
      expect(m.foglio).toBe("");
    });
    prova("avvisi", async () => {
      await tuttiGliAvvisi(page);
      const r = await page.evaluate((sel) => {
        const alt = [...document.querySelectorAll<HTMLElement>(sel)].filter((e) => e.offsetHeight > 0).reduce((a, e) => a + e.getBoundingClientRect().height, 0);
        return { avvisi: Math.round(alt), limite: Math.round(window.innerHeight / 4) };
      }, AVVISI);
      expect(r.avvisi, `avvisi alti ${r.avvisi} px su ${s.css.height}`).toBeLessThanOrEqual(r.limite);
    });
  });
}
