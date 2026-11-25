// M11-0 · Il foglio «congelato». In M11 cambia tutto quello che sta attorno al foglio, ma il foglio e la stampa
// non devono cambiare di un pixel. Per ogni stato del foglio (dimensioni dei simboli, orientamento, contorno,
// maiuscolo, testo sopra, bordo, caratteri, una frase per riga, piè di pagina, parola scelta) si fanno due controlli:
//
// 1. L'IMPRONTA dello stile: per ogni elemento del foglio (e per i suoi ::before e ::after) tutti i valori di stile
//    calcolati dal browser, sullo schermo e in modalità stampa, più la regola @page della stampa. Non dipende dai
//    caratteri installati sul computer, quindi vale anche nella CI. Riferimento: foglio-riferimento/impronta.json.
// 2. Le IMMAGINI al pixel: il foglio sullo schermo e le pagine del PDF di stampa, confrontate con le immagini di
//    riferimento con differenza zero. Le immagini dipendono dai caratteri del sistema, quindi stanno in una cartella
//    per «ambiente» (sistema, versione di Chromium, elenco dei caratteri): dove non ci sono, questa parte si salta e
//    lo dice (nella CI, per esempio, resta l'impronta).
//
// Le prove «ostili» rifanno gli stessi controlli dopo aver cambiato carattere, dimensione, interlinea e colore della
// radice della pagina, come farà l'interfaccia nuova (e la «Dimensione dell'interfaccia»): il foglio non deve
// accorgersene.
//
// Rigenerare i riferimenti (solo quando un cambiamento del foglio è voluto e approvato):
//   CAA_FOGLIO_AGGIORNA=1 npx playwright test foglio
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { open } from "./fixtures";

/* eslint-disable @typescript-eslint/no-explicit-any */

const RIF = join(dirname(fileURLToPath(import.meta.url)), "foglio-riferimento");
const IMPRONTA = join(RIF, "impronta.json");
const AGGIORNA = process.env.CAA_FOGLIO_AGGIORNA === "1";

interface Stato {
  nome: string;
  /** Preferenze del documento (dimensione, contorno) e di stampa (solo i campi che cambiano). */
  prefs?: { size?: number; cards?: boolean };
  print?: Record<string, unknown>;
  titolo?: string;
  autore?: string;
  /** Parola su cui cliccare il simbolo (evidenziazione gialla della parola scelta). */
  scegli?: string;
}

const STATI: Stato[] = [
  { nome: "medio" },
  { nome: "piccolo", prefs: { size: 45 } },
  { nome: "grande", prefs: { size: 94 } },
  { nome: "molto-grande", prefs: { size: 151 } },
  { nome: "orizzontale", print: { orientation: "landscape" } },
  { nome: "orizzontale-molto-grande", prefs: { size: 151 }, print: { orientation: "landscape" } },
  { nome: "contorno", prefs: { cards: true } },
  { nome: "maiuscolo", print: { uppercase: true } },
  { nome: "testo-sopra", print: { textAbove: true } },
  { nome: "bordo", print: { border: true } },
  { nome: "atkinson", print: { font: "atkinson" } },
  { nome: "lexend", print: { font: "lexend" } },
  { nome: "una-frase-per-riga", print: { onePerLine: true } },
  { nome: "margini-e-piede", print: { margin: 25, footerTitle: true, footerAuthor: true, footerPage: true }, titolo: "La gita al mare", autore: "Maria Rossi" },
  { nome: "parola-scelta", scegli: "mamma" },
  { nome: "tutto-insieme", prefs: { size: 94, cards: true }, print: { textAbove: true, border: true, uppercase: true, font: "lexend" } },
];

/** Le prove ostili: stessi riferimenti, radice della pagina stravolta. */
const OSTILI = ["medio", "tutto-insieme", "margini-e-piede"];
const CSS_OSTILE = `
  html, body {
    font: italic 700 19px/2.4 Georgia, serif !important;
    color: #c00000 !important;
    letter-spacing: 1.5px !important;
    word-spacing: 4px !important;
    text-transform: lowercase !important;
    text-align: right !important;
    text-indent: 12px !important;
  }`;

/** Un testo che usa tutto quello che il foglio sa mostrare: titolo, grassetto, accenti, articoli ridotti, parola
 *  senza simbolo, parola da controllare, segni di passato, plurale e futuro, gruppo, e abbastanza righe da fare più
 *  pagine con i simboli molto grandi. */
async function caricaTesto(page: Page): Promise<void> {
  await page.evaluate(() => {
    const p = (window as any).caaProto;
    const s = p.view.state.schema;
    const T = (t: string, bold = false) => (bold ? s.text(t, [s.marks.strong.create()]) : s.text(t));
    const P = (...parts: unknown[]) => s.nodes.paragraph.create(null, parts);
    const content = [
      s.nodes.heading.create({ level: 1 }, T("La gita al mare")),
      P(T("Marco è andato al mare con la mamma. Il gatto dorme la sera.")),
      P(T("I ferri sono caldi. Domani andremo in città, perché siamo andati alla scuola media.")),
      P(T("Un dubbio: "), T("Anna legge", true), T(" un libro sotto l'ombrellone.")),
      s.nodes.heading.create({ level: 2 }, T("Il ritorno")),
      P(T("Luca va a scuola con il suo amico. La maestra scrive alla lavagna. I bambini giocano in cortile.")),
      P(T("Oggi piove molto. Metto la giacca e prendo l'ombrello. Cammino piano sulla strada bagnata.")),
    ];
    p.view.dispatch(p.view.state.tr.replaceWith(0, p.view.state.doc.content.size, content));
  });
  await attendiMotore(page);
}

async function attendiMotore(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0);
  await page.waitForTimeout(150);
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0);
}

async function preparaStato(page: Page, st: Stato): Promise<void> {
  await page.setViewportSize({ width: 1700, height: 1000 });
  await open(page, "x");
  await caricaTesto(page);
  await page.evaluate(
    ([prefs, print, titolo]) => {
      const p = (window as any).caaProto;
      const cur = p.getPrefs();
      p.setPrefs({ ...prefs, print: { ...cur.print, ...print } });
      if (titolo) {
        const t = document.querySelector<HTMLInputElement>("input[aria-label='Titolo del documento']");
        if (t) {
          t.value = titolo;
          t.dispatchEvent(new Event("input"));
        }
      }
    },
    [st.prefs ?? {}, st.print ?? {}, st.titolo ?? ""] as const,
  );
  if (st.autore) {
    // L'autore arriva dal nome salvato sul computer: nelle prove senza archivio lo si passa direttamente.
    await page.evaluate((a) => (window as any).caaProto.setAuthor(a), st.autore);
  }
  await attendiMotore(page);
  if (st.scegli) {
    await page.locator(".w", { hasText: new RegExp(`^${st.scegli}$`) }).first().click({ position: { x: 20, y: 8 } });
    await expect(page.locator(".cur")).toHaveCount(1);
  }
  await page.mouse.move(0, 0);
}

/** L'impronta dello stile del foglio: elementi, ::before/::after, valori calcolati (senza le misure che dipendono
 *  dai caratteri, come larghezza e altezza delle parole), attributi di stile, testo, larghezza del foglio, @page. */
function impronta(page: Page) {
  return page.evaluate(() => {
    const SKIP = new Set(["width", "height", "inline-size", "block-size", "min-inline-size", "min-block-size", "top", "right", "bottom", "left",
      "inset-block-start", "inset-block-end", "inset-inline-start", "inset-inline-end", "transform-origin", "perspective-origin",
      "x", "y", "cx", "cy", "r", "rx", "ry", "d"]);
    // --img (l'immagine di ogni simbolo) non sta qui: è nell'attributo style, controllato a parte.
    const CUSTOM = ["--sym", "--txt", "--p-margin"];
    const styles: Record<string, string>[] = [];
    const index = new Map<string, number>();
    const els: Array<[string, number, string, string]> = [];
    const hash = (t: string) => {
      let h = 2166136261;
      for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619) >>> 0;
      return t ? h.toString(16) : "";
    };
    const text = (el: Element) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("");
    // Si salvano solo i valori diversi da quelli di partenza di questo stesso browser (un elemento senza nessuno stile,
    // dentro un contenitore «all: initial»). Così le proprietà nuove o rinominate da una versione di Chromium all'altra
    // (la CI non ha esattamente lo stesso Chromium) si annullano da sole e resta solo quello che fa il nostro CSS.
    const box = document.createElement("div");
    box.style.all = "initial";
    // Fuori dalla pagina visibile, senza occupare spazio: non deve spostare niente (barre di scorrimento comprese).
    box.style.position = "fixed";
    box.style.left = "-10000px";
    box.style.top = "0";
    box.style.width = "0";
    box.style.height = "0";
    box.style.overflow = "hidden";
    const neutro = document.createElement("span");
    box.append(neutro);
    document.body.append(box);
    const csN = getComputedStyle(neutro);
    const partenza: Record<string, string> = {};
    for (let i = 0; i < csN.length; i++) partenza[csN[i]] = csN.getPropertyValue(csN[i]);
    const walk = (el: Element, path: string) => {
      for (const pseudo of ["", "::before", "::after"]) {
        const cs = getComputedStyle(el, pseudo || null);
        if (pseudo && (cs.content === "none" || cs.content === "normal")) continue;
        const o: Record<string, string> = {};
        // Le immagini incorporate (data:) diventano una firma breve: restano controllate, ma il file resta piccolo.
        const v = (x: string) => x.replace(/url\("data:[^"]*"\)/g, "url(data)");
        for (let i = 0; i < cs.length; i++) {
          const k = cs[i];
          if (SKIP.has(k) || k.startsWith("--")) continue;
          // Il margine che centra il foglio nella scrivania dipende dalla larghezza dell'interfaccia, non dal foglio.
          if (path === "div.sheet" && !pseudo && /^margin-(left|right|inline-start|inline-end)$/.test(k)) continue;
          const val = cs.getPropertyValue(k);
          if (val !== partenza[k]) o[k] = v(val);
        }
        for (const c of CUSTOM) o[c] = v(cs.getPropertyValue(c).trim());
        const key = JSON.stringify(o);
        let k = index.get(key);
        if (k === undefined) {
          k = styles.length;
          styles.push(o);
          index.set(key, k);
        }
        els.push([path + pseudo, k, hash(el.getAttribute("style") ?? ""), pseudo ? "" : text(el)]);
      }
      for (const c of el.children) walk(c, `${path}>${c.tagName.toLowerCase()}${[...c.classList].map((x) => "." + x).join("")}`);
    };
    const sheet = document.querySelector(".sheet")!;
    walk(sheet, "div.sheet");
    box.remove();
    return { els, styles, larghezza: (sheet as HTMLElement).offsetWidth, page: document.getElementById("caa-page")?.textContent ?? "" };
  });
}

type Impronta = Awaited<ReturnType<typeof impronta>>;
type Stile = Record<string, string>;
/** Un elemento del foglio: percorso, stile calcolato completo, impronta dell'attributo style, testo. */
interface Elemento {
  p: string;
  s: Stile;
  a: string;
  t: string;
}
interface Foto {
  larghezza: number;
  page: string;
  elementi: Elemento[];
}

const daImpronta = (imp: Impronta): Foto => ({
  larghezza: imp.larghezza,
  page: imp.page,
  elementi: imp.els.map(([p, k, a, t]) => ({ p, s: imp.styles[k], a, t })),
});

/** Le differenze leggibili fra due foto del foglio (per capire cosa è cambiato quando la prova fallisce). */
function spiega(rif: Foto, ora: Foto): string[] {
  const out: string[] = [];
  if (rif.larghezza !== ora.larghezza) out.push(`larghezza del foglio: ${rif.larghezza} → ${ora.larghezza}`);
  if (rif.page !== ora.page) out.push(`regola @page:\n  prima: ${rif.page}\n  ora:   ${ora.page}`);
  const n = Math.max(rif.elementi.length, ora.elementi.length);
  for (let i = 0; i < n && out.length < 40; i++) {
    const a = rif.elementi[i];
    const b = ora.elementi[i];
    if (!a || !b) {
      out.push(`elemento in più o in meno: ${(a ?? b)!.p}`);
      continue;
    }
    if (a.p !== b.p) out.push(`elemento diverso: ${a.p} → ${b.p}`);
    if (a.a !== b.a) out.push(`${a.p}: attributo style diverso`);
    if (a.t !== b.t) out.push(`${a.p}: testo «${a.t}» → «${b.t}»`);
    for (const k of new Set([...Object.keys(a.s), ...Object.keys(b.s)])) if (a.s[k] !== b.s[k]) out.push(`${a.p}: ${k}: ${a.s[k]} → ${b.s[k]}`);
  }
  return out;
}

// ---- Impronte: lette all'inizio, scritte alla fine se si rigenera ----
// Nel file gli stili uguali stanno una volta sola (tabella comune a tutti gli stati), ognuno come differenza da
// uno stile di base; ogni elemento è una riga «percorso | numero dello stile | attributo style | testo».

interface FileImpronta {
  base: Stile;
  stili: Array<Record<string, string | null>>;
  stati: Record<string, { larghezza: number; page: string; elementi: string[] }>;
}

function leggi(): Record<string, Foto> {
  if (!existsSync(IMPRONTA)) return {};
  const f = JSON.parse(readFileSync(IMPRONTA, "utf8")) as FileImpronta;
  // null = proprietà che lo stile di base ha e questo no (valore di partenza del browser).
  const pieni = f.stili.map((d) => Object.fromEntries(Object.entries({ ...f.base, ...d }).filter(([, v]) => v !== null)) as Stile);
  return Object.fromEntries(
    Object.entries(f.stati).map(([k, v]) => [
      k,
      {
        larghezza: v.larghezza,
        page: v.page,
        elementi: v.elementi.map((riga) => {
          const [p, i, a, ...t] = riga.split(" | ");
          return { p, s: pieni[Number(i)], a, t: t.join(" | ") };
        }),
      },
    ]),
  );
}

function scrivi(tutte: Record<string, Foto>): void {
  const chiavi = Object.keys(tutte).sort();
  const base = tutte[chiavi[0]].elementi[0].s;
  const stili: FileImpronta["stili"] = [];
  const index = new Map<string, number>();
  const stati: FileImpronta["stati"] = {};
  for (const k of chiavi) {
    const f = tutte[k];
    stati[k] = {
      larghezza: f.larghezza,
      page: f.page,
      elementi: f.elementi.map((e) => {
        const d: Record<string, string | null> = Object.fromEntries(Object.entries(e.s).filter(([n, v]) => base[n] !== v));
        for (const n of Object.keys(base)) if (!(n in e.s)) d[n] = null;
        const key = JSON.stringify(d);
        let i = index.get(key);
        if (i === undefined) {
          i = stili.length;
          stili.push(d);
          index.set(key, i);
        }
        return [e.p, i, e.a, e.t].join(" | ");
      }),
    };
  }
  mkdirSync(RIF, { recursive: true });
  writeFileSync(IMPRONTA, JSON.stringify({ base, stili, stati }, null, 1) + "\n");
}

const riferimento = leggi();
const nuove: Record<string, Foto> = {};

test.afterAll(() => {
  if (AGGIORNA && Object.keys(nuove).length > 0) scrivi({ ...riferimento, ...nuove });
});

function controllaImpronta(chiave: string, imp: Impronta): void {
  const ora = daImpronta(imp);
  if (AGGIORNA) {
    nuove[chiave] = ora;
    return;
  }
  const rif = riferimento[chiave];
  expect(rif, `manca l'impronta di riferimento «${chiave}»: rigenerare con CAA_FOGLIO_AGGIORNA=1`).toBeDefined();
  expect(spiega(rif, ora), `il foglio è cambiato (${chiave})`).toEqual([]);
}

// ---- Immagini al pixel, per ambiente ----

let cartellaAmbiente = "";
function ambiente(browserVersion: string): string {
  if (cartellaAmbiente) return cartellaAmbiente;
  let fonts = "";
  try {
    fonts = execFileSync("fc-list", ["--format", "%{file}\n"]).toString().split("\n").sort().join("\n");
  } catch {
    /* senza fontconfig (Windows): conta solo sistema e browser */
  }
  const tag = createHash("sha1").update(`${process.platform}\n${browserVersion}\n${fonts}`).digest("hex").slice(0, 10);
  cartellaAmbiente = join(RIF, `immagini-${process.platform}-${tag}`);
  return cartellaAmbiente;
}

async function raw(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** Confronta un'immagine con il riferimento: differenza zero. Restituisce false se il riferimento non c'è. */
async function controllaImmagine(dir: string, nome: string, png: Buffer, info: TestInfo): Promise<boolean> {
  const file = join(dir, `${nome}.png`);
  if (AGGIORNA) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, png);
    return true;
  }
  if (!existsSync(file)) return false;
  const a = await raw(readFileSync(file));
  const b = await raw(png);
  let diversi = 0;
  if (a.w === b.w && a.h === b.h) {
    for (let i = 0; i < a.data.length; i += 4) {
      if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) diversi++;
    }
  }
  if (a.w !== b.w || a.h !== b.h || diversi > 0) {
    writeFileSync(info.outputPath(`${nome}-ora.png`), png);
    await info.attach(`${nome}-ora`, { path: info.outputPath(`${nome}-ora.png`), contentType: "image/png" });
    await info.attach(`${nome}-riferimento`, { path: file, contentType: "image/png" });
  }
  expect({ misura: `${b.w}x${b.h}`, pixelDiversi: diversi }, `immagine «${nome}» diversa dal riferimento`).toEqual({ misura: `${a.w}x${a.h}`, pixelDiversi: 0 });
  return true;
}

/** Il foglio sullo schermo, intero: la finestra si allarga quanto serve perché il foglio non sia tagliato. */
async function fotoFoglio(page: Page): Promise<Buffer> {
  // Il foglio si fotografa sempre nello stesso punto rispetto alla «griglia» con cui il browser disegna la pagina
  // (piastrelle di 256 px): angolo in alto a sinistra su coordinate multiple di 256. Se il foglio cadesse altrove
  // (per esempio perché le barre sopra sono alte 44,6 px invece di 44), il browser disegnerebbe i bordi arrotondati
  // con sfumature leggermente diverse: il foglio sarebbe uguale, ma l'immagine no. Per spostarlo si allarga lo
  // spazio attorno al foglio (non il foglio), e lo si rimette com'era subito dopo la foto.
  const h = await page.evaluate(() => document.querySelector<HTMLElement>(".sheet")!.offsetHeight);
  await page.setViewportSize({ width: 2400, height: h + 1200 });
  await page.evaluate(() => document.querySelector(".sheet-wrap")?.scrollTo(0, 0));
  const posto = await page.evaluate(() => {
    const wrap = document.querySelector<HTMLElement>(".sheet-wrap")!;
    const sheet = document.querySelector(".sheet")!;
    const pad0 = { top: parseFloat(getComputedStyle(wrap).paddingTop), left: parseFloat(getComputedStyle(wrap).paddingLeft) };
    const meta = { top: Math.ceil(sheet.getBoundingClientRect().top / 256) * 256, left: Math.ceil(sheet.getBoundingClientRect().left / 256) * 256 };
    for (let i = 0; i < 6; i++) {
      const r = sheet.getBoundingClientRect();
      const dy = meta.top - r.top;
      const dx = meta.left - r.left;
      if (Math.abs(dy) < 0.001 && Math.abs(dx) < 0.001) break;
      pad0.top += dy;
      // Il foglio è centrato: allargando lo spazio a sinistra di 2 px il foglio si sposta di 1 px.
      pad0.left += dx * (getComputedStyle(sheet).marginLeft === "0px" ? 1 : 2);
      wrap.style.paddingTop = `${pad0.top}px`;
      wrap.style.paddingLeft = `${pad0.left}px`;
    }
    const r = sheet.getBoundingClientRect();
    return { top: r.top, left: r.left, meta };
  });
  expect(posto, "il foglio deve stare all'inizio di una piastrella per la foto").toEqual({ top: posto.meta.top, left: posto.meta.left, meta: posto.meta });
  // Solo le righe intere del foglio: se il foglio è alto, per esempio, 1483,6 px, l'ultima riga sarebbe metà foglio e
  // metà scrivania, e cambierebbe ogni volta che cambia il colore della scrivania (che è interfaccia, non foglio).
  const box = await page.evaluate(() => {
    const r = document.querySelector(".sheet")!.getBoundingClientRect();
    return { x: r.left, y: r.top, width: Math.floor(r.width), height: Math.floor(r.height) };
  });
  const png = await page.screenshot({ clip: box, animations: "disabled", caret: "hide" });
  // Via il ritocco, altrimenti resterebbe anche nella stampa che si controlla subito dopo.
  await page.evaluate(() => document.querySelector<HTMLElement>(".sheet-wrap")!.removeAttribute("style"));
  return png;
}

/** Le pagine del PDF di stampa, una immagine per pagina a 96 dpi (A4 = 794 × 1123). */
async function pagineStampa(page: Page): Promise<Buffer[]> {
  await page.emulateMedia({ media: "print" });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: "screen" });
  const dir = mkdtempSync(join(tmpdir(), "caa-foglio-"));
  writeFileSync(join(dir, "p.pdf"), pdf);
  execFileSync("pdftoppm", ["-q", "-r", "96", "-png", join(dir, "p.pdf"), join(dir, "pag")]);
  return readdirSync(dir)
    .filter((f) => f.startsWith("pag") && f.endsWith(".png"))
    .sort()
    .map((f) => readFileSync(join(dir, f)));
}

async function controlla(page: Page, st: Stato, chiave: string, info: TestInfo, browserVersion: string): Promise<void> {
  // 1. Impronta, sullo schermo e in modalità stampa.
  controllaImpronta(`${chiave}/schermo`, await impronta(page));
  await page.emulateMedia({ media: "print" });
  controllaImpronta(`${chiave}/stampa`, await impronta(page));
  await page.emulateMedia({ media: "screen" });

  // 2. Immagini al pixel (dove ci sono i riferimenti per questo ambiente). Le prove ostili usano quelle normali.
  const dir = ambiente(browserVersion);
  const nome = st.nome;
  const immagini: Array<[string, Buffer]> = [[`schermo-${nome}`, await fotoFoglio(page)]];
  const pagine = await pagineStampa(page);
  pagine.forEach((png, i) => immagini.push([`stampa-${nome}-${i + 1}`, png]));
  if (!AGGIORNA && existsSync(dir)) {
    const attese = readdirSync(dir).filter((f) => new RegExp(`^stampa-${nome}-\\d+\\.png$`).test(f)).length;
    expect(pagine.length, `numero di pagine della stampa (${nome})`).toBe(attese);
  }
  let fatte = 0;
  for (const [n, png] of immagini) if (await controllaImmagine(dir, n, png, info)) fatte++;
  if (fatte === 0) info.annotations.push({ type: "immagini", description: `nessuna immagine di riferimento per questo ambiente (${dir}): controllata solo l'impronta` });
}

test.describe("foglio congelato", () => {
  for (const st of STATI) {
    test(`il foglio non cambia: ${st.nome}`, async ({ page, browser }, info) => {
      await preparaStato(page, st);
      await controlla(page, st, st.nome, info, browser.version());
    });
  }

  for (const nome of OSTILI) {
    test(`il foglio non sente la radice della pagina: ${nome}`, async ({ page, browser }, info) => {
      test.skip(AGGIORNA, "si rigenerano solo i riferimenti normali");
      const st = STATI.find((s) => s.nome === nome)!;
      await preparaStato(page, st);
      await page.addStyleTag({ content: CSS_OSTILE });
      await page.waitForTimeout(50);
      await controlla(page, st, st.nome, info, browser.version());
    });
  }
});
