// Prove di M8a: l'editor con i simboli del motore. Nel browser non c'è il motore vero: si usa un
// motore finto (in pagina) che riconosce le parole con regole semplici e risponde dopo qualche
// millisecondo. Le prove con il motore vero e con le immagini ARASAAC sono a mano (app Tauri).
import { expect, test, type Page } from "@playwright/test";
import { azioneRiga, casellaContorno, open, rispondiConferma, voceAltro, voceRiga } from "./fixtures";

/* eslint-disable @typescript-eslint/no-explicit-any */

const stats = (page: Page) => page.evaluate(() => (window as any).caaProto.engineStats());

test("i simboli del motore compaiono e le classi dicono cosa succede", async ({ page }) => {
  await open(page, "La sera Marco è andato dal dubbio. I ferri sono andati.");
  // "sera" non ha simbolo (segnaposto), "dubbio" è da controllare, "La" è ridotto.
  await expect(page.locator(".w.ph", { hasText: "sera" })).toHaveCount(1);
  await expect(page.locator(".w.dbt", { hasText: "dubbio" })).toHaveCount(1);
  await expect(page.locator(".w.red", { hasText: "La" })).toHaveCount(1);
  // Segni: passato, plurale, passato + plurale.
  await expect(page.locator(".w.mpast:not(.mp)", { hasText: "andato" })).toHaveCount(1);
  await expect(page.locator(".w.mp:not(.mpast)", { hasText: "ferri" })).toHaveCount(1);
  await expect(page.locator(".w.mp.mpast", { hasText: "andati" })).toHaveCount(1);
  // La punteggiatura non ha simbolo.
  const punctuationHasSymbol = await page.evaluate(() => [...document.querySelectorAll(".w")].some((e) => /^[.,]$/.test(e.textContent ?? "")));
  expect(punctuationHasSymbol).toBe(false);
  // Segno disegnato: contenuto del pseudo-elemento.
  const content = await page.evaluate(() => getComputedStyle([...document.querySelectorAll(".w.mp.mpast")][0], "::after").content);
  expect(content).toContain("+");
});

test("barra di stato: parole e parole da controllare", async ({ page }) => {
  await open(page, "La sera dubbio.\nMarco dubbio.");
  await expect(page.locator(".statusbar")).toContainText("5 parole");
  await expect(page.locator(".statusbar")).toContainText("2 parole da controllare");
  expect(await stats(page)).toMatchObject({ words: 5, doubtful: 2, pending: 0 });
});

test("la politica Essenziale nasconde gli articoli e Completo li riduce", async ({ page }) => {
  await open(page, "La casa il pane.");
  await expect(page.locator(".w.red")).toHaveCount(2);
  await page.selectOption("select[aria-label='Politica delle parole funzionali']", "essential");
  await expect(page.locator(".w.hid")).toHaveCount(2);
  await expect(page.locator(".w.red")).toHaveCount(0);
  await page.selectOption("select[aria-label='Politica delle parole funzionali']", "complete");
  await expect(page.locator(".w.red")).toHaveCount(2);
});

test("scrivendo, i simboli già disegnati restano al loro posto e la parola nuova arriva dopo", async ({ page }) => {
  await open(page, "Marco mangia pane");
  // Il motore risponde dopo 10 secondi: finché non risponde, i simboli di prima devono restare.
  await page.evaluate(() => { (window as any).__mock.delay = 10_000; });
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" casa", { delay: 0 });
  await page.waitForTimeout(50);
  const texts = await page.locator(".w[style*='--img']").allTextContents();
  expect(texts).toEqual(["Marco", "mangia", "pane"]);
  expect((await stats(page)).pending).toBe(1);
  // Risposta rapida: arriva anche "casa".
  await page.evaluate(() => { (window as any).__mock.delay = 5; });
  await page.keyboard.type(" mare", { delay: 0 });
  await expect(page.locator(".w[style*='--img']", { hasText: "mare" })).toHaveCount(1);
});

test("una risposta in ritardo per un testo vecchio non rovina il paragrafo", async ({ page }) => {
  await open(page, "Marco");
  await page.evaluate(() => { (window as any).__mock.delay = 40; });
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("End");
  for (const ch of " mangia pane") await page.keyboard.type(ch, { delay: 5 });
  await expect(page.locator(".w[style*='--img']")).toHaveCount(3);
  const texts = await page.locator(".w[style*='--img']").allTextContents();
  expect(texts.join(" ")).toBe("Marco mangia pane");
  expect((await stats(page)).pending).toBe(0);
});

test("i paragrafi uguali partono una volta sola", async ({ page }) => {
  await open(page, "casa\ncasa\ncasa");
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0);
  const calls = await page.evaluate(() => (window as any).__mock.calls as Array<{ texts: string[] }>);
  expect(calls.flatMap((c) => c.texts).filter((t) => t === "casa")).toHaveLength(1);
  await expect(page.locator(".w[style*='--img']")).toHaveCount(3);
});

test("il grassetto non spezza un token del motore (trattino e date come nel motore)", async ({ page }) => {
  await open(page, "crema anti-age e data 12/11/2026");
  // Seleziono "age" e metto il grassetto: deve diventare in grassetto tutto "anti-age".
  await page.evaluate(() => {
    const p = (window as any).caaProto;
    const text: string = p.view.state.doc.textContent;
    const from = 1 + text.indexOf("age");
    p.setCaret(from, from + 3);
  });
  await page.keyboard.press("Control+b");
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0);
  const bold = await page.evaluate(() => [...document.querySelectorAll(".ProseMirror strong")].map((e) => e.textContent));
  expect(bold.join("")).toBe("anti-age");
  // Il simbolo non e' diviso: nessun pezzo "wc" nella parola.
  expect(await page.locator(".w.wc").count()).toBe(0);
  // Stessa cosa per una data.
  await page.evaluate(() => {
    const p = (window as any).caaProto;
    const text: string = p.view.state.doc.textContent;
    const from = 1 + text.indexOf("11/");
    p.setCaret(from, from + 2);
  });
  await page.keyboard.press("Control+b");
  const bold2 = await page.evaluate(() => [...document.querySelectorAll(".ProseMirror strong")].map((e) => e.textContent).join("|"));
  expect(bold2).toContain("12/11/2026");
});

test("se il motore dà errore l'editor lo dice, riprova da solo e poi i simboli arrivano", async ({ page }) => {
  await open(page, "Marco");
  // Il motore e' guasto finché non lo rimetto a posto (le battute partono più in fretta della prima risposta).
  await page.evaluate(() => { (window as any).__mock.fail = 1_000_000; (window as any).__mock.calls.length = 0; });
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" mangia", { delay: 0 });
  await expect(page.locator(".statusbar")).toContainText("Il motore non risponde");
  // Con il motore guasto non parte una richiesta a ogni battuta: 10 battute in piu', poche chiamate.
  const before = await page.evaluate(() => (window as any).__mock.calls.length);
  await page.keyboard.type(" aaaaaaaaaa", { delay: 0 });
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => (window as any).__mock.calls.length);
  expect(after - before).toBeLessThanOrEqual(1);
  // Il motore torna a funzionare: al prossimo tentativo (dopo 1 s, poi 2 s, poi 4 s) i simboli compaiono.
  await page.evaluate(() => { (window as any).__mock.fail = 0; });
  await expect(page.locator(".w[style*='--img']", { hasText: "mangia" })).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator(".statusbar")).not.toContainText("Il motore non risponde");
});

test("la barra di stato non salta mentre si scrive", async ({ page }) => {
  await open(page, "Marco mangia la mela e beve il latte.\nGiulia legge un libro.");
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0);
  const total = (await stats(page)).words;
  await page.evaluate(() => { (window as any).__mock.delay = 30; });
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("Control+Home");
  const seen: number[] = [];
  for (const ch of " e") {
    await page.keyboard.type(ch, { delay: 0 });
    for (let k = 0; k < 6; k++) {
      seen.push((await stats(page)).words);
      await page.waitForTimeout(8);
    }
  }
  // Mai meno del totale iniziale: i paragrafi in attesa mantengono l'ultimo conteggio.
  expect(Math.min(...seen)).toBeGreaterThanOrEqual(total);
});

test("il segno passato + plurale ha lo spazio e le parole nascoste non mostrano segni", async ({ page }) => {
  await open(page, "I andati bambini");
  // "andati" ha passato + plurale: il segno e' "◀ +" con lo spazio.
  const content = await page.evaluate(() => getComputedStyle([...document.querySelectorAll(".w.mp.mpast")][0], "::after").content);
  expect(content).toBe('"\u25C0 +"');
  // Una parola nascosta con segni non disegna il segno.
  await page.selectOption("select[aria-label='Politica delle parole funzionali']", "essential");
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0);
  const hiddenBadge = await page.evaluate(() => {
    const el = document.querySelector(".w.hid");
    return el ? getComputedStyle(el, "::after").content : "assente";
  });
  expect(["none", "normal", "assente", '""']).toContain(hiddenBadge);
});

test("dal tasto al simbolo, con un documento di 200 paragrafi @perf", async ({ page }) => {
  const text = Array.from({ length: 200 }, (_, i) => `Marco mangia la mela numero ${i} e beve il latte caldo.`).join("\n");
  await open(page, text);
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0, undefined, { timeout: 30_000 });
  await page.evaluate(() => { (window as any).__mock.delay = 2; });
  await page.locator(".ProseMirror").click();
  const times: number[] = [];
  for (let n = 0; n < 12; n++) {
    const ms = await page.evaluate(
      (word) =>
        new Promise<number>((resolve) => {
          const p = (window as any).caaProto;
          const view = p.view;
          const t0 = performance.now();
          const done = () => {
            const found = [...document.querySelectorAll(".w[style*='--img']")].some((e) => e.textContent === word);
            if (found) resolve(performance.now() - t0);
            else requestAnimationFrame(done);
          };
          // Scrive la parola nuova in fondo al primo paragrafo.
          const end = view.state.doc.child(0).nodeSize - 1;
          view.dispatch(view.state.tr.insertText(` ${word}`, end));
          done();
        }),
      ["alfa", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "sigma"][n],
    );
    times.push(ms);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  expect(median, `mediana ${median.toFixed(1)} ms, tutti: ${times.map((t) => t.toFixed(0)).join(" ")}`).toBeLessThan(30);
});
test("dopo «Testo di esempio» o «Nuovo» i simboli del motore tornano (e la politica resta)", async ({ page }) => {
  await open(page, "Marco mangia pane");
  await page.selectOption("select[aria-label='Politica delle parole funzionali']", "essential");
  // «Testo di esempio»: sostituisce tutto il documento.
  await voceAltro(page, "Testo di esempio"); // M11-4: nel menu «Altro»
  await expect(page.locator(".w[style*='--img']").first()).toBeVisible();
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0);
  expect((await stats(page)).words).toBeGreaterThan(50);
  expect(await page.locator("select[aria-label='Politica delle parole funzionali']").inputValue()).toBe("essential");
  // La politica Essenziale e' ancora quella che arriva al motore.
  const policies = await page.evaluate(() => (window as any).__mock.calls.map((c: { policy: string }) => c.policy));
  expect(policies[policies.length - 1]).toBe("essential");
  // «Nuovo»: documento vuoto; scrivendo i simboli compaiono ancora.
  await page.getByRole("button", { name: "Nuovo" }).click();
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("casa mare");
  await expect(page.locator(".w[style*='--img']")).toHaveCount(2);
});

// ---- M8b: menu delle alternative, scelte come mark, blocchi di senso, parole da controllare ----

const imgOf = (page: Page, word: string) =>
  page.locator(".w", { hasText: new RegExp(`^${word}$`) }).first().getAttribute("style");

/** Clic sulla zona del simbolo della parola (la parte alta dell'elemento). */
async function clickSymbol(page: Page, word: string, nth = 0): Promise<void> {
  await page.locator(".w", { hasText: new RegExp(`^${word}$`) }).nth(nth).click({ position: { x: 20, y: 8 } });
}

const docLocks = (page: Page) => page.evaluate(() => (window as any).caaProto.view.state.doc.attrs.locks as Array<{ lemma: string; cat: string; picto: number; uuid: string }>);
const noLock = (page: Page) => page.locator(".pm-all input").uncheck();

const docPicks = (page: Page) =>
  page.evaluate(() => {
    const out: Array<Record<string, unknown>> = [];
    (window as any).caaProto.view.state.doc.descendants((n: any) => {
      for (const m of n.marks ?? []) if (m.type.name === "pick") out.push({ text: n.text, ...m.attrs });
    });
    return out;
  });

test("clic sul simbolo riempie la barra laterale con le alternative; clic sul testo no", async ({ page }) => {
  await open(page, "Marco mangia pane");
  const word = page.locator(".w", { hasText: /^pane$/ });
  const box = await word.boundingBox();
  await word.click({ position: { x: 20, y: box!.height - 4 } }); // sul testo, sotto il simbolo
  // La barra c'è sempre (fissa) ma resta vuota: solo i suggerimenti.
  await expect(page.locator(".side")).toBeVisible();
  await expect(page.locator(".side .side-empty")).toBeVisible();
  await expect(page.locator(".side .pm-head")).toHaveCount(0);
  await clickSymbol(page, "pane");
  await expect(page.locator(".side .pm-head")).toBeVisible();
  await expect(page.locator(".side .side-empty")).toHaveCount(0);
  await expect(page.locator(".w.cur")).toHaveText("pane");
  await expect(page.locator(".pm-head")).toContainText("pane");
  await expect(page.locator(".pm-head")).toContainText("nome, prova");
  // 9 alternative dal motore, 8 in griglia; quella senza immagine mostra il segnaposto.
  await expect(page.locator(".pm-cell")).toHaveCount(8);
  await expect(page.locator(".pm-cell").nth(2).locator(".pm-noimg")).toHaveCount(1);
  await expect(page.locator(".pm-num").first()).toHaveText("1");
  await expect(page.getByRole("button", { name: "Nessun simbolo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Solo testo" })).toBeVisible();
  // La ricerca sta in alto nella barra, sopra la parola.
  await expect(page.locator(".side > .pm-search")).toBeVisible();
  expect(await page.evaluate(() => document.querySelector(".side")!.firstElementChild!.classList.contains("pm-search"))).toBe(true);
  await expect(page.locator(".pm-all input")).toBeChecked();
  // Esc riporta il cursore nel testo; la barra resta sulla parola.
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => document.activeElement?.classList.contains("ProseMirror"))).toBe(true);
  await expect(page.locator(".side .pm-head")).toBeVisible();
  // Le alternative sono state chieste per la parola giusta.
  const alts = await page.evaluate(() => (window as any).__mock.alts as Array<{ para: { text: string }; s: number; e: number }>);
  expect(alts[0].para.text.slice(alts[0].s, alts[0].e)).toBe("pane");
});

test("una scelta cambia il simbolo, è un solo passo di annulla e si può ripetere", async ({ page }) => {
  await open(page, "Marco mangia pane");
  const before = await imgOf(page, "pane");
  await clickSymbol(page, "pane");
  await noLock(page);
  const sideBefore = await page.locator(".pm-now img").getAttribute("src");
  await page.locator(".pm-cell").nth(1).click();
  await expect.poll(() => imgOf(page, "pane")).not.toBe(before);
  // La barra resta sulla parola e mostra il simbolo nuovo e il pulsante «Automatico».
  await expect.poll(() => page.locator(".pm-now img").getAttribute("src")).not.toBe(sideBefore);
  await expect(page.getByRole("button", { name: "Automatico" })).toBeVisible();
  await expect(page.locator(".pm-why")).toContainText("scelto da te");
  const chosen = await imgOf(page, "pane");
  expect(chosen).toContain(encodeURIComponent("hsl(" + (1002 % 360)));
  const picks = await docPicks(page);
  expect(picks).toHaveLength(1);
  expect(picks[0]).toMatchObject({ text: "pane", word: "pane", picto: 1002, lemma: "pane", cat: "NOUN" });
  // Annulla: torna il simbolo di prima; ripeti: torna la scelta.
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("Control+z");
  await expect.poll(() => imgOf(page, "pane")).toBe(before);
  expect(await docPicks(page)).toHaveLength(0);
  await page.keyboard.press("Control+y");
  await expect.poll(() => imgOf(page, "pane")).toBe(chosen);
  // Il motore ha ricevuto la scelta del paragrafo.
  const last = await page.evaluate(() => {
    const c = (window as any).__mock.calls;
    return c[c.length - 1];
  });
  expect(last.paras[0].forced).toEqual([{ s: 13, e: 17, picto: 1002 }]);
  expect(last.locks).toEqual([]);
});

test("«usa per tutto il testo» è un dato del documento: annulla, ripeti, «Togli il blocco»", async ({ page }) => {
  await open(page, "Marco mangia pane");
  const before = await imgOf(page, "pane");
  await clickSymbol(page, "pane");
  await page.locator(".pm-cell").nth(1).click();
  await expect.poll(() => imgOf(page, "pane")).not.toBe(before);
  const chosen = await imgOf(page, "pane");
  // Nessun segno sulla parola: il blocco sta nei dati del documento.
  expect(await docPicks(page)).toHaveLength(0);
  expect(await docLocks(page)).toEqual([{ lemma: "pane", cat: "NOUN", picto: 1002, uuid: "" }]);
  const last = await page.evaluate(() => { const c = (window as any).__mock.calls; return c[c.length - 1]; });
  expect(last.locks).toEqual([{ lemma: "pane", cat: "NOUN", picto: 1002 }]);
  // Annulla e ripeti includono il blocco (un solo passo).
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("Control+z");
  await expect.poll(() => imgOf(page, "pane")).toBe(before);
  expect(await docLocks(page)).toEqual([]);
  await page.keyboard.press("Control+y");
  await expect.poll(() => imgOf(page, "pane")).toBe(chosen);
  // Il documento che passa dal salvataggio (JSON) e torna porta ancora il blocco.
  const roundtrip = await page.evaluate(() => {
    const p = (window as any).caaProto;
    const doc = p.view.state.schema.nodeFromJSON(JSON.parse(JSON.stringify(p.view.state.doc.toJSON())));
    return doc.attrs.locks;
  });
  expect(roundtrip).toEqual([{ lemma: "pane", cat: "NOUN", picto: 1002, uuid: "" }]);
  // Cancellare la parola su cui si è scelto non scioglie il blocco: vale per le altre «pane».
  await page.keyboard.press("End");
  await page.keyboard.type(" e pane");
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0);
  await page.evaluate(() => (window as any).caaProto.setCaret(14, 18));
  await page.keyboard.press("Backspace");
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0);
  expect(await docLocks(page)).toHaveLength(1);
  await expect.poll(() => imgOf(page, "pane")).toBe(chosen);
  // «Togli il blocco» riporta le parole al simbolo automatico, e si può annullare.
  await clickSymbol(page, "pane");
  await expect(page.getByRole("button", { name: "Automatico" })).toHaveCount(0);
  await page.getByRole("button", { name: "Togli il blocco" }).click();
  await expect.poll(async () => (await docLocks(page)).length).toBe(0);
  await expect.poll(() => imgOf(page, "pane")).toBe(before);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await docLocks(page)).length).toBe(1);
});

test("«usa per tutto il testo»: tutte le parole uguali, o solo quella", async ({ page }) => {
  await open(page, "pane e pane\npane");
  const first = await imgOf(page, "pane");
  await clickSymbol(page, "pane", 0);
  await page.locator(".pm-cell").nth(3).click();
  // Attiva (predefinita): le tre occorrenze, anche in un altro paragrafo, prendono il simbolo scelto.
  await expect.poll(async () => (await page.locator(".w", { hasText: /^pane$/ }).evaluateAll((els) => els.map((e) => e.getAttribute("style")))).filter((s) => s === first).length).toBe(0);
  const styles = await page.locator(".w", { hasText: /^pane$/ }).evaluateAll((els) => els.map((e) => e.getAttribute("style")));
  expect(new Set(styles).size).toBe(1);
  // Con la casella spenta cambia solo una occorrenza (e l'altro blocco resta com'era).
  await clickSymbol(page, "pane", 1);
  await page.locator(".pm-all input").uncheck();
  await page.locator(".pm-cell").nth(0).click();
  await expect.poll(async () => new Set(await page.locator(".w", { hasText: /^pane$/ }).evaluateAll((els) => els.map((e) => e.getAttribute("style")))).size).toBe(2);
  expect(await docPicks(page)).toHaveLength(1);
  expect(await docLocks(page)).toHaveLength(1);
  // Una scelta con blocco («tutto il testo») sostituisce anche le scelte singole delle parole uguali:
  // resta il solo blocco e tutte le occorrenze hanno lo stesso simbolo.
  await clickSymbol(page, "pane", 2);
  await expect(page.locator(".pm-all input")).not.toBeChecked(); // la spunta tolta prima resta tolta
  await page.locator(".pm-all input").check();
  await page.locator(".pm-cell").nth(4).click();
  await expect.poll(async () => (await docPicks(page)).length).toBe(0);
  expect(await docLocks(page)).toEqual([{ lemma: "pane", cat: "NOUN", picto: 1005, uuid: "" }]);
  await expect.poll(async () => new Set(await page.locator(".w", { hasText: /^pane$/ }).evaluateAll((els) => els.map((e) => e.getAttribute("style")))).size).toBe(1);
});

test("tastiera: Alt+↓ riempie la barra, 1–8 sceglie, Esc torna al testo", async ({ page }) => {
  await open(page, "Marco mangia pane");
  await page.evaluate(() => (window as any).caaProto.setCaret(15));
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.locator(".pm-head")).toContainText("pane");
  await expect(page.locator(".pm-cell")).toHaveCount(8);
  // Il fuoco è nella barra: i numeri scelgono (nel testo si scriverebbero).
  expect(await page.evaluate(() => document.activeElement?.classList.contains("side"))).toBe(true);
  await noLock(page);
  await page.keyboard.press("3");
  await expect.poll(async () => (await docPicks(page))[0]).toMatchObject({ picto: 1003, word: "pane" });
  expect(await page.evaluate(() => (window as any).caaProto.text(0, (window as any).caaProto.docSize()))).toBe("Marco mangia pane");
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0);
  // Dopo la scelta il cursore è tornato nel testo: un numero ora si scrive. Esc dalla barra non sceglie.
  await page.keyboard.press("End");
  await page.keyboard.type("5");
  expect(await page.evaluate(() => (window as any).caaProto.text(0, (window as any).caaProto.docSize()))).toContain("pane5");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Alt+ArrowDown");
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => document.activeElement?.classList.contains("ProseMirror"))).toBe(true);
  expect(await docPicks(page)).toHaveLength(1);
});

test("«Nessun simbolo», «Solo testo» e «Automatico»", async ({ page }) => {
  await open(page, "Marco mangia pane");
  await clickSymbol(page, "pane");
  await page.getByRole("button", { name: "Nessun simbolo" }).click();
  // Spazio del simbolo vuoto, senza segnaposto tratteggiato.
  await expect(page.locator(".w.ns:not(.ph):not(.txt)", { hasText: /^pane$/ })).toHaveCount(1);
  const boxNone = await page.locator(".w.ns", { hasText: /^pane$/ }).boundingBox();
  expect(boxNone!.height).toBeGreaterThan(40);
  // Solo testo: la parola perde lo spazio del simbolo.
  await clickSymbol(page, "pane");
  await page.getByRole("button", { name: "Solo testo" }).click();
  await expect(page.locator(".w.txt", { hasText: /^pane$/ })).toHaveCount(1);
  const boxText = await page.locator(".w.txt").boundingBox();
  expect(boxText!.height).toBeLessThan(boxNone!.height / 2);
  // Una parola «solo testo» non ha la zona del simbolo: si apre con Alt+↓. «Automatico» toglie la scelta.
  await page.evaluate(() => (window as any).caaProto.setCaret(15));
  await page.keyboard.press("Alt+ArrowDown");
  await page.getByRole("button", { name: "Automatico" }).click();
  await expect(page.locator(".w.txt")).toHaveCount(0);
  await expect(page.locator(".w[style*='--img']", { hasText: /^pane$/ })).toHaveCount(1);
  expect(await docPicks(page)).toHaveLength(0);
});

test("ricerca: la barra è in alto, i risultati sotto, Invio sceglie il primo", async ({ page }) => {
  await open(page, "Marco mangia pane");
  await clickSymbol(page, "pane");
  await expect(page.locator(".pm-cell")).toHaveCount(8);
  await noLock(page);
  await page.locator(".pm-search").click();
  await expect(page.locator(".pm-search")).toBeFocused();
  // Le cifre si scrivono nella ricerca: non scelgono le alternative.
  await page.keyboard.type("zzz");
  await expect(page.locator(".pm-status")).toHaveText("Nessun simbolo trovato");
  await expect(page.locator(".pm-cell")).toHaveCount(0);
  await page.locator(".pm-search").fill("ma1");
  await expect(page.locator(".pm-cell")).toHaveCount(2);
  await expect(page.locator(".pm-num")).toHaveCount(0);
  expect(await docPicks(page)).toHaveLength(0);
  // Cancellando la ricerca tornano le alternative della parola.
  await page.locator(".pm-search").fill("");
  await expect(page.locator(".pm-cell")).toHaveCount(8);
  await expect(page.locator(".pm-num")).toHaveCount(8);
  await page.locator(".pm-search").fill("ma1");
  await expect(page.locator(".pm-cell")).toHaveCount(2);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await docPicks(page))[0]).toMatchObject({ picto: 9001 });
});

test("F8 e il contatore portano alla prossima parola da controllare", async ({ page }) => {
  await open(page, "La sera dubbio.\nMarco dubbio.");
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0);
  await page.evaluate(() => (window as any).caaProto.setCaret(1));
  await page.keyboard.press("F8");
  await expect(page.locator(".pm-head")).toContainText("dubbio");
  expect(await page.evaluate(() => (window as any).caaProto.selection().head)).toBe(9);
  await page.keyboard.press("Escape");
  // Seconda parola dubbia (altro paragrafo), poi giro completo.
  await page.keyboard.press("F8");
  expect(await page.evaluate(() => (window as any).caaProto.selection().head)).toBe(24);
  await page.keyboard.press("Escape");
  await page.locator(".statusbar .link").click();
  await expect(page.locator(".pm-head")).toBeVisible();
  expect(await page.evaluate(() => (window as any).caaProto.selection().head)).toBe(9);
  await page.keyboard.press("Escape");
  // Scegliere un simbolo toglie il dubbio: il contatore scende.
  await page.locator(".side").focus();
  await page.keyboard.press("F8");
  await page.locator(".pm-all input").uncheck();
  await page.keyboard.press("1");
  await expect(page.locator(".statusbar")).toContainText("1 parola da controllare");
});

test("se la parola cambia, la scelta non vale più", async ({ page }) => {
  await open(page, "Marco mangia pane");
  const before = await imgOf(page, "pane");
  await clickSymbol(page, "pane");
  await page.locator(".pm-all input").uncheck();
  await page.locator(".pm-cell").nth(1).click();
  await expect.poll(() => imgOf(page, "pane")).not.toBe(before);
  // Scrivo una lettera in fondo: la parola è un'altra e il motore non riceve più la scelta.
  await page.evaluate(() => (window as any).caaProto.setCaret((window as any).caaProto.docSize() - 1));
  await page.keyboard.type("x");
  await expect(page.locator(".w[style*='--img']", { hasText: /^panex$/ })).toHaveCount(1);
  const last = await page.evaluate(() => {
    const c = (window as any).__mock.calls;
    return c[c.length - 1];
  });
  expect(last.paras[0].text).toBe("Marco mangia panex");
  expect(last.paras[0].forced).toEqual([]);
});

test("il menu si apre in meno di 100 ms @perf", async ({ page }) => {
  await open(page, "Marco mangia pane");
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    await clickSymbol(page, "pane");
    await page.locator(".pm-cell").first().waitFor();
    times.push(Date.now() - t0);
    await page.keyboard.press("Escape");
    await page.locator(".ProseMirror").click({ position: { x: 5, y: 5 } });
  }
  times.sort((a, b) => a - b);
  expect(times[2], `tempi ${times.join(" ")}`).toBeLessThan(100);
});

test("annulla e ripeti una scelta nel testo di esempio, con attese realistiche", async ({ page }) => {
  await open(page, "Marco mangia pane");
  await voceAltro(page, "Testo di esempio"); // M11-4: nel menu «Altro»
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0);
  const marks = () => page.evaluate(() => { const d = (window as any).caaProto.view.state.doc; let n = d.attrs.locks.length; d.descendants((x: any) => { for (const m of x.marks ?? []) if (m.type.name === "pick") n++; }); return n; });
  await page.locator(".w[style*='--img']").nth(4).click({ position: { x: 20, y: 8 } });
  await page.locator(".pm-cell").nth(1).click();
  await page.waitForTimeout(400);
  expect(await marks()).toBe(1);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(800);
  expect(await marks()).toBe(0);
  await page.keyboard.press("Control+y");
  await page.waitForTimeout(400);
  expect(await marks()).toBe(1);
  // Gli stessi passi con i pulsanti della barra, e con Ctrl+Maiusc+Z.
  await page.getByRole("button", { name: "Annulla" }).click();
  await expect.poll(marks).toBe(0);
  await expect(page.getByRole("button", { name: "Annulla" })).toBeDisabled();
  await page.getByRole("button", { name: "Ripeti" }).click();
  await expect.poll(marks).toBe(1);
  await expect(page.getByRole("button", { name: "Ripeti" })).toBeDisabled();
  await page.keyboard.press("Control+z");
  await expect.poll(marks).toBe(0);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(marks).toBe(1);
});

test("F8 porta alla parola anche se è fuori schermo (foglio lungo)", async ({ page }) => {
  const lines = Array.from({ length: 60 }, (_, i) => `Riga numero ${i + 1} con pane e casa.`);
  lines.push("Qui in fondo c'è un dubbio.");
  await open(page, lines.join("\n"));
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0);
  await page.evaluate(() => (window as any).caaProto.setCaret(1));
  await page.evaluate(() => (document.querySelector(".sheet-wrap") as HTMLElement).scrollTo(0, 0));
  await page.keyboard.press("F8");
  await expect(page.locator(".pm-head")).toContainText("dubbio");
  const visible = await page.evaluate(() => {
    const r = document.querySelector(".w.cur")!.getBoundingClientRect();
    const wrap = document.querySelector(".sheet-wrap")!.getBoundingClientRect();
    return r.top >= wrap.top && r.bottom <= wrap.bottom;
  });
  expect(visible).toBe(true);
  // La parola è evidenziata e, se la si cambia, la barra si svuota.
  await expect(page.locator(".w.cur")).toHaveText("dubbio");
  await page.evaluate(() => {
    const p = (window as any).caaProto;
    const r = document.querySelector(".w.cur")!;
    const pos = p.view.posAtDOM(r, 0);
    p.setCaret(pos + 6);
  });
  await page.keyboard.type("x");
  await expect(page.locator(".side .side-empty")).toBeVisible();
  await expect(page.locator(".w.cur")).toHaveCount(0);
});

test("impostazione «Contorna simbolo e parola»: una card per ogni coppia, ricordata", async ({ page }) => {
  await open(page, "Marco mangia pane");
  const card = page.locator(".w", { hasText: /^pane$/ });
  expect(await card.evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe("0px");
  await (await casellaContorno(page)).check();
  expect(await card.evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe("2px");
  await expect(page.locator(".sheet.cards")).toHaveCount(1);
  // Simbolo e parola restano uniti nella card (un solo blocco).
  expect(await page.evaluate(() => (window as any).caaProto.checkWrap().broken)).toBe(0);
  await page.reload();
  await page.waitForFunction(() => (window as any).caaProto);
  await page.evaluate(() => { (window as any).caaProto.enterEngineMode({ symbolize: async () => [], alternatives: async () => [], search: async () => [], listCustom: async () => [], importCustom: async () => ({ id: 0, uuid: '', label: '' }), url: () => "" }); });
  await expect(page.locator(".sheet.cards")).toHaveCount(1);
  await (await casellaContorno(page)).uncheck();
  await expect(page.locator(".sheet.cards")).toHaveCount(0);
});

test("la spunta «usa per tutto il testo» resta com'è dopo una scelta", async ({ page }) => {
  await open(page, "pane e casa");
  await clickSymbol(page, "pane");
  await page.locator(".pm-all input").uncheck();
  await page.locator(".pm-cell").nth(1).click();
  await expect(page.locator(".pm-why")).toContainText("scelto da te");
  await expect(page.locator(".pm-all input")).not.toBeChecked();
  // Anche su un'altra parola resta spenta, finché non la riaccendi.
  await clickSymbol(page, "casa");
  await expect(page.locator(".pm-all input")).not.toBeChecked();
  await expect(page.locator(".w.cur")).toHaveText("casa"); // passando da una parola all'altra la barra non si svuota
  await page.locator(".pm-all input").check();
  await page.locator(".pm-cell").nth(2).click();
  await expect(page.locator(".pm-all input")).toBeChecked();
});

test("F8 ripetuto passa di parola in parola anche con il fuoco nella barra", async ({ page }) => {
  await open(page, "La sera dubbio.\nMarco dubbio.\nUn dubbio ancora.");
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0);
  await page.evaluate(() => (window as any).caaProto.setCaret(1));
  const head = () => page.evaluate(() => (window as any).caaProto.selection().head);
  await page.keyboard.press("F8");
  expect(await head()).toBe(9);
  expect(await page.evaluate(() => document.activeElement?.classList.contains("side"))).toBe(true);
  await page.keyboard.press("F8");
  expect(await head()).toBe(24);
  await page.keyboard.press("F8");
  expect(await head()).toBe(36);
  await page.keyboard.press("F8");
  expect(await head()).toBe(9); // giro completo
  // Il clic sul contatore, ripetuto, fa lo stesso.
  await page.locator(".statusbar .link").click();
  expect(await head()).toBe(24);
  await page.locator(".statusbar .link").click();
  expect(await head()).toBe(36);
  // Una sola parola evidenziata alla volta.
  await expect(page.locator(".w.cur")).toHaveCount(1);
});

// ---- Revisione di M8b ----

test("scrivendo prima della parola mostrata, la scelta va sulla parola giusta", async ({ page }) => {
  await open(page, "Marco mangia pane");
  await clickSymbol(page, "pane");
  await expect(page.locator(".pm-cell")).toHaveCount(8);
  await page.evaluate(() => (window as any).caaProto.setCaret(1));
  await page.keyboard.type("Il ");
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0);
  await noLock(page);
  await page.locator(".pm-cell").nth(1).click();
  await expect.poll(async () => (await docPicks(page)).length).toBe(1);
  const picks = await docPicks(page);
  expect(picks[0]).toMatchObject({ text: "pane", word: "pane", picto: 1002 });
});

test("le alternative che arrivano mentre si cerca non si perdono", async ({ page }) => {
  await open(page, "Marco mangia pane");
  await page.evaluate(() => { (window as any).__mock.altDelay = 500; });
  await clickSymbol(page, "pane");
  await page.locator(".pm-search").fill("ma");
  await expect(page.locator(".pm-cell")).toHaveCount(2);
  await page.waitForTimeout(700); // le alternative arrivano mentre la ricerca è ancora scritta
  await page.locator(".pm-search").fill("");
  await expect(page.locator(".pm-cell")).toHaveCount(8);
  await noLock(page);
  await page.locator(".side").focus();
  await page.keyboard.press("2");
  await expect.poll(async () => (await docPicks(page))[0]).toMatchObject({ picto: 1002 });
});

test("una ricerca appena scritta non rovina la parola scelta subito dopo", async ({ page }) => {
  await open(page, "Marco mangia pane");
  await clickSymbol(page, "pane");
  await page.locator(".pm-search").fill("ca");
  await clickSymbol(page, "mangia"); // entro i 150 ms della ricerca
  await expect(page.locator(".pm-head")).toContainText("mangia");
  await expect(page.locator(".pm-cell")).toHaveCount(8);
  await page.waitForTimeout(400);
  await expect(page.locator(".pm-cell")).toHaveCount(8);
  await noLock(page);
  await page.locator(".side").focus();
  await page.keyboard.press("1");
  await expect.poll(async () => (await docPicks(page))[0]).toMatchObject({ text: "mangia", picto: 1001 });
});

test("copiando e incollando una frase le scelte la seguono", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page, "Marco mangia pane");
  await clickSymbol(page, "pane");
  await page.locator(".pm-all input").uncheck();
  await page.locator(".pm-cell").nth(1).click();
  await expect.poll(async () => (await docPicks(page)).length).toBe(1);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+c");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+v");
  await expect.poll(async () => (await docPicks(page)).length).toBe(2);
});

// ---- M8c-1: politica «Personalizzato» ----

test("«Personalizzato»: una tabella per categoria, subito visibile e ricordata", async ({ page }) => {
  await open(page, "La casa il pane.");
  await expect(page.getByRole("button", { name: "Modifica…" })).toBeHidden();
  await page.selectOption("select[aria-label='Politica delle parole funzionali']", "custom");
  // Si apre la tabella: cinque categorie, con le sole opzioni sensate.
  const dialog = page.locator(".policy-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("tr")).toHaveCount(5);
  await expect(dialog.getByLabel("Articoli").locator("option")).toHaveText(["Simbolo ridotto", "Simbolo pieno", "Solo testo", "Nascosto"]);
  await expect(dialog.getByLabel("Preposizioni").locator("option")).toHaveText(["Simbolo", "Solo testo"]);
  await expect(dialog.getByLabel("Congiunzioni").locator("option")).toHaveText(["Simbolo", "Solo testo"]);
  await expect(dialog.getByLabel("«che»").locator("option")).toHaveText(["Simbolo", "Solo testo", "Nascosto"]);
  await expect(dialog).toContainText("Ausiliari");
  // La tabella parte come «Completo»: articoli ridotti.
  await expect(page.locator(".w.red")).toHaveCount(2);
  // Cambiando una riga il testo cambia subito e il motore riceve la tabella.
  await dialog.getByLabel("Articoli").selectOption("hidden");
  await expect(page.locator(".w.hid")).toHaveCount(2);
  await expect(page.locator(".w.red")).toHaveCount(0);
  const policies = await page.evaluate(() => (window as any).__mock.calls.map((c: { policy: string }) => c.policy));
  expect(policies[policies.length - 1]).toBe("custom:articles=hidden;clitics=full;che=text;preps=full;conj=full");
  await dialog.getByLabel("Articoli").selectOption("text");
  await expect(page.locator(".w.hid")).toHaveCount(0);
  await dialog.getByLabel("Articoli").selectOption("hidden");
  await dialog.getByRole("button", { name: "Chiudi" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Politica delle parole funzionali")).toHaveValue("custom"); // M11-4: la politica non è più ripetuta in basso
  // Tornando a «Completo» e poi a «Personalizzato» la tabella è ancora quella; «Modifica…» la riapre.
  await page.selectOption("select[aria-label='Politica delle parole funzionali']", "complete");
  await expect(page.locator(".w.red")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Modifica…" })).toBeHidden();
  await page.selectOption("select[aria-label='Politica delle parole funzionali']", "custom");
  await expect(page.locator(".w.hid")).toHaveCount(2);
  // La tabella si apre da sola solo la prima volta; poi serve «Modifica…».
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Modifica…" }).click();
  await expect(dialog.getByLabel("Articoli")).toHaveValue("hidden");
});

test("una parola nascosta dalla politica si può correggere dalla barra", async ({ page }) => {
  await open(page, "La casa il pane.");
  await page.selectOption("select[aria-label='Politica delle parole funzionali']", "essential");
  await expect(page.locator(".w.hid")).toHaveCount(2);
  // Clic sulla zona del simbolo di una parola nascosta: la barra si riempie.
  await clickSymbol(page, "La");
  await expect(page.locator(".pm-head")).toContainText("La");
  await expect(page.locator(".pm-cell")).toHaveCount(8);
  await page.locator(".pm-all input").uncheck();
  await page.locator(".pm-cell").nth(1).click();
  // La scelta del docente vince sulla politica: ora "La" ha un simbolo; "il" resta nascosto.
  await expect(page.locator(".w.hid")).toHaveCount(1);
  await expect(page.locator(".w[style*='--img']", { hasText: /^La$/ })).toHaveCount(1);
  // Anche con Alt+↓ sulla parola nascosta rimasta.
  await page.evaluate(() => (window as any).caaProto.setCaret(10));
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.locator(".pm-head")).toContainText("il");
});

// ---- M8c-2: unisci e dividi parole ----

const selectText = (page: Page, from: number, to: number) => page.evaluate(([a, b]) => (window as any).caaProto.setCaret(a, b), [from, to]);

test("Unisci: le parole selezionate diventano un simbolo solo, Dividi le separa, tutto con annulla", async ({ page }) => {
  await open(page, "Vado a scuola con la cartella.");
  await expect(page.getByRole("button", { name: "Unisci" })).toBeDisabled();
  // Seleziono «scuola con» (offset 7–17 nel paragrafo, +1 nel documento).
  await selectText(page, 1 + 7, 1 + 17);
  await expect(page.getByRole("button", { name: "Unisci" })).toBeEnabled();
  await page.getByRole("button", { name: "Unisci" }).click();
  // Il mark e il simbolo: la prima parola porta l'immagine, la seconda è attenuata.
  const marks = () => page.evaluate(() => { const out: any[] = []; (window as any).caaProto.view.state.doc.descendants((n: any) => { for (const m of n.marks ?? []) if (m.type.name === "group") out.push({ text: n.text, ...m.attrs }); }); return out; });
  await expect.poll(async () => (await marks()).length).toBeGreaterThan(0);
  expect((await marks()).map((m) => m.text).join("")).toBe("scuola con");
  expect((await marks())[0]).toMatchObject({ mode: "merge", text: "scuola con" });
  await expect(page.locator(".w.hid", { hasText: /^con$/ })).toHaveCount(1);
  await expect(page.locator(".w[style*='--img']", { hasText: /^scuola$/ })).toHaveCount(1);
  const last = await page.evaluate(() => { const c = (window as any).__mock.calls; return c[c.length - 1]; });
  expect(last.paras[0].forced).toContainEqual({ s: 7, e: 17, picto: 4294967294 });
  // Un clic sul simbolo (o su una parola del gruppo) mostra tutta la frase nella barra, con «Dividi».
  await clickSymbol(page, "scuola");
  await expect(page.locator(".pm-titles strong")).toHaveText("scuola con");
  await expect(page.locator(".pm-all input")).toBeDisabled(); // un gruppo non ha un lemma solo
  await expect(page.locator(".w.cur")).toHaveCount(2); // l'evidenziazione copre il gruppo
  await page.locator(".side").getByRole("button", { name: "Dividi" }).click();
  await expect.poll(async () => (await marks()).length).toBe(0);
  await expect(page.locator(".w.hid", { hasText: /^con$/ })).toHaveCount(0);
  // Annulla riporta l'unione.
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await marks()).length).toBeGreaterThan(0);
  await expect(page.locator(".w.hid", { hasText: /^con$/ })).toHaveCount(1);
});

test("Unisci non si può fare con la punteggiatura in mezzo, fra paragrafi o con una parola sola", async ({ page }) => {
  await open(page, "pane, casa mare\nsole");
  // Con la virgola in mezzo.
  await selectText(page, 1, 10);
  await expect(page.getByRole("button", { name: "Unisci" })).toBeDisabled();
  await page.keyboard.press("Control+Shift+u");
  await expect(page.locator(".toasts")).toContainText("senza punteggiatura"); // M11-3: i messaggi sono notifiche
  expect(await page.evaluate(() => JSON.stringify((window as any).caaProto.docJSON()).includes('"group"'))).toBe(false);
  // Una parola sola e due paragrafi.
  await selectText(page, 1, 5);
  await expect(page.getByRole("button", { name: "Unisci" })).toBeDisabled();
  await selectText(page, 12, 22);
  await expect(page.getByRole("button", { name: "Unisci" })).toBeDisabled();
  // Due parole vicine: sì, con la tastiera.
  await selectText(page, 8, 16);
  await expect(page.getByRole("button", { name: "Unisci" })).toBeEnabled();
  await page.keyboard.press("Control+Shift+u");
  await expect(page.locator(".w.hid", { hasText: /^mare$/ })).toHaveCount(1);
});

test("un'espressione riconosciuta dal motore si divide e si riunisce", async ({ page }) => {
  await open(page, "Vado alla scuola media di Roma.");
  await expect(page.locator(".w.hid", { hasText: /^media$/ })).toHaveCount(1);
  // Cursore dentro «media» (nascosta): Dividi funziona dal cursore e dal clic sul gruppo.
  await page.evaluate(() => (window as any).caaProto.setCaret(1 + 17));
  await expect(page.getByRole("button", { name: "Dividi" })).toBeEnabled();
  await page.keyboard.press("Control+Shift+d");
  await expect(page.locator(".w.hid", { hasText: /^media$/ })).toHaveCount(0);
  const mode = await page.evaluate(() => { let m = ""; (window as any).caaProto.view.state.doc.descendants((n: any) => { for (const k of n.marks ?? []) if (k.type.name === "group") m = k.attrs.mode; }); return m; });
  expect(mode).toBe("split");
  // Ora le due parole sono separate; il pulsante diventa «Riunisci».
  await page.evaluate(() => (window as any).caaProto.setCaret(1 + 17));
  await expect(page.getByRole("button", { name: "Riunisci" })).toBeEnabled();
  await page.getByRole("button", { name: "Riunisci" }).click();
  await expect(page.locator(".w.hid", { hasText: /^media$/ })).toHaveCount(1);
  // Scegliere un simbolo per la testa del gruppo vale solo lì (niente blocco per lemma).
  await clickSymbol(page, "scuola");
  await expect(page.locator(".pm-titles strong")).toHaveText("scuola media");
  await page.locator(".pm-cell").nth(1).click();
  await expect.poll(async () => (await docPicks(page))[0]).toMatchObject({ word: "scuola" });
  expect(await docLocks(page)).toEqual([]);
});

test("scrivendo dentro un'unione, l'unione non vale più", async ({ page }) => {
  await open(page, "Vado a scuola con la cartella.");
  await selectText(page, 1 + 7, 1 + 17);
  await page.keyboard.press("Control+Shift+u");
  await expect(page.locator(".w.hid", { hasText: /^con$/ })).toHaveCount(1);
  await page.evaluate(() => (window as any).caaProto.setCaret(1 + 12));
  await page.keyboard.type("x");
  await expect(page.locator(".w.hid")).toHaveCount(0);
});

// ---- M8c-3: simboli personali ----

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const photo = { name: "foto.png", mimeType: "image/png", buffer: PNG_1X1 };

test("simbolo personale: scelgo l'immagine, la ritaglio e diventa il simbolo della parola", async ({ page }) => {
  await open(page, "Marco mangia pane");
  await clickSymbol(page, "pane");
  await expect(page.getByRole("button", { name: "Simbolo personale…" })).toBeVisible();
  await expect(page.locator(".pm-custom")).toBeHidden(); // ancora nessun simbolo salvato
  await page.locator(".side input[type=file]").setInputFiles(photo);
  const dialog = page.locator(".crop-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("«pane»");
  await expect(dialog).toContainText("Non usare foto di studenti senza l'autorizzazione della scuola");
  expect(await page.locator(".crop-canvas").evaluate((c: HTMLCanvasElement) => [c.width, c.height])).toEqual([320, 320]);
  // Ingrandisco e sposto l'immagine: la finestra resta aperta e nulla è salvato finché non confermo.
  await page.locator(".crop-dialog input[type=range]").fill("2");
  const box = (await page.locator(".crop-canvas").boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 120);
  await page.mouse.up();
  expect(await page.evaluate(() => (window as any).__mock.imports.length)).toBe(0);
  await dialog.getByRole("button", { name: "Usa questo simbolo" }).click();
  await expect(dialog).toBeHidden();
  // Il simbolo è salvato come WebP quadrata e diventa la scelta per la parola (con blocco: «per tutto il testo»).
  const imports = await page.evaluate(() => (window as any).__mock.imports);
  expect(imports).toHaveLength(1);
  expect(imports[0]).toMatchObject({ type: "image/webp", label: "pane" });
  expect(imports[0].size).toBeGreaterThan(20);
  // (con blocco: il simbolo e il suo uuid stanno nei dati del documento, non su una parola)
  await expect.poll(async () => (await docLocks(page))[0]).toMatchObject({ picto: 2147483648, uuid: "uuid-0", lemma: "pane" });
  await expect.poll(() => imgOf(page, "pane")).toContain(encodeURIComponent("hsl(" + (2147483648 % 360)));
  // La barra mostra «I miei simboli» e, annullando, torna il simbolo di prima.
  await expect(page.locator(".pm-custom .pm-mini")).toHaveCount(1);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await docLocks(page)).length).toBe(0);
});

test("simbolo personale: annullando non si salva niente", async ({ page }) => {
  await open(page, "Marco mangia pane");
  await clickSymbol(page, "pane");
  await page.locator(".side input[type=file]").setInputFiles(photo);
  await expect(page.locator(".crop-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".crop-overlay")).toHaveCount(0);
  await page.locator(".side input[type=file]").setInputFiles(photo);
  await page.locator(".crop-dialog").getByRole("button", { name: "Annulla" }).click();
  await expect(page.locator(".crop-overlay")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__mock.imports.length)).toBe(0);
  expect(await docPicks(page)).toHaveLength(0);
});

test("un file che non è un'immagine non apre il ritaglio e avvisa", async ({ page }) => {
  await open(page, "Marco mangia pane");
  await clickSymbol(page, "pane");
  await page.locator(".side input[type=file]").setInputFiles({ name: "rotto.png", mimeType: "image/png", buffer: Buffer.from("non sono un'immagine") });
  await expect(page.locator(".toasts")).toContainText("Non riesco a leggere questa immagine"); // M11-3: i messaggi sono notifiche
  await expect(page.locator(".crop-overlay")).toHaveCount(0);
});

test("i miei simboli si riusano per un'altra parola, si trovano per etichetta e vengono per primi", async ({ page }) => {
  await open(page, "Marco mangia pane e pane");
  await clickSymbol(page, "pane", 0);
  await page.locator(".pm-all input").uncheck();
  await page.locator(".side input[type=file]").setInputFiles(photo);
  await page.locator(".crop-dialog").getByRole("button", { name: "Usa questo simbolo" }).click();
  await expect.poll(async () => (await docPicks(page)).length).toBe(1);
  // Riuso su un'altra parola con un clic su «I miei simboli».
  await clickSymbol(page, "mangia");
  await expect(page.locator(".pm-custom .pm-mini")).toHaveCount(1);
  await page.locator(".pm-all input").uncheck();
  await page.locator(".pm-custom .pm-mini").click();
  await expect.poll(async () => (await docPicks(page)).map((p) => p.word).sort()).toEqual(["mangia", "pane"]);
  expect((await docPicks(page)).find((p) => p.word === "mangia")).toMatchObject({ picto: 2147483648, uuid: "uuid-0" });
  // Per l'altra occorrenza di «pane» il simbolo personale con la stessa etichetta è la prima alternativa.
  await clickSymbol(page, "pane", 1);
  await expect(page.locator(".pm-cell").first().locator(".pm-kw")).toHaveText("pane");
  await expect(page.locator(".pm-cell").first()).toHaveAttribute("title", "simbolo personale");
  // La ricerca trova il simbolo personale per etichetta, prima dei pittogrammi.
  await page.locator(".pm-search").fill("pan");
  await expect(page.locator(".pm-cell").first()).toHaveAttribute("title", "simbolo personale");
  await expect(page.locator(".pm-cell")).toHaveCount(3);
});

// ---- Revisione di M8c ----

test("un simbolo personale scelto dalla griglia porta il suo uuid", async ({ page }) => {
  await open(page, "Marco mangia pane e pane");
  await clickSymbol(page, "pane", 0);
  await page.locator(".pm-all input").uncheck();
  await page.locator(".side input[type=file]").setInputFiles(photo);
  await page.locator(".crop-dialog").getByRole("button", { name: "Usa questo simbolo" }).click();
  await expect.poll(async () => (await docPicks(page)).length).toBe(1);
  await clickSymbol(page, "pane", 1);
  await page.locator(".pm-all input").uncheck();
  await page.locator(".pm-cell").first().click(); // il simbolo personale con l'etichetta «pane»
  await expect.poll(async () => (await docPicks(page)).length).toBe(2);
  expect((await docPicks(page)).map((p) => p.uuid)).toEqual(["uuid-0", "uuid-0"]);
  // Anche dalla ricerca (Invio).
  await clickSymbol(page, "mangia");
  await page.locator(".pm-all input").uncheck();
  await page.locator(".pm-search").fill("pan");
  await expect(page.locator(".pm-cell").first()).toHaveAttribute("title", "simbolo personale");
  await page.locator(".pm-search").press("Enter");
  await expect.poll(async () => (await docPicks(page)).length).toBe(3);
  expect((await docPicks(page)).find((p) => p.word === "mangia")).toMatchObject({ uuid: "uuid-0" });
});

test("Unisci non scioglie un «per tutto il testo»: il blocco sta nel documento", async ({ page }) => {
  await open(page, "pesca e pesca noce");
  const automatic = await imgOf(page, "pesca");
  await clickSymbol(page, "pesca", 1);
  await page.locator(".pm-cell").nth(1).click(); // con blocco: «per tutto il testo»
  await expect.poll(async () => (await docLocks(page)).length).toBe(1);
  await expect.poll(() => imgOf(page, "pesca")).not.toBe(automatic);
  const first = await imgOf(page, "pesca");
  await selectText(page, 1 + 8, 1 + 18); // «pesca noce» diventa un gruppo
  await page.keyboard.press("Control+Shift+u");
  await expect.poll(() => page.evaluate(() => JSON.stringify((window as any).caaProto.docJSON()).includes('"merge"'))).toBe(true);
  expect(await docLocks(page)).toHaveLength(1);
  // La prima «pesca», fuori dal gruppo, ha ancora il simbolo del blocco.
  await expect.poll(() => imgOf(page, "pesca")).toBe(first);
});

test("Dividi e Riunisci tolgono le scelte fatte sul gruppo", async ({ page }) => {
  await open(page, "Vado alla scuola media di Roma.");
  await clickSymbol(page, "scuola");
  await page.locator(".pm-cell").nth(1).click(); // un'alternativa per la frase
  await expect.poll(async () => (await docPicks(page)).length).toBe(1);
  await page.locator(".side").getByRole("button", { name: "Dividi" }).click();
  // Dopo la divisione «scuola» torna con il suo simbolo, non quello scelto per la frase.
  await expect.poll(async () => (await docPicks(page)).length).toBe(0);
});

test("Unisci non tocca una divisione già fatta", async ({ page }) => {
  await open(page, "Vado alla scuola media di Roma.");
  await page.evaluate(() => (window as any).caaProto.setCaret(1 + 17));
  await page.keyboard.press("Control+Shift+d"); // divide «scuola media»
  await expect.poll(() => page.evaluate(() => JSON.stringify((window as any).caaProto.docJSON()).includes('"split"'))).toBe(true);
  await selectText(page, 1 + 17, 1 + 25); // «media di», dentro la divisione
  await page.keyboard.press("Control+Shift+u");
  await expect(page.locator(".toasts")).toContainText("Riunisci"); // M11-3: i messaggi sono notifiche
  const marks = await page.evaluate(() => JSON.stringify((window as any).caaProto.docJSON()));
  expect(marks.includes('"merge"')).toBe(false);
  expect(marks.includes('"split"')).toBe(true);
});

test("una parola con l'apostrofo non si può «unire» con se stessa", async ({ page }) => {
  await open(page, "Vado dell'acqua fresca");
  await selectText(page, 1 + 5, 1 + 15); // «dell'acqua»: una parola sola
  await expect(page.getByRole("button", { name: "Unisci" })).toBeDisabled();
  await selectText(page, 1 + 5, 1 + 22); // «dell'acqua fresca»: due parole
  await expect(page.getByRole("button", { name: "Unisci" })).toBeEnabled();
});

// ---- M9a: documenti personali, salvataggio automatico, pannello Documenti ----

const mockSaves = (page: Page) => page.evaluate(() => (window as any).__mock.saves as any[]);
const saveStatus = (page: Page) => page.locator(".save-status");

test("salvataggio automatico: un documento vuoto non si salva, uno con testo sì, sempre sullo stesso file", async ({ page }) => {
  await open(page, "", true);
  await expect(page.locator(".docbar")).toBeVisible();
  await page.waitForTimeout(400);
  expect(await mockSaves(page)).toHaveLength(0);
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("La storia del gatto Pepe");
  await expect.poll(async () => (await mockSaves(page)).length).toBe(1);
  const first = (await mockSaves(page))[0];
  // Titolo dalla prima riga, preferenze del documento, nessun file ancora, documento e lessico.
  expect(first).toMatchObject({ file: null, title: "La storia del gatto Pepe", prefs: { preset: "complete", size: 68, cards: false } });
  expect(JSON.stringify(first.document)).toContain("La storia del gatto Pepe");
  await expect(saveStatus(page)).toContainText("Salvato alle");
  await expect(page.locator(".doc-title")).toHaveValue("La storia del gatto Pepe");
  // Scrivendo ancora si salva lo stesso file, con la revisione avanti.
  await page.keyboard.type(" e la mamma");
  await expect.poll(async () => (await mockSaves(page)).length).toBe(2);
  const second = (await mockSaves(page))[1];
  expect(second.file).toBe("La storia del gatto Pepe.caa");
  expect(second.rev).toBe(1);
  expect(await page.evaluate(() => (window as any).__mock.docsStore.size)).toBe(1);
});

test("il titolo scritto dal docente si salva e le preferenze cambiate fanno salvare", async ({ page }) => {
  await open(page, "", true);
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Prima riga");
  await expect.poll(async () => (await mockSaves(page)).length).toBe(1);
  await page.locator(".doc-title").fill("Storia sociale: il bus");
  await expect.poll(async () => (await mockSaves(page)).length).toBe(2);
  expect((await mockSaves(page))[1].title).toBe("Storia sociale: il bus");
  // Una preferenza (la dimensione dei simboli, il contorno, la politica) cambia e il documento si salva.
  await page.getByRole("button", { name: "Grande", exact: true }).click();
  await expect.poll(async () => (await mockSaves(page)).length).toBe(3);
  expect((await mockSaves(page))[2].prefs.size).toBe(94);
  await (await casellaContorno(page)).check();
  await expect.poll(async () => (await mockSaves(page)).length).toBe(4);
  expect((await mockSaves(page))[3].prefs.cards).toBe(true);
  await page.selectOption("select[aria-label='Politica delle parole funzionali']", "essential");
  await expect.poll(async () => (await mockSaves(page)).length).toBe(5);
  expect((await mockSaves(page))[4].prefs.preset).toBe("essential");
});

test("«Documenti»: elenco, apertura con tutte le scelte, documento nuovo e eliminazione", async ({ page }) => {
  await open(page, "", true);
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Pesca e pesca noce");
  await expect.poll(async () => (await mockSaves(page)).length).toBe(1);
  // Scelte del docente di ogni tipo: un blocco, una scelta su una parola, un'unione, la tabella e la dimensione.
  await clickSymbol(page, "pesca", 0);
  await page.locator(".pm-cell").nth(1).click(); // blocco «per tutto il testo»
  await expect.poll(async () => (await docLocks(page)).length).toBe(1);
  await clickSymbol(page, "noce");
  await noLock(page);
  await page.locator(".pm-cell").nth(2).click();
  await selectText(page, 1, 6); // «Pesca»
  await page.getByRole("button", { name: "Piccolo" }).click();
  await page.selectOption("select[aria-label='Politica delle parole funzionali']", "custom");
  await page.locator(".policy-dialog").getByLabel("Articoli").selectOption("hidden");
  await page.locator(".policy-dialog").getByRole("button", { name: "Chiudi" }).click();
  await expect.poll(async () => (await mockSaves(page)).at(-1)?.prefs.table?.articles).toBe("hidden");
  const saved = (await mockSaves(page)).at(-1);
  expect(saved.sense_locks).toEqual([{ lemma: "pesca", cat: "NOUN", picto: 1002, uuid: "" }]);
  expect(saved.prefs).toMatchObject({ preset: "custom", size: 45 });
  // Un documento nuovo: vuoto, politica «Completo», e quello di prima è salvato.
  await page.getByRole("button", { name: "Nuovo" }).click();
  await expect(page.locator(".doc-title")).toHaveValue("");
  expect(await page.evaluate(() => (window as any).caaProto.view.state.doc.textContent)).toBe("");
  expect(await docLocks(page)).toEqual([]);
  expect(await page.locator("select[aria-label='Politica delle parole funzionali']").inputValue()).toBe("complete");
  await page.keyboard.type("Un altro documento");
  await expect.poll(async () => (await mockSaves(page)).at(-1)?.title).toBe("Un altro documento");
  expect(await page.evaluate(() => (window as any).__mock.docsStore.size)).toBe(2);
  // Il pannello: elenco con i due documenti, il corrente evidenziato; le schede.
  await page.getByRole("button", { name: "Documenti" }).click();
  const panel = page.locator(".docs-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".docs-row")).toHaveCount(2);
  await expect(panel.locator(".docs-row.current")).toContainText("Un altro documento");
  await expect(panel).toContainText("Cartella: Documenti/CAA");
  await panel.getByRole("tab", { name: "Biblioteca" }).click(); // M11-6: le schede hanno il ruolo «tab»
  await expect(panel).toContainText("non è disponibile in questa versione");
  await panel.getByRole("tab", { name: "I miei documenti" }).click();
  // Apro il primo: ritrovo testo, blocco, scelta, tabella, dimensione.
  await panel.locator(".docs-row", { hasText: "Pesca e pesca noce" }).getByRole("button", { name: "Apri" }).click();
  await expect(panel).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).caaProto.view.state.doc.textContent)).toBe("Pesca e pesca noce");
  expect(await docLocks(page)).toEqual([{ lemma: "pesca", cat: "NOUN", picto: 1002, uuid: "" }]);
  expect((await docPicks(page)).map((p) => p.word)).toEqual(["noce"]);
  expect(await page.locator("select[aria-label='Politica delle parole funzionali']").inputValue()).toBe("custom");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--sym"))).toBe("45px");
  await expect(page.locator(".w.hid")).toHaveCount(0); // (nessun articolo nel testo)
  await expect(page.locator(".doc-title")).toHaveValue("Pesca e pesca noce");
  // Aprire un documento non lo riscrive da solo: nessun salvataggio in più finché non lo si modifica.
  const count = (await mockSaves(page)).length;
  await page.waitForTimeout(500);
  expect(await mockSaves(page)).toHaveLength(count);
  // Elimino quello aperto: il documento resta in pagina ma non ha più un file.
  await page.getByRole("button", { name: "Documenti" }).click();
  await azioneRiga(page.locator(".docs-panel .docs-row.current"), "Elimina"); // M11-6: nel menu «⋯» della riga
  await expect(page.locator(".docs-panel .docs-row")).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__mock.docsStore.size)).toBe(1);
  await page.locator(".docs-panel").getByRole("button", { name: "Chiudi" }).click();
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await expect.poll(async () => (await mockSaves(page)).at(-1)?.file).toBeNull();
});

test("i simboli personali di un documento prendono l'id di questo computer", async ({ page }) => {
  await open(page, "", true);
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Mamma e papà");
  await expect.poll(async () => (await mockSaves(page)).length).toBe(1);
  // Un documento scritto su un altro PC: i simboli personali hanno un id loro, qui ne hanno un altro.
  const doc = await page.evaluate(() => {
    const p = (window as any).caaProto;
    const para = p.view.state.schema.nodes.paragraph.create(null, [
      p.view.state.schema.text("Mamma", [p.view.state.schema.marks.pick.create({ word: "mamma", picto: 2147483700, uuid: "u-mamma" })]),
      p.view.state.schema.text(" e papà"),
    ]);
    const d = p.view.state.schema.nodes.doc.create({ locks: [{ lemma: "papà", cat: "NOUN", picto: 2147483701, uuid: "u-papa" }] }, [para]);
    const stored = { file: "Famiglia.caa", entry: { file: "Famiglia.caa", id: "id-x", title: "Famiglia", modified: new Date().toISOString(), rev: 1, author: "X", origin: null }, payload: { document: d.toJSON(), prefs: {}, render: [], sense_locks: [], lexicon: "" } };
    (window as any).__mock.docsStore.set("Famiglia.caa", stored);
    (window as any).__mock.mediaMap = [{ uuid: "u-mamma", id: 2147484000 }, { uuid: "u-papa", id: 2147484001 }];
    return true;
  });
  expect(doc).toBe(true);
  await page.getByRole("button", { name: "Documenti" }).click();
  await page.locator(".docs-row", { hasText: "Famiglia" }).getByRole("button", { name: "Apri" }).click();
  await expect.poll(async () => (await docPicks(page))[0]).toMatchObject({ word: "mamma", picto: 2147484000, uuid: "u-mamma" });
  expect(await docLocks(page)).toEqual([{ lemma: "papà", cat: "NOUN", picto: 2147484001, uuid: "u-papa" }]);
  // Riscrivendolo, il documento porta gli uuid dei simboli usati.
  await page.keyboard.type(" ");
  await expect.poll(async () => (await mockSaves(page)).at(-1)?.media?.sort()).toEqual(["u-mamma", "u-papa"]);
});

test("un documento di uno schema più recente si apre in sola lettura e non si salva", async ({ page }) => {
  await open(page, "", true);
  await page.evaluate(() => {
    const p = (window as any).caaProto;
    const d = p.view.state.schema.nodes.doc.create(null, [p.view.state.schema.nodes.paragraph.create(null, p.view.state.schema.text("Scritto dal futuro"))]);
    (window as any).__mock.docsStore.set("Futuro.caa", { entry: { file: "Futuro.caa", id: "id-f", title: "Futuro", modified: new Date().toISOString(), rev: 9, author: "X", origin: null }, payload: { document: d.toJSON(), prefs: {}, render: [], sense_locks: [], lexicon: "" } });
    (window as any).__mock.readOnly["Futuro.caa"] = true;
  });
  await page.getByRole("button", { name: "Documenti" }).click();
  await page.locator(".docs-row", { hasText: "Futuro" }).getByRole("button", { name: "Apri" }).click();
  await expect(page.locator(".banner")).toContainText("solo in lettura");
  await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "false");
  await expect(saveStatus(page)).toHaveText("Sola lettura");
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("non deve entrare");
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as any).caaProto.view.state.doc.textContent)).toBe("Scritto dal futuro");
  expect(await mockSaves(page)).toHaveLength(0);
  // Un documento nuovo toglie la sola lettura.
  await page.getByRole("button", { name: "Nuovo" }).click();
  await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "true");
  await expect(page.locator(".banner")).toBeHidden();
});

test("se il salvataggio non riesce lo dice e riprova da solo", async ({ page }) => {
  await open(page, "", true);
  await page.evaluate(() => { (window as any).__mock.saveFail = 2; });
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Testo importante");
  await expect(saveStatus(page)).toContainText("Non salvato");
  await expect(saveStatus(page)).toHaveClass(/warn/);
  // Al terzo tentativo riesce.
  await expect(saveStatus(page)).toContainText("Salvato alle");
  expect(await page.evaluate(() => (window as any).__mock.docsStore.size)).toBe(1);
  expect((await mockSaves(page)).length).toBeGreaterThanOrEqual(3);
});

test("file che non si leggono: l'elenco lo dice; un documento non valido non si apre", async ({ page }) => {
  await open(page, "", true);
  await page.evaluate(() => {
    (window as any).__mock.broken = 2;
    (window as any).__mock.docsStore.set("Strano.caa", { entry: { file: "Strano.caa", id: "id-s", title: "Strano", modified: new Date().toISOString(), rev: 1, author: "X", origin: null }, payload: { document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "inventato" }] }] }] }, prefs: {}, render: [], sense_locks: [], lexicon: "" } });
  });
  await page.getByRole("button", { name: "Documenti" }).click();
  await expect(page.locator(".docs-panel")).toContainText("2 file non si leggono");
  await page.locator(".docs-row", { hasText: "Strano" }).getByRole("button", { name: "Apri" }).click();
  await expect(page.locator(".docs-panel")).toContainText("il documento non è valido");
  // L'editor è rimasto com'era.
  expect(await page.evaluate(() => (window as any).caaProto.view.state.doc.textContent)).toBe("");
});

// ---- M9a: render.json e lessico nuovo ----

/** Un documento salvato con il lessico «vecchio»: «mangia» e «pane» avevano altri simboli (il motore finto ne dà di nuovi). */
async function storeOldDoc(page: Page, opts: { lexicon?: string; render?: boolean } = {}): Promise<void> {
  await page.evaluate(
    ([lexicon, withRender]) => {
      const p = (window as any).caaProto;
      const para = p.view.state.schema.nodes.paragraph.create(null, p.view.state.schema.text("Marco mangia pane"));
      const d = p.view.state.schema.nodes.doc.create(null, [para]);
      const render = withRender ? [{ i: 0, text: "Marco mangia pane", tokens: [[0, 5, 768, "full", 0], [6, 12, 5001, "full", 0], [13, 17, 5002, "full", 0]] }] : [];
      (window as any).__mock.docsStore.set("Vecchio.caa", { entry: { file: "Vecchio.caa", id: "id-v", title: "Vecchio", modified: new Date().toISOString(), rev: 1, author: "X", origin: null }, payload: { document: d.toJSON(), prefs: {}, render, sense_locks: [], lexicon } });
    },
    [opts.lexicon ?? "lex-old", opts.render ?? true] as const,
  );
}

const hue = (id: number) => encodeURIComponent("hsl(" + (id % 360));
async function openStored(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: "Documenti" }).click();
  await page.locator(".docs-row", { hasText: title }).getByRole("button", { name: "Apri" }).click();
}

test("render.json: al salvataggio i simboli risolti vanno nel documento (senza i simboli personali)", async ({ page }) => {
  await open(page, "", true);
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Marco mangia pane.");
  await expect.poll(async () => (await mockSaves(page)).length).toBeGreaterThan(0);
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0);
  await page.keyboard.type(" ");
  await expect.poll(async () => (await mockSaves(page)).at(-1)?.render?.length).toBe(1);
  const last = (await mockSaves(page)).at(-1);
  expect(last.lexicon).toBe("lex-new");
  expect(last.render[0].i).toBe(0);
  expect(last.render[0].text).toMatch(/^Marco mangia pane\.\s?$/);
  // Parole con intervallo, pittogramma, visualizzazione e segni; la punteggiatura non c'è.
  expect(last.render[0].tokens).toEqual([[0, 5, 768, "full", 0], [6, 12, 769, "full", 0], [13, 17, 788, "full", 0]]);
});

test("un documento salvato con un lessico più vecchio si apre con i simboli vecchi e la barra chiede cosa fare", async ({ page }) => {
  await open(page, "", true);
  await storeOldDoc(page);
  await openStored(page, "Vecchio");
  await expect(page.locator(".lexbar")).toContainText("cambierebbe 2 simboli");
  // Si vedono i simboli VECCHI (5001 e 5002); «Marco» non è cambiato.
  await expect.poll(() => imgOf(page, "mangia")).toContain(hue(5001));
  expect(await imgOf(page, "pane")).toContain(hue(5002));
  expect(await imgOf(page, "Marco")).toContain(hue(768));
  // Un salvataggio nel frattempo (una modifica altrove) non fa passare di nascosto il lessico nuovo.
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Ciao a tutti");
  await expect.poll(async () => (await mockSaves(page)).length).toBeGreaterThan(0);
  const pending = (await mockSaves(page)).at(-1);
  expect(pending.lexicon).toBe("lex-old");
  expect(pending.render[0].tokens.map((t: number[]) => t[2])).toContain(5001);
  await expect(page.locator(".lexbar")).toContainText("cambierebbe");
});

test("lessico nuovo: «Applica tutti» usa i simboli nuovi e salva con il lessico nuovo", async ({ page }) => {
  await open(page, "", true);
  await storeOldDoc(page);
  await openStored(page, "Vecchio");
  await expect(page.locator(".lexbar")).toBeVisible();
  await page.locator(".lexbar").getByRole("button", { name: "Applica tutti" }).click();
  await expect(page.locator(".lexbar")).toBeHidden();
  await expect.poll(() => imgOf(page, "mangia")).toContain(hue(769));
  expect(await imgOf(page, "pane")).toContain(hue(788));
  expect(await docPicks(page)).toHaveLength(0);
  await expect.poll(async () => (await mockSaves(page)).at(-1)?.lexicon).toBe("lex-new");
});

test("lessico nuovo: «Mantieni i vecchi» li fissa come scelte del docente", async ({ page }) => {
  await open(page, "", true);
  await storeOldDoc(page);
  await openStored(page, "Vecchio");
  await page.locator(".lexbar").getByRole("button", { name: "Mantieni i vecchi" }).click();
  await expect(page.locator(".lexbar")).toBeHidden();
  await expect.poll(async () => (await docPicks(page)).map((p) => [p.word, p.picto])).toEqual([["mangia", 5001], ["pane", 5002]]);
  await expect.poll(() => imgOf(page, "mangia")).toContain(hue(5001));
  await expect.poll(async () => (await mockSaves(page)).at(-1)?.lexicon).toBe("lex-new");
  // Annulla toglie le scelte fissate in un solo passo.
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await docPicks(page)).length).toBe(0);
});

test("lessico nuovo: «Rivedi» una parola alla volta", async ({ page }) => {
  await open(page, "", true);
  await storeOldDoc(page);
  await openStored(page, "Vecchio");
  await page.locator(".lexbar").getByRole("button", { name: "Rivedi" }).click();
  await expect(page.locator(".lexbar")).toContainText("Parola 1 di 2: «mangia»");
  await expect(page.locator(".w.cur")).toHaveText("mangia");
  await expect(page.locator(".lex-thumb img")).toHaveCount(2);
  // Salta passa alla successiva; Fine torna al riepilogo.
  await page.locator(".lexbar").getByRole("button", { name: "Salta" }).click();
  await expect(page.locator(".lexbar")).toContainText("Parola 2 di 2: «pane»");
  await page.locator(".lexbar").getByRole("button", { name: "Fine revisione" }).click();
  await expect(page.locator(".lexbar")).toContainText("cambierebbe 2 simboli");
  // Una decisione per ciascuna: «mangia» → nuovo; «pane» → vecchio.
  await page.locator(".lexbar").getByRole("button", { name: "Rivedi" }).click();
  await page.locator(".lexbar").getByRole("button", { name: "Usa il nuovo" }).click();
  await expect.poll(() => imgOf(page, "mangia")).toContain(hue(769));
  await expect(page.locator(".lexbar")).toContainText("Parola 1 di 1: «pane»");
  await page.locator(".lexbar").getByRole("button", { name: "Tieni il vecchio" }).click();
  await expect(page.locator(".lexbar")).toBeHidden();
  await expect.poll(async () => (await docPicks(page)).map((p) => [p.word, p.picto])).toEqual([["pane", 5002]]);
  await expect.poll(() => imgOf(page, "pane")).toContain(hue(5002));
  await expect.poll(async () => (await mockSaves(page)).at(-1)?.lexicon).toBe("lex-new");
});

test("lessico uguale, o documento senza istantanea: nessuna barra", async ({ page }) => {
  await open(page, "", true);
  await storeOldDoc(page, { lexicon: "lex-new" });
  await openStored(page, "Vecchio");
  await expect(page.locator(".w", { hasText: /^pane$/ })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.locator(".lexbar")).toBeHidden();
  expect(await imgOf(page, "pane")).toContain(hue(788)); // i simboli sono quelli del motore
  await page.evaluate(() => (window as any).__mock.docsStore.delete("Vecchio.caa"));
  await storeOldDoc(page, { lexicon: "lex-old", render: false });
  await openStored(page, "Vecchio");
  await expect(page.locator(".w", { hasText: /^pane$/ })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.locator(".lexbar")).toBeHidden();
});

test("un lessico nuovo che non cambia niente non disturba", async ({ page }) => {
  await open(page, "", true);
  await page.evaluate(() => {
    const p = (window as any).caaProto;
    const para = p.view.state.schema.nodes.paragraph.create(null, p.view.state.schema.text("Marco mangia pane"));
    const d = p.view.state.schema.nodes.doc.create(null, [para]);
    const same = [{ i: 0, text: "Marco mangia pane", tokens: [[0, 5, 768, "full", 0], [6, 12, 769, "full", 0], [13, 17, 788, "full", 0]] }];
    (window as any).__mock.docsStore.set("Uguale.caa", { entry: { file: "Uguale.caa", id: "id-u", title: "Uguale", modified: new Date().toISOString(), rev: 1, author: "X", origin: null }, payload: { document: d.toJSON(), prefs: {}, render: same, sense_locks: [], lexicon: "lex-old" } });
  });
  await openStored(page, "Uguale");
  await expect(page.locator(".w", { hasText: /^pane$/ })).toBeVisible();
  await page.waitForTimeout(400);
  await expect(page.locator(".lexbar")).toBeHidden();
  // Nessuna differenza: il documento si riscrive con il lessico nuovo alla prima modifica o subito.
  await expect.poll(async () => (await mockSaves(page)).at(-1)?.lexicon).toBe("lex-new");
});

// ---- Revisione di M9a ----

async function storeDoc(page: Page, file: string, text: string, extra: Record<string, unknown> = {}): Promise<void> {
  await page.evaluate(
    ([f, t, ex]) => {
      const p = (window as any).caaProto;
      const para = p.view.state.schema.nodes.paragraph.create(null, p.view.state.schema.text(t));
      const d = p.view.state.schema.nodes.doc.create(null, [para]);
      const title = f.replace(/\.caa$/, "");
      (window as any).__mock.docsStore.set(f, { entry: { file: f, id: "id-" + f, title, modified: new Date().toISOString(), rev: 1, author: "X", origin: null }, payload: { document: d.toJSON(), prefs: {}, render: [], sense_locks: [], lexicon: "lex-new", ...ex } });
    },
    [file, text, extra] as const,
  );
}

const storedText = (page: Page, file: string) =>
  page.evaluate((f) => {
    const v = (window as any).__mock.docsStore.get(f);
    return v ? JSON.stringify(v.payload.document) : null;
  }, file);

test("un salvataggio lento non scrive un documento sull'altro (Apri)", async ({ page }) => {
  await open(page, "", true);
  await storeDoc(page, "B.caa", "Documento B");
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Documento A");
  await expect.poll(async () => (await mockSaves(page)).length).toBe(1);
  await page.evaluate(() => { (window as any).__mock.saveDelay = 1800; });
  await page.keyboard.type("!");
  await expect.poll(async () => (await mockSaves(page)).length).toBe(2); // il salvataggio lento è partito
  await page.getByRole("button", { name: "Documenti" }).click();
  await page.locator(".docs-row", { hasText: "B" }).getByRole("button", { name: "Apri" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).caaProto.view.state.doc.textContent), { timeout: 8000 }).toBe("Documento B");
  await page.waitForTimeout(4500); // tempo per un eventuale salvataggio sbagliato
  expect(await storedText(page, "A.caa")).toBeNull(); // (il file di A si chiama «Documento A.caa»)
  expect(await storedText(page, "Documento A.caa")).toContain("Documento A!");
  expect(await storedText(page, "B.caa")).toContain("Documento B");
  expect(await storedText(page, "B.caa")).not.toContain("Documento A");
  await expect(page.locator(".doc-title")).toHaveValue("B");
  const saves = await mockSaves(page);
  expect(saves.filter((s: any) => s.file === "B.caa")).toHaveLength(0);
});

test("un salvataggio lento non scrive un documento vuoto sopra il precedente (Nuovo)", async ({ page }) => {
  await open(page, "", true);
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Testo importante");
  await expect.poll(async () => (await mockSaves(page)).length).toBe(1);
  await page.evaluate(() => { (window as any).__mock.saveDelay = 1800; });
  await page.keyboard.type("!");
  await expect.poll(async () => (await mockSaves(page)).length).toBe(2);
  await page.getByRole("button", { name: "Nuovo" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).caaProto.view.state.doc.textContent), { timeout: 8000 }).toBe("");
  await page.waitForTimeout(4500);
  expect(await storedText(page, "Testo importante.caa")).toContain("Testo importante!");
  await expect(page.locator(".doc-title")).toHaveValue("");
  expect(await page.evaluate(() => (window as any).__mock.docsStore.size)).toBe(1);
});

test("il titolo scritto mentre si salva non viene annullato", async ({ page }) => {
  await open(page, "", true);
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Documento A");
  await expect.poll(async () => (await mockSaves(page)).length).toBe(1);
  await page.evaluate(() => { (window as any).__mock.saveDelay = 700; });
  await page.keyboard.type("!");
  await expect.poll(async () => (await mockSaves(page)).length).toBe(2); // salvataggio lento in corso
  await page.locator(".doc-title").fill("Titolo mio");
  await page.waitForTimeout(1500);
  await expect(page.locator(".doc-title")).toHaveValue("Titolo mio");
  await expect.poll(async () => (await mockSaves(page)).at(-1)?.title).toBe("Titolo mio");
});

test("chiudendo la finestra si aspetta il salvataggio e, se non riesce, si chiede conferma", async ({ page }) => {
  await open(page, "", true);
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Prima parte");
  await expect.poll(async () => (await mockSaves(page)).length).toBe(1);
  // Salvataggio lento: la chiusura lo aspetta tutto (anche oltre un secondo) e poi esce.
  await page.evaluate(() => { (window as any).__mock.saveDelay = 1600; });
  await page.keyboard.type(" e seconda parte");
  const closed = await page.evaluate(() => (window as any).caaProto.closeRequest());
  expect(closed).toBe(true);
  expect(await storedText(page, "Prima parte.caa")).toContain("Prima parte e seconda parte");
  // Salvataggio impossibile: si chiede conferma; «no» resta nel programma, «sì» esce.
  await page.evaluate(() => { const m = (window as any).__mock; m.saveDelay = 0; m.saveFail = 100; (window as any).__asked = []; (window as any).__caaConferma = (c: any) => { (window as any).__asked.push(`${c.domanda} ${c.spiegazione ?? ""}`); return (window as any).__answer; }; });
  await page.keyboard.type(" e terza");
  await page.evaluate(() => { (window as any).__answer = false; });
  expect(await page.evaluate(() => (window as any).caaProto.closeRequest())).toBe(false);
  expect(await page.evaluate(() => (window as any).__asked.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__asked[0])).toContain("non si è salvato");
  await page.evaluate(() => { (window as any).__answer = true; });
  expect(await page.evaluate(() => (window as any).caaProto.closeRequest())).toBe(true);
  // Senza modifiche da salvare si esce senza chiedere niente.
  await page.evaluate(() => { (window as any).__mock.saveFail = 0; });
  await page.getByRole("button", { name: "Nuovo" }).click();
  const before = await page.evaluate(() => (window as any).__asked.length);
  expect(await page.evaluate(() => (window as any).caaProto.closeRequest())).toBe(true);
  expect(await page.evaluate(() => (window as any).__asked.length)).toBe(before);
});

test("un documento eliminato mentre si salva non rinasce con lo stesso file", async ({ page }) => {
  await open(page, "", true);
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Da eliminare");
  await expect.poll(async () => (await mockSaves(page)).length).toBe(1);
  await page.evaluate(() => { (window as any).__mock.saveDelay = 900; });
  await page.keyboard.type("!");
  await expect.poll(async () => (await mockSaves(page)).length).toBe(2);
  await page.getByRole("button", { name: "Documenti" }).click();
  await azioneRiga(page.locator(".docs-row.current"), "Elimina"); // M11-6: nel menu «⋯» della riga
  await page.locator(".docs-panel").getByRole("button", { name: "Chiudi" }).click();
  await page.waitForTimeout(1500);
  await page.evaluate(() => { (window as any).__mock.saveDelay = 0; });
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("End");
  await page.keyboard.type("?");
  await expect.poll(async () => (await mockSaves(page)).length).toBeGreaterThan(2);
  expect((await mockSaves(page)).at(-1).file).toBeNull();
});

test("se il file è stato cambiato da un'altra copia, il documento si salva come nuovo e lo dice", async ({ page }) => {
  await open(page, "", true);
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Storia");
  await expect.poll(async () => (await mockSaves(page)).length).toBe(1);
  await page.evaluate(() => { (window as any).__mock.conflictNext = true; });
  await page.keyboard.type(" lunga");
  // L'avviso sta in alto e non sparisce da solo (prima durava 6 secondi in fondo e non lo vedeva nessuno).
  const banner = page.locator(".banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("un'altra copia del programma");
  await page.waitForTimeout(7000);
  await expect(banner).toBeVisible();
  // Si chiude con la × (M11-4, K9), non più cliccando il testo.
  await banner.click();
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Chiudi l'avviso" }).click();
  await expect(banner).toBeHidden();
});

test("un documento letto da un file: scelte non valide o con simboli che mancano si scartano", async ({ page }) => {
  await open(page, "", true);
  await page.evaluate(() => {
    const p = (window as any).caaProto;
    const sc = p.view.state.schema;
    const pick = (word: string, picto: unknown, uuid = "") => sc.marks.pick.create({ word, picto, uuid });
    const para = sc.nodes.paragraph.create(null, [
      sc.text("uno", [pick("uno", 1002)]), sc.text(" "),
      sc.text("due", [pick("due", "storto")]), sc.text(" "),
      sc.text("tre", [pick("tre", 4294967294)]), sc.text(" "),
      sc.text("quattro", [pick("quattro", 2147490000, "assente")]), sc.text(" "),
      sc.text("cinque", [pick("cinque", 2147490001, "presente")]), sc.text(" "),
      sc.text("sei", [pick("sei", 1.5)]),
    ]);
    const d = sc.nodes.doc.create({ locks: [{ lemma: "otto", cat: "NOUN", picto: 2147490002, uuid: "assente" }, { lemma: "nove", cat: "NOUN", picto: 1003, uuid: "" }] }, [para]);
    (window as any).__mock.docsStore.set("Misto.caa", { entry: { file: "Misto.caa", id: "id-m", title: "Misto", modified: new Date().toISOString(), rev: 1, author: "X", origin: null }, payload: { document: d.toJSON(), prefs: {}, render: [], sense_locks: [], lexicon: "lex-new" } });
    (window as any).__mock.mediaMap = [{ uuid: "presente", id: 2147499999 }];
  });
  await openStored(page, "Misto");
  await expect.poll(async () => (await docPicks(page)).map((p) => p.word)).toEqual(["uno", "cinque"]);
  const picks = await docPicks(page);
  expect(picks.find((p) => p.word === "cinque")?.picto).toBe(2147499999); // id di questo computer
  expect(picks.find((p) => p.word === "uno")?.picto).toBe(1002);
  expect((await docLocks(page)).map((l) => l.lemma)).toEqual(["nove"]);
});

test("revisione del lessico: se si inserisce un paragrafo sopra, «Tieni il vecchio» agisce sulla parola giusta", async ({ page }) => {
  await open(page, "", true);
  await storeOldDoc(page);
  await openStored(page, "Vecchio");
  await page.locator(".lexbar").getByRole("button", { name: "Rivedi" }).click();
  await expect(page.locator(".lexbar")).toContainText("«mangia»");
  await page.evaluate(() => (window as any).caaProto.setCaret(1));
  await page.keyboard.press("Enter"); // un paragrafo vuoto sopra: le posizioni slittano
  await expect(page.locator(".lexbar")).toContainText("«mangia»");
  await page.locator(".lexbar").getByRole("button", { name: "Tieni il vecchio" }).click();
  await expect.poll(async () => (await docPicks(page)).map((p) => [p.word, p.picto])).toEqual([["mangia", 5001]]);
});

// ---- M9b-1: biblioteca nel Drive condiviso ----

const LIB_ENTRIES = [
  { file: "citta.caa", id: "id-1", title: "La città di Marco", author: "Maria Rossi", subject: "Italiano", level: "Primaria", tags: ["storia", "sociale"], created: "2026-11-01T10:00:00Z", modified: "2026-11-20T10:00:00Z", rev: 3, size: 1000, conflict: false },
  { file: "frazioni.caa", id: "id-2", title: "Le frazioni", author: "Luca Bianchi", subject: "Matematica", level: "Secondaria", tags: ["numeri"], created: "2026-10-01T10:00:00Z", modified: "2026-10-05T10:00:00Z", rev: 1, size: 800, conflict: false },
  { file: "regole.caa", id: "id-3", title: "Regole della classe", author: "Maria Rossi", subject: "italiano", level: "primaria", tags: [], created: "2026-09-01T10:00:00Z", modified: "2026-09-02T10:00:00Z", rev: 2, size: 900, conflict: true },
];

const tabLibrary = async (page: Page) => {
  await page.getByRole("button", { name: "Documenti" }).click();
  await page.locator(".docs-panel").getByRole("tab", { name: "Biblioteca" }).click();
};

test("primo avvio: si chiede il nome una volta sola e non si prosegue senza", async ({ page }) => {
  await open(page, "", true, { name: "" });
  const box = page.locator(".first-box");
  await expect(box).toBeVisible();
  await expect(box.getByRole("button", { name: "Continua" })).toBeDisabled();
  await box.getByLabel("Il tuo nome").fill("   ");
  await expect(box.getByRole("button", { name: "Continua" })).toBeDisabled();
  // Un nome non riuscito a salvare: resta aperta con il messaggio.
  await page.evaluate(() => { (window as any).__mock.lib.nameFail = true; });
  await box.getByLabel("Il tuo nome").fill("Maria   Rossi");
  await box.getByRole("button", { name: "Continua" }).click();
  await expect(box).toContainText("non riesco a salvare il nome");
  await page.evaluate(() => { (window as any).__mock.lib.nameFail = false; });
  await box.getByLabel("Il tuo nome").press("Enter");
  await expect(box).toBeHidden();
  expect(await page.evaluate(() => (window as any).__mock.lib.name)).toBe("Maria Rossi");
});

test("primo avvio: con più Drive condivisi lo dice; con un nome già scelto non chiede niente", async ({ page }) => {
  await open(page, "", true, { name: "Maria", candidates: [{ path: "G:/A/CAA", drive: "A" }, { path: "G:/B/CAA", drive: "B" }] });
  await expect(page.locator(".first-box")).toHaveCount(0);
  await expect(page.locator(".toasts")).toContainText("più Drive condivisi"); // M11-3: i messaggi sono notifiche
  await expect(page.locator(".lib-status")).toBeHidden();
});

test("biblioteca non collegata: si sceglie la cartella trovata o si scrive il percorso", async ({ page }) => {
  await open(page, "", true, { candidates: [{ path: "G:/Drive condivisi/CAA Istituto/CAA", drive: "CAA Istituto" }], entries: LIB_ENTRIES });
  await tabLibrary(page);
  const panel = page.locator(".docs-panel");
  await expect(panel).toContainText("non è ancora collegata");
  await expect(panel).toContainText("Ho trovato queste cartelle");
  await expect(panel.locator(".docs-row")).toContainText("CAA Istituto");
  // Un percorso sbagliato: l'errore compare e non si collega; «Crea la biblioteca qui» lo accetta.
  // (M11-6: il percorso a mano sta nella parte chiusa «Per chi imposta la biblioteca».)
  await panel.getByText("Per chi imposta la biblioteca").click();
  await panel.getByLabel("Percorso della cartella della biblioteca").fill("X:/sbagliato");
  await panel.getByRole("button", { name: "Usa questo percorso" }).click();
  await expect(panel).toContainText("non contiene una «biblioteca»");
  expect(await page.evaluate(() => (window as any).__mock.lib.configured)).toBe(false);
  // La cartella trovata: si collega e compare l'elenco.
  await panel.getByRole("button", { name: "Usa questa" }).click();
  await expect(panel.locator(".lib-row")).toHaveCount(3);
  await expect(page.locator(".lib-status")).toContainText("Biblioteca");
  await expect(page.locator(".lib-status")).toHaveClass(/on/);
  const calls = await page.evaluate(() => (window as any).__mock.lib.setCalls);
  expect(calls).toEqual([{ path: "X:/sbagliato", create: false }, { path: "G:/Drive condivisi/CAA Istituto/CAA", create: false }]);
});

test("«Crea la biblioteca qui» per chi imposta la biblioteca", async ({ page }) => {
  await open(page, "", true, { entries: [] });
  await tabLibrary(page);
  const panel = page.locator(".docs-panel");
  await panel.getByText("Per chi imposta la biblioteca").click();
  await panel.getByLabel("Percorso della cartella della biblioteca").fill("X:/sbagliato");
  await panel.getByRole("button", { name: "Crea la biblioteca qui" }).click();
  await expect(panel).toContainText("Nessun documento in biblioteca"); // M11-6: stato vuoto della 3.6
  const calls = await page.evaluate(() => (window as any).__mock.lib.setCalls);
  expect(calls).toEqual([{ path: "X:/sbagliato", create: true }]);
});

test("elenco della biblioteca: ricerca senza accenti, filtri, conflitti, file in sincronizzazione", async ({ page }) => {
  await open(page, "", true, { configured: true, path: "G:/CAA", entries: LIB_ENTRIES, incomplete: 2 });
  await tabLibrary(page);
  const panel = page.locator(".docs-panel");
  await expect(panel.locator(".lib-row")).toHaveCount(3);
  await expect(panel.locator(".lib-state")).toHaveText("Collegata al Drive");
  await expect(panel).toContainText("2 documenti sono ancora in sincronizzazione");
  // Titolo, autore, materia e livello si vedono; i più recenti per primi.
  await expect(panel.locator(".lib-row").first()).toContainText("La città di Marco");
  await expect(panel.locator(".lib-row").first()).toContainText("Maria Rossi · Italiano · Primaria");
  await expect(panel.locator(".lib-row").first().locator(".docs-tag")).toHaveText(["storia", "sociale"]);
  await expect(panel.locator(".docs-tag.conflict")).toHaveCount(1);
  // «citta» trova «città»; l'autore, le etichette e più parole insieme.
  const search = panel.getByLabel("Cerca nella biblioteca");
  await search.fill("citta");
  await expect(panel.locator(".lib-row")).toHaveCount(1);
  await search.fill("bianchi");
  await expect(panel.locator(".lib-row")).toHaveCount(1);
  await expect(panel.locator(".lib-row")).toContainText("Le frazioni");
  await search.fill("numeri frazioni");
  await expect(panel.locator(".lib-row")).toHaveCount(1);
  await search.fill("rossi");
  await expect(panel.locator(".lib-row")).toHaveCount(2);
  await search.fill("zzz");
  await expect(panel).toContainText("Nessun documento corrisponde");
  await search.fill("");
  // I filtri hanno i valori senza doppioni per maiuscole («Italiano» e «italiano» sono la stessa materia).
  await expect(panel.getByLabel("Materia").locator("option")).toHaveText(["Tutte le materie", "Italiano", "Matematica"]);
  await expect(panel.getByLabel("Livello").locator("option")).toHaveText(["Tutti i livelli", "Primaria", "Secondaria"]);
  await panel.getByLabel("Materia").selectOption("Italiano");
  await expect(panel.locator(".lib-row")).toHaveCount(2);
  await panel.getByLabel("Livello").selectOption("Secondaria");
  await expect(panel).toContainText("Nessun documento corrisponde");
  await panel.getByLabel("Materia").selectOption("");
  await expect(panel.locator(".lib-row")).toHaveCount(1);
});

test("senza il Drive: ultima copia, indicatore arancione, poi di nuovo collegata", async ({ page }) => {
  await open(page, "", true, { configured: true, path: "G:/CAA", reachable: false, cached: [LIB_ENTRIES[0]], entries: LIB_ENTRIES });
  await expect(page.locator(".lib-status")).toContainText("non raggiungibile");
  await expect(page.locator(".lib-status")).toHaveClass(/off/);
  await tabLibrary(page);
  const panel = page.locator(".docs-panel");
  await expect(panel.locator(".lib-state")).toContainText("Drive non raggiungibile");
  await expect(panel.locator(".lib-row")).toHaveCount(1);
  // Il Drive torna: «Aggiorna» e l'indicatore (controllo ogni pochi secondi) lo mostrano.
  await page.evaluate(() => { (window as any).__mock.lib.reachable = true; });
  await panel.getByRole("button", { name: "Aggiorna" }).click();
  await expect(panel.locator(".lib-row")).toHaveCount(3);
  await expect(panel.locator(".lib-state")).toHaveText("Collegata al Drive");
  await expect(page.locator(".lib-status")).toHaveClass(/on/, { timeout: 5000 });
  // E se sparisce di nuovo, l'indicatore lo segnala da solo.
  await page.evaluate(() => { (window as any).__mock.lib.reachable = false; });
  await expect(page.locator(".lib-status")).toHaveClass(/off/, { timeout: 5000 });
});

test("Adatta: una copia personale che si apre subito; se non riesce, lo dice", async ({ page }) => {
  await open(page, "", true, { configured: true, path: "G:/CAA", entries: LIB_ENTRIES });
  await tabLibrary(page);
  const panel = page.locator(".docs-panel");
  await panel.locator(".lib-row", { hasText: "Le frazioni" }).getByRole("button", { name: "Adatta" }).click();
  await expect(panel).toHaveCount(0);
  // La copia è aperta nell'editor, col titolo dell'originale, e ricorda da dove viene.
  await expect(page.locator(".doc-title")).toHaveValue("Le frazioni");
  expect(await page.evaluate(() => (window as any).caaProto.view.state.doc.textContent)).toBe("Copia di Le frazioni");
  const stored = await page.evaluate(() => [...(window as any).__mock.docsStore.values()].map((v: any) => v.entry));
  expect(stored).toHaveLength(1);
  expect(stored[0].origin).toEqual({ id: "id-2", rev: 1 });
  expect(await page.evaluate(() => (window as any).__mock.lib.adapts)).toEqual(["frazioni.caa"]);
  // Un errore: messaggio nel pannello, che resta aperto e il pulsante torna attivo.
  await page.evaluate(() => { (window as any).__mock.lib.adaptFail = true; });
  await tabLibrary(page);
  const btn = page.locator(".docs-panel .lib-row", { hasText: "La città" }).getByRole("button", { name: "Adatta" });
  await btn.click();
  await expect(page.locator(".docs-panel")).toContainText("Non riesco a fare la copia di «La città di Marco»");
  await expect(btn).toBeEnabled();
});

// ---- M9b-2: Pubblica, Aggiorna, Ritira, originale aggiornato, versione ----

const mine = (page: Page, title: string) => page.locator(".docs-panel .docs-row", { hasText: title });

test("Pubblica: il documento si salva, si compila il modulo e finisce in biblioteca", async ({ page }) => {
  await open(page, "", true, { configured: true, path: "G:/CAA", entries: LIB_ENTRIES });
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("La mia storia sociale");
  await page.getByRole("button", { name: "Documenti" }).click(); // subito, senza aspettare il salvataggio automatico
  const row = mine(page, "La mia storia sociale");
  // M11-6: «Pubblica…» sta nel menu «⋯» della riga.
  const voce = await voceRiga(row, "Pubblica…");
  await expect(voce).toBeEnabled();
  await voce.click();
  const form = page.locator(".pub-form");
  await expect(form).toContainText("Pubblica «La mia storia sociale» nella biblioteca");
  await expect(form.getByLabel("Titolo")).toHaveValue("La mia storia sociale");
  // I suggerimenti vengono dai documenti già in biblioteca (senza doppioni).
  expect(await form.locator("datalist option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value))).toEqual(["Italiano", "Matematica", "Primaria", "Secondaria"]);
  await form.getByLabel("Titolo").fill("Il bus: storia sociale");
  await form.getByLabel("Materia").fill("Italiano");
  await form.getByLabel("Livello").fill("Primaria");
  await form.getByLabel("Etichette").fill("storia sociale, bus ,");
  await form.getByRole("button", { name: "Pubblica" }).click();
  await expect(page.locator(".docs-panel")).toContainText("Pubblicato in biblioteca (revisione 1)");
  const sent = await page.evaluate(() => (window as any).__mock.lib.publishes);
  expect(sent).toHaveLength(1);
  expect(sent[0].meta).toEqual({ title: "Il bus: storia sociale", subject: "Italiano", level: "Primaria", tags: ["storia sociale", "bus"] });
  // Il documento era già salvato quando si è pubblicato (il testo che si vede è quello pubblicato).
  const saves = await mockSaves(page);
  expect(saves.length).toBeGreaterThan(0);
  expect(JSON.stringify(saves.at(-1).document)).toContain("La mia storia sociale");
  expect(sent[0].savedBefore).toBe(saves.length);
  // Ora il documento risulta in biblioteca e offre «Aggiorna in biblioteca» al posto di «Pubblica».
  const after = mine(page, "Il bus");
  await expect(after.locator(".docs-tag.pub")).toContainText("in biblioteca (rev. 1)");
  await expect(await voceRiga(after, "Aggiorna in biblioteca")).toBeVisible();
  await expect(after.getByRole("menuitem", { name: "Pubblica…" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  // E compare nella scheda Biblioteca.
  await page.locator(".docs-panel").getByRole("tab", { name: "Biblioteca", exact: true }).click();
  await expect(page.locator(".docs-panel .lib-row", { hasText: "Il bus: storia sociale" })).toBeVisible();
  // Il titolo scelto nel modulo è anche quello del documento aperto (il salvataggio automatico non lo rimette com'era).
  await expect(page.getByLabel("Titolo del documento")).toHaveValue("Il bus: storia sociale");
});

test("Pubblica: un errore resta nel modulo; senza biblioteca collegata o senza Drive i pulsanti non ci sono o sono spenti", async ({ page }) => {
  await open(page, "", true, { configured: true, path: "G:/CAA", entries: [], publishFail: "questo documento è già in biblioteca: usa «Aggiorna in biblioteca»" });
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Prova");
  await expect.poll(async () => (await mockSaves(page)).length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Documenti" }).click();
  await azioneRiga(mine(page, "Prova"), "Pubblica…");
  await page.locator(".pub-form").getByRole("button", { name: "Pubblica" }).click();
  await expect(page.locator(".pub-form")).toContainText("già in biblioteca");
  await expect(page.locator(".pub-form").getByRole("button", { name: "Pubblica" })).toBeEnabled();
  await page.locator(".pub-form").getByRole("button", { name: "Annulla" }).click();
  await expect(mine(page, "Prova")).toBeVisible();
  // Senza Drive il pulsante è spento (non si scrive).
  await page.evaluate(() => { (window as any).__mock.lib.reachable = false; });
  await page.locator(".docs-panel").getByRole("button", { name: "Chiudi" }).click();
  await page.getByRole("button", { name: "Documenti" }).click();
  await expect(await voceRiga(mine(page, "Prova"), "Pubblica…")).toBeDisabled();
});

test("senza biblioteca collegata non ci sono Pubblica né Aggiorna", async ({ page }) => {
  await open(page, "", true, { configured: false });
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Prova");
  await expect.poll(async () => (await mockSaves(page)).length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Documenti" }).click();
  await expect(mine(page, "Prova")).toBeVisible();
  await mine(page, "Prova").getByRole("button", { name: /^Altre azioni/ }).click();
  await expect(mine(page, "Prova").getByRole("menuitem", { name: "Elimina" })).toBeVisible();
  await expect(mine(page, "Prova").getByRole("menuitem", { name: /Pubblica|Aggiorna/ })).toHaveCount(0);
});

test("Aggiorna in biblioteca: revisione avanti, salvato come nuovo se la biblioteca è andata avanti, errori", async ({ page }) => {
  await open(page, "", true, { configured: true, path: "G:/CAA", entries: [] });
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Storia da aggiornare");
  await expect.poll(async () => (await mockSaves(page)).length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Documenti" }).click();
  await azioneRiga(mine(page, "Storia da aggiornare"), "Pubblica…");
  await page.locator(".pub-form").getByRole("button", { name: "Pubblica" }).click();
  await expect(page.locator(".docs-panel")).toContainText("Pubblicato in biblioteca");
  // M11-6: «Aggiorna in biblioteca» sta nel menu «⋯» della riga.
  const upd = () => ({ click: () => azioneRiga(mine(page, "Storia da aggiornare"), "Aggiorna in biblioteca") });
  // Aggiorna: revisione 2.
  await upd().click();
  await expect(page.locator(".docs-panel")).toContainText("Aggiornato in biblioteca: revisione 2");
  await expect(mine(page, "Storia da aggiornare").locator(".docs-tag.pub")).toContainText("rev. 2");
  // Il blocco di un altro: errore chiaro, nessun cambiamento.
  await page.evaluate(() => { (window as any).__mock.lib.updateMode = "fail"; });
  await upd().click();
  await expect(page.locator(".docs-panel")).toContainText("Luca lo sta aggiornando adesso");
  await expect(mine(page, "Storia da aggiornare").locator(".docs-tag.pub")).toContainText("rev. 2");
  // La biblioteca era andata avanti: il documento si salva come nuovo e il documento aperto ne prende l'identità.
  await page.evaluate(() => { (window as any).__mock.lib.updateMode = "new"; });
  await upd().click();
  await expect(page.locator(".docs-panel")).toContainText("ho salvato questo documento come nuovo in biblioteca");
  await page.locator(".docs-panel").getByRole("button", { name: "Chiudi" }).click();
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await expect.poll(async () => (await mockSaves(page)).at(-1)?.id).toBe("new-id");
  // Il documento aperto era quello: si salva prima di aggiornare.
  const updates = await page.evaluate(() => (window as any).__mock.lib.updates);
  expect(updates.length).toBe(3);
});

test("Ritira: solo l'autore o un amministratore, con conferma", async ({ page }) => {
  await open(page, "", true, {
    configured: true,
    path: "G:/CAA",
    name: "Maria Rossi",
    user: "mrossi",
    admins: [],
    entries: [
      { ...LIB_ENTRIES[0], author: "Maria Rossi" },
      { ...LIB_ENTRIES[1], author: "Luca Bianchi" },
      { ...LIB_ENTRIES[2], author: "Anna Verdi" },
    ],
  });
  await tabLibrary(page);
  const panel = page.locator(".docs-panel");
  // Solo il suo: un solo menu «⋯» (M11-6: «Ritira» sta lì dentro), sulla sua riga.
  const sua = panel.locator(".lib-row", { hasText: "La città di Marco" });
  await expect(panel.getByRole("button", { name: /^Altre azioni/ })).toHaveCount(1);
  await expect(await voceRiga(sua, "Ritira")).toBeVisible();
  await page.keyboard.press("Escape");
  // Un errore: messaggio, il documento resta.
  await page.evaluate(() => { (window as any).__mock.lib.retireFail = "il documento non è più in biblioteca"; });
  await azioneRiga(sua, "Ritira");
  await expect(panel).toContainText("Non riesco a ritirare «La città di Marco»");
  await expect(panel.locator(".lib-row")).toHaveCount(3);
  // Riuscito: esce dall'elenco.
  await page.evaluate(() => { (window as any).__mock.lib.retireFail = ""; });
  await azioneRiga(sua, "Ritira");
  await expect(panel.locator(".lib-row")).toHaveCount(2);
  expect(await page.evaluate(() => (window as any).__mock.lib.retires)).toEqual(["citta.caa", "citta.caa"]);
});

test("Ritira: gli amministratori lo vedono su tutti i documenti", async ({ page }) => {
  await open(page, "", true, { configured: true, path: "G:/CAA", name: "Segretaria Anna", user: "Segreteria", admins: ["segreteria"], entries: LIB_ENTRIES });
  await tabLibrary(page);
  await expect(page.locator(".docs-panel").getByRole("button", { name: /^Altre azioni/ })).toHaveCount(3);
});

test("«Originale aggiornato»: avviso sulla copia, Ignora, apri l'originale e torna alla copia", async ({ page }) => {
  await open(page, "", true, { configured: true, path: "G:/CAA", entries: [{ ...LIB_ENTRIES[1], rev: 3 }] });
  // Una copia adattata alla revisione 1 dell'originale (che adesso è alla 3).
  await page.evaluate(() => {
    const p = (window as any).caaProto;
    const d = p.view.state.schema.nodes.doc.create(null, [p.view.state.schema.nodes.paragraph.create(null, p.view.state.schema.text("La mia copia delle frazioni"))]);
    (window as any).__mock.docsStore.set("Copia.caa", { entry: { file: "Copia.caa", id: "copy-1", title: "Le frazioni", modified: new Date().toISOString(), rev: 1, author: "Maria", origin: { id: "id-2", rev: 1 } }, payload: { document: d.toJSON(), prefs: {}, render: [], sense_locks: [], lexicon: "lex-new" } });
  });
  await openStored(page, "Le frazioni");
  const bar = page.locator(".origbar");
  await expect(bar).toContainText("L'originale «Le frazioni» è stato aggiornato in biblioteca (revisione 3)");
  // «Apri l'originale»: sola lettura, con la barra per tornare.
  await bar.getByRole("button", { name: "Apri l'originale" }).click();
  await expect(bar).toContainText("Stai guardando l'originale «Le frazioni»");
  expect(await page.evaluate(() => (window as any).caaProto.view.state.doc.textContent)).toBe("Originale di Le frazioni");
  await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "false");
  const savesBefore = (await mockSaves(page)).length;
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("niente");
  await page.waitForTimeout(400);
  expect((await mockSaves(page)).length).toBe(savesBefore);
  // «Torna alla mia copia»: la copia, modificabile, e l'avviso è ancora lì.
  await bar.getByRole("button", { name: "Torna alla mia copia" }).click();
  expect(await page.evaluate(() => (window as any).caaProto.view.state.doc.textContent)).toBe("La mia copia delle frazioni");
  await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "true");
  await expect(bar).toContainText("è stato aggiornato in biblioteca (revisione 3)");
  // «Ignora» lo toglie, e non torna per quella revisione (nemmeno riaprendo il documento).
  await bar.getByRole("button", { name: "Ignora" }).click();
  await expect(bar).toBeHidden();
  await page.getByRole("button", { name: "Nuovo" }).click();
  await openStored(page, "Le frazioni");
  await expect(page.locator(".ProseMirror")).toContainText("La mia copia delle frazioni");
  await page.waitForTimeout(400);
  await expect(bar).toBeHidden();
  // Con una revisione ancora più nuova, l'avviso torna.
  await page.evaluate(() => { (window as any).__mock.lib.entries[0].rev = 4; });
  await page.getByRole("button", { name: "Nuovo" }).click();
  await openStored(page, "Le frazioni");
  await expect(bar).toContainText("revisione 4");
});

test("«Originale aggiornato»: niente avviso se la revisione è la stessa o la copia non viene da una biblioteca", async ({ page }) => {
  await open(page, "", true, { configured: true, path: "G:/CAA", entries: [{ ...LIB_ENTRIES[1], rev: 2 }] });
  await page.evaluate(() => {
    const p = (window as any).caaProto;
    const d = p.view.state.schema.nodes.doc.create(null, [p.view.state.schema.nodes.paragraph.create(null, p.view.state.schema.text("Copia"))]);
    const mk = (file: string, origin: any) => (window as any).__mock.docsStore.set(file, { entry: { file, id: "i-" + file, title: file.replace(".caa", ""), modified: new Date().toISOString(), rev: 1, author: "Maria", origin }, payload: { document: d.toJSON(), prefs: {}, render: [], sense_locks: [], lexicon: "lex-new" } });
    mk("Stessa.caa", { id: "id-2", rev: 2 });
    mk("Personale.caa", null);
    mk("Ritirata.caa", { id: "id-introvabile", rev: 1 });
  });
  for (const t of ["Stessa", "Personale", "Ritirata"]) {
    await page.getByRole("button", { name: "Nuovo" }).click();
    await openStored(page, t);
    await page.waitForTimeout(300);
    await expect(page.locator(".origbar")).toBeHidden();
  }
});

test("versione nuova del programma annunciata nel Drive", async ({ page }) => {
  await open(page, "", true, { configured: true, path: "G:/CAA", version: { version: "0.2.0", notes: "Nuove funzioni" } });
  await expect(page.locator(".update-note")).toContainText("È disponibile la versione 0.2.0");
  await expect(page.locator(".update-note")).toHaveAttribute("title", /Nuove funzioni/);
  await page.evaluate(() => { (window as any).__mock.lib.version = null; });
  await expect(page.locator(".update-note")).toBeHidden({ timeout: 5000 });
});

// ---- M9c-1: memoria del docente («ricorda per sempre») ----

const memoryOf = (page: Page) => page.evaluate(() => (window as any).__mock.memory);

test("«ricorda per sempre»: la scelta va in memoria e i paragrafi si rifanno", async ({ page }) => {
  await open(page, "pane e casa");
  await clickSymbol(page, "pane");
  await expect(page.locator(".pm-always input")).not.toBeChecked(); // di default spenta: ricordare è una scelta
  const before = await page.evaluate(() => (window as any).__mock.calls.length);
  await page.locator(".pm-always input").check();
  await page.locator(".pm-cell").nth(2).click();
  await expect.poll(() => memoryOf(page)).toEqual([{ lemma: "pane", cat: "NOUN", form: "", picto: 1003 }]);
  // La cache si è svuotata: il motore è stato richiamato per rifare il paragrafo.
  await expect.poll(() => page.evaluate(() => (window as any).__mock.calls.length)).toBeGreaterThan(before + 0);
  // Senza la spunta non si ricorda niente.
  await clickSymbol(page, "casa");
  await page.locator(".pm-cell").nth(1).click();
  expect(await memoryOf(page)).toHaveLength(1);
});

test("«ricorda per sempre»: «Nessun simbolo» o «Solo testo» non si ricordano; un errore si dice", async ({ page }) => {
  await open(page, "pane");
  await clickSymbol(page, "pane");
  await page.locator(".pm-always input").check();
  await page.getByRole("button", { name: "Solo testo" }).click();
  expect(await memoryOf(page)).toEqual([]);
  await page.evaluate(() => ((window as any).__mock.memoryFail = true));
  await clickSymbol(page, "pane");
  await page.locator(".pm-always input").check();
  await page.locator(".pm-cell").nth(0).click();
  await expect(page.locator(".toasts")).toContainText("Non sono riuscito a ricordare"); // M11-3: i messaggi sono notifiche
});

test("«Cosa ricordo»: elenco nella barra vuota, Dimentica e Dimentica tutto", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__memInit = [
      { lemma: "pane", cat: "NOUN", form: "", picto: 1003 },
      { lemma: "", cat: "", form: "blorpf", picto: 1004 },
    ];
  });
  await open(page, "pane e casa");
  const list = page.locator(".side-memory");
  await expect(list).toContainText("Cosa ricordo");
  await expect(list.locator("li")).toHaveCount(2);
  await list.getByRole("button", { name: "Dimentica pane" }).click();
  await expect.poll(() => memoryOf(page)).toEqual([{ lemma: "", cat: "", form: "blorpf", picto: 1004 }]);
  await expect(page.locator(".side-memory li")).toHaveCount(1);
  await page.locator(".side-memory").getByRole("button", { name: "Dimentica tutto" }).click();
  await expect.poll(() => memoryOf(page)).toEqual([]);
  await expect(page.locator(".side-memory")).toHaveCount(0);
});

// ---- M9c-2: simboli della scuola e cancellazione dei simboli personali ----

const withShared = (page: Page, shared: Record<string, unknown> = {}, custom: unknown[] = []) =>
  page.addInitScript(([sh, cu]) => {
    (window as any).__withSharedFlag = true;
    (window as any).__sharedInit = sh;
    (window as any).__customInit = cu;
  }, [shared, custom] as const);

test("simbolo personale: si elimina dal computer (con conferma)", async ({ page }) => {
  await withShared(page, {}, [{ id: 2147483648, uuid: "u-mela", label: "mela" }, { id: 2147483649, uuid: "u-pane", label: "pane" }]);
  await open(page, "Marco mangia pane");
  await clickSymbol(page, "pane");
  await expect(page.locator(".pm-custom .pm-mini-cell")).toHaveCount(2);
  await rispondiConferma(page, false); // «Annulla» alla conferma: non succede niente
  await page.getByRole("button", { name: "Elimina il simbolo mela" }).click();
  expect(await page.evaluate(() => (window as any).__mock.deletes)).toEqual([]);
  await rispondiConferma(page, true);
  await page.getByRole("button", { name: "Elimina il simbolo mela" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__mock.deletes)).toEqual(["u-mela"]);
  await expect(page.locator(".pm-custom .pm-mini-cell")).toHaveCount(1);
});

test("simboli della scuola: elenco, prendi e usa, ritira solo se è tuo o sei amministratore", async ({ page }) => {
  await withShared(page, { symbols: [
    { uuid: "s1", label: "autobus", author: "Luca", can_retire: false },
    { uuid: "s2", label: "palestra", author: "Maria", can_retire: true },
  ] });
  await open(page, "Marco mangia pane");
  await clickSymbol(page, "pane");
  await page.getByRole("button", { name: "Simboli della scuola…" }).click();
  await expect(page.locator(".pm-school .pm-mini-cell")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /Ritira dalla scuola il simbolo autobus/ })).toHaveCount(0);
  // Prendi «autobus»: finisce nei miei simboli e diventa la scelta per la parola.
  await page.locator(".pm-school .pm-mini", { hasText: "autobus" }).click();
  await expect.poll(async () => (await docLocks(page)).length).toBe(1);
  expect(await page.evaluate(() => (window as any).__mock.shared.takes)).toEqual(["s1"]);
  // Ritira il suo.
  await clickSymbol(page, "mangia");
  await page.getByRole("button", { name: "Simboli della scuola…" }).click();
  await page.getByRole("button", { name: "Ritira dalla scuola il simbolo palestra" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__mock.shared.retires)).toEqual(["s2"]);
});

test("simboli della scuola: senza Drive lo dice", async ({ page }) => {
  await withShared(page, { reachable: false });
  await open(page, "Marco mangia pane");
  await clickSymbol(page, "pane");
  await page.getByRole("button", { name: "Simboli della scuola…" }).click();
  await expect(page.locator(".pm-school")).toContainText("Drive non raggiungibile");
});

test("simbolo personale: «Condividi con tutta la scuola» solo con la biblioteca, e un errore non perde il simbolo", async ({ page }) => {
  await withShared(page, { shareFail: "il Drive non risponde" });
  await open(page, "Marco mangia pane");
  await clickSymbol(page, "pane");
  await page.locator(".side input[type=file]").setInputFiles(photo);
  const dialog = page.locator(".crop-dialog");
  await expect(dialog).toContainText("Condividi con tutta la scuola");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Usa questo simbolo" }).click();
  await expect.poll(async () => (await docLocks(page)).length).toBe(1); // il simbolo si usa comunque
  await expect(page.locator(".toasts")).toContainText("non condiviso"); // M11-3: i messaggi sono notifiche
});

test("simbolo personale: senza biblioteca non compare «Condividi con tutta la scuola»", async ({ page }) => {
  await open(page, "Marco mangia pane");
  await clickSymbol(page, "pane");
  await page.locator(".side input[type=file]").setInputFiles(photo);
  await expect(page.locator(".crop-dialog")).toBeVisible();
  await expect(page.locator(".crop-share")).toBeHidden();
  await expect(page.getByRole("button", { name: "Simboli della scuola…" })).toHaveCount(0);
});

// ---- M9c-3: correzioni anonime ----

const withCorrections = (page: Page, corr: Record<string, unknown> = {}) =>
  page.addInitScript((c) => {
    (window as any).__withCorrFlag = true;
    (window as any).__corrInit = c;
  }, corr);

test("correzioni anonime: una scelta diversa dal proposto si registra, non c'è il testo intero", async ({ page }) => {
  await withCorrections(page);
  await open(page, "Marco mangia pane");
  await clickSymbol(page, "pane");
  await page.locator(".pm-cell").nth(2).click();
  const logged = await page.evaluate(() => (window as any).__mock.corr.logged);
  expect(logged).toHaveLength(1);
  expect(logged[0]).toMatchObject({ text: "Marco mangia pane", lemma: "pane", cat: "NOUN", picto: 1003 });
  // «Nessun simbolo» si registra come 0; «Solo testo» e «Automatico» no.
  await clickSymbol(page, "pane");
  await page.getByRole("button", { name: "Nessun simbolo" }).click();
  await clickSymbol(page, "pane");
  await page.getByRole("button", { name: "Solo testo" }).click();
  const after = await page.evaluate(() => (window as any).__mock.corr.logged.map((e: any) => e.picto));
  expect(after).toEqual([1003, 0]);
});

test("correzioni anonime: senza il client (prove senza archivio) la scelta funziona lo stesso", async ({ page }) => {
  await open(page, "Marco mangia pane");
  await clickSymbol(page, "pane");
  await page.locator(".pm-cell").nth(2).click();
  await expect.poll(async () => (await docLocks(page)).length).toBe(1);
});

test("correzioni anonime: nella scheda Biblioteca si vedono, si spengono, si inviano o si buttano", async ({ page }) => {
  await withCorrections(page, { pending: ["pane\t1003", "casa\t1002"] });
  await open(page, "", true, { configured: true, path: "G:/CAA", entries: LIB_ENTRIES });
  await page.getByRole("button", { name: "Documenti" }).click();
  await page.locator(".docs-panel").getByRole("tab", { name: "Correzioni" }).click(); // M11-6: scheda propria
  const sec = page.locator(".lib-corrections");
  await expect(sec).toContainText("2 correzioni in attesa");
  await expect(sec).toContainText("Mai il testo e mai il tuo nome dentro il file");
  await expect(sec).toContainText("il file lo crea il tuo account Google");
  await sec.getByRole("button", { name: "Vedi cosa parte" }).click();
  await expect(sec.locator("pre")).toContainText("pane");
  // Spengo la raccolta.
  await sec.getByLabel("Raccogli le correzioni").uncheck();
  expect(await page.evaluate(() => (window as any).__mock.corr.enabled)).toBe(false);
  // Un errore di invio si dice e non butta niente.
  await page.evaluate(() => ((window as any).__mock.corr.sendFail = "il Drive non risponde"));
  await sec.getByRole("button", { name: "Invia correzioni" }).click();
  await expect(sec).toContainText("Non sono riuscito a inviarle");
  expect(await page.evaluate(() => (window as any).__mock.corr.pending.length)).toBe(2);
  // Poi riesce.
  await page.evaluate(() => ((window as any).__mock.corr.sendFail = ""));
  await sec.getByRole("button", { name: "Invia correzioni" }).click();
  await expect(sec).toContainText("Inviate 2 correzioni");
  await expect(sec).toContainText("Nessuna correzione in attesa");
});

test("correzioni anonime: senza Drive non si invia; «Butta via» chiede conferma", async ({ page }) => {
  await withCorrections(page, { pending: ["pane\t1003"] });
  await open(page, "", true, { configured: true, path: "G:/CAA", entries: LIB_ENTRIES, reachable: false, cached: LIB_ENTRIES });
  await page.getByRole("button", { name: "Documenti" }).click();
  await page.locator(".docs-panel").getByRole("tab", { name: "Correzioni" }).click(); // M11-6: scheda propria
  const sec = page.locator(".lib-corrections");
  await expect(sec.getByRole("button", { name: "Invia correzioni" })).toBeDisabled();
  await rispondiConferma(page, false);
  await sec.getByRole("button", { name: "Butta via" }).click();
  expect(await page.evaluate(() => (window as any).__mock.corr.pending.length)).toBe(1);
  await rispondiConferma(page, true);
  await sec.getByRole("button", { name: "Butta via" }).click();
  await expect(sec).toContainText("Nessuna correzione in attesa");
  expect(await page.evaluate(() => (window as any).__mock.corr.pending.length)).toBe(0);
});

// ---- M10: stampa ----

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STORIES = [
  "Marco mangia il pane. La mamma beve il latte. Il gatto dorme sul divano. Anna legge un libro. Il cane corre nel parco.",
  "Luca va a scuola con il suo amico. La maestra scrive alla lavagna. I bambini giocano in cortile. Dopo la scuola tornano a casa.",
  "Oggi piove molto. Metto la giacca e prendo l'ombrello. Cammino piano sulla strada bagnata. A casa bevo una tazza di latte.",
].join("\n");

/** Un PDF dalla pagina in resa di stampa; restituisce il percorso. */
async function pdfOf(page: Page): Promise<string> {
  await page.emulateMedia({ media: "print" });
  const buf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  const dir = mkdtempSync(join(tmpdir(), "caa-pdf-"));
  const file = join(dir, "p.pdf");
  writeFileSync(file, buf);
  return file;
}

const pdfInfo = (file: string) => execFileSync("pdfinfo", [file]).toString();
/** Larghezza e altezza della pagina in punti (A4 = 595 x 842). */
const pdfSize = (file: string): [number, number] => {
  const m = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(pdfInfo(file))!;
  return [Math.round(Number(m[1])), Math.round(Number(m[2]))];
};
const pdfPages = (file: string): string[] => execFileSync("pdftotext", ["-layout", file, "-"]).toString().split("\f").filter((t) => t.trim() !== "");
const ATTR = "Sergio Palao per ARASAAC";

/** Quanti pixel non bianchi ha la prima pagina del PDF (a bassa risoluzione): serve a vedere se i simboli ci sono. */
function darkPixels(file: string): number {
  const out = file.replace(/\.pdf$/, "");
  execFileSync("pdftoppm", ["-r", "40", "-gray", "-f", "1", "-l", "1", file, out]);
  const pgm = readFileSync(`${out}-1.pgm`);
  // Intestazione P5: tre righe di testo (formato, dimensioni, massimo) e poi i byte dei pixel.
  let pos = 0;
  for (let lines = 0; lines < 3; pos++) if (pgm[pos] === 0x0a) lines++;
  let n = 0;
  for (let i = pos; i < pgm.length; i++) if (pgm[i] < 240) n++;
  return n;
}

async function openPrintDialog(page: Page) {
  await page.getByRole("button", { name: "Stampa…" }).click();
  return page.locator(".print-dialog");
}

test("stampa: A4 verticale, attribuzione su ogni pagina, nessuna parola spezzata fra le pagine", async ({ page }) => {
  await open(page, STORIES.repeat(3));
  await page.keyboard.press("Control+4"); // molto grande: più pagine
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0);
  const file = await pdfOf(page);
  expect(pdfSize(file)).toEqual([595, 842]);
  const pages = pdfPages(file);
  expect(pages.length).toBeGreaterThan(1);
  // L'attribuzione c'è su OGNI pagina.
  for (const p of pages) expect(p).toContain(ATTR);
  // Nessuna parola è stata spezzata: ogni parola del testo compare intera nel PDF.
  const text = pages.join("\n");
  for (const w of ["mangia", "latte", "divano", "lavagna", "ombrello", "bagnata"]) expect(text.toLowerCase()).toContain(w);
  // Simbolo e parola sono un'unica unità che non si divide.
  const style = await page.locator(".w").first().evaluate((e) => ({ d: getComputedStyle(e).display, b: getComputedStyle(e).breakInside }));
  expect(style).toEqual({ d: "inline-block", b: "avoid" });
});

test("stampa: i simboli escono anche con «Grafica di sfondo» spenta nel dialogo di stampa", async ({ page }) => {
  await open(page, "Marco mangia pane");
  await page.keyboard.press("Control+3"); // grande: i simboli pesano molto più del testo
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0);
  await page.emulateMedia({ media: "print" });
  const dir = mkdtempSync(join(tmpdir(), "caa-bg-"));
  const withBg = join(dir, "con.pdf");
  const noBg = join(dir, "senza.pdf");
  writeFileSync(withBg, await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  writeFileSync(noBg, await page.pdf({ preferCSSPageSize: true, printBackground: false }));
  const a = darkPixels(withBg);
  const b = darkPixels(noBg);
  expect(a).toBeGreaterThan(1500); // ci sono i simboli (il solo testo ne ha molti meno)
  expect(Math.abs(a - b)).toBeLessThan(a * 0.02); // senza «sfondi» stampano uguale
});

test("stampa: orizzontale, margini e interfaccia nascosta", async ({ page }) => {
  await open(page, STORIES);
  const d = await openPrintDialog(page);
  await d.getByLabel("Orientamento").selectOption("landscape");
  await d.getByLabel("Margini (mm)").fill("25");
  await d.getByLabel("Margini (mm)").dispatchEvent("change");
  await d.getByRole("button", { name: "Chiudi" }).click();
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0);
  const file = await pdfOf(page);
  expect(pdfSize(file)).toEqual([842, 595]);
  const text = pdfPages(file).join("\n");
  // Barre, pulsanti e pannelli non si stampano.
  for (const ui of ["Stampa…", "Documenti", "Parole funzionali", "Simboli:", "Simboli della scuola"]) expect(text).not.toContain(ui);
  expect(text).toContain(ATTR);
  const rule = await page.locator("#caa-page").evaluate((e) => e.textContent);
  expect(rule).toContain("A4 landscape");
  expect(rule).toContain("25mm 25mm 34mm 25mm"); // il margine in fondo include lo spazio del piè di pagina
});

test("stampa: il piè di pagina facoltativo (titolo, autore, pagina); l'attribuzione non si può togliere", async ({ page }) => {
  await open(page, STORIES.repeat(2), true);
  await page.getByLabel("Titolo del documento").fill("La mia storia");
  const d = await openPrintDialog(page);
  // Con tutto spento c'è solo l'attribuzione.
  await d.getByRole("button", { name: "Chiudi" }).click();
  let text = pdfPages(await pdfOf(page)).join("\n");
  expect(text).toContain(ATTR);
  expect(text).not.toContain("La mia storia");
  await page.emulateMedia({ media: "screen" });
  const d2 = await openPrintDialog(page);
  await d2.getByLabel("il titolo").check();
  await d2.getByLabel("il numero di pagina").check();
  await d2.getByRole("button", { name: "Chiudi" }).click();
  text = pdfPages(await pdfOf(page)).join("\n");
  expect(text).toContain("La mia storia");
  expect(text).toContain(ATTR);
  // Nessuna impostazione toglie l'attribuzione.
  expect(await page.locator("#caa-page").evaluate((e) => e.textContent)).toContain(ATTR);
});

test("stampa: un titolo con virgolette, barre e a capo non rompe il piè di pagina", async ({ page }) => {
  await open(page, STORIES, true);
  await page.getByLabel("Titolo del documento").fill('Storia "bella" \\ fine } @page { x');
  const d = await openPrintDialog(page);
  await d.getByLabel("il titolo").check();
  await d.getByRole("button", { name: "Chiudi" }).click();
  const text = pdfPages(await pdfOf(page)).join("\n");
  expect(text).toContain(ATTR);
  expect(text).toContain('Storia "bella"');
  // La regola resta una sola e la stringa non è uscita dalle virgolette.
  const rule = await page.locator("#caa-page").evaluate((e) => e.textContent ?? "");
  const outside = rule.replace(/"(?:\\.|[^"\\])*"/g, '""'); // fuori dalle stringhe
  expect(outside.match(/@page/g)?.length).toBe(1);
  expect(outside.match(/[{}]/g)?.length).toBe(4); // @page { ... @bottom-center { ... } }
});

test("stampa: con un motore di pagine vecchio la finestra avvisa e l'attribuzione va in fondo al testo", async ({ page }) => {
  await open(page, "Marco mangia pane");
  await page.evaluate(() => { delete (window as any).CSSMarginRule; });
  const d = await openPrintDialog(page);
  await expect(d).toContainText("Aggiorna WebView2");
  await d.getByRole("button", { name: "Chiudi" }).click();
  expect(await page.evaluate(() => document.documentElement.classList.contains("p-nofooter"))).toBe(true);
  const text = pdfPages(await pdfOf(page)).join("\n");
  expect(text).toContain(ATTR); // in fondo al testo, visibile solo in stampa
  await page.emulateMedia({ media: "screen" });
  await expect(page.locator(".print-attr-flow")).toBeHidden();
});

test("stampa: caratteri di controllo (form feed, a capo, NUL) nel titolo non cancellano l'attribuzione", async ({ page }) => {
  await open(page, STORIES, true);
  const d = await openPrintDialog(page);
  await d.getByLabel("il titolo").check();
  await d.getByRole("button", { name: "Chiudi" }).click();
  for (const bad of ["a\fb", "a\u000bb", "a\u0085b", "a\rb\nc", "a\u2028b", "x\\"]) {
    await page.emulateMedia({ media: "screen" });
    await page.getByLabel("Titolo del documento").fill(bad);
    const text = pdfPages(await pdfOf(page)).join("\n");
    expect(text, JSON.stringify(bad)).toContain(ATTR);
  }
});

test("stampa: lo schermo segue i margini e l'orientamento scelti; un documento nuovo riparte dalle impostazioni di partenza", async ({ page }) => {
  await open(page, "", true);
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Pane e latte");
  const d = await openPrintDialog(page);
  await d.getByLabel("Orientamento").selectOption("landscape");
  await d.getByLabel("Margini (mm)").fill("25");
  await d.getByLabel("Margini (mm)").dispatchEvent("change");
  await d.getByRole("button", { name: "Chiudi" }).click();
  const box = await page.locator(".sheet").evaluate((e) => ({ w: e.getBoundingClientRect().width, pad: getComputedStyle(e).paddingLeft }));
  expect(Math.round(box.w)).toBe(1123); // A4 orizzontale a 96 dpi
  expect(parseFloat(box.pad)).toBeCloseTo((25 / 25.4) * 96, 0);
  await expect.poll(async () => (await mockSaves(page)).at(-1)?.prefs?.print?.margin).toBe(25);
  await page.getByRole("button", { name: "Nuovo" }).click();
  const cls = await page.evaluate(() => [...document.documentElement.classList]);
  expect(cls).not.toContain("p-landscape");
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--p-margin"))).toBe("15mm");
});


test("stampa: una frase per riga: gli a capo ci sono ma sullo schermo non si vedono; il testo non cambia", async ({ page }) => {
  await open(page, "Marco mangia. La mamma beve. Il gatto dorme.");
  await page.evaluate(() => { (window as any).__snap = null; window.print = () => { (window as any).__snap = { br: document.querySelectorAll("br.snl").length, cls: document.documentElement.classList.contains("p-oneper") }; }; });
  const d = await openPrintDialog(page);
  await d.getByLabel("Una frase per riga").check();
  await expect(page.locator("br.snl")).toHaveCount(2);
  expect(await page.locator("br.snl").first().evaluate((e) => getComputedStyle(e).display)).toBe("none"); // a schermo no
  await d.getByRole("button", { name: "Stampa" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__snap)).toEqual({ br: 2, cls: true });
  // Il testo del documento non è cambiato; spegnendo l'opzione gli a capo spariscono.
  expect(await page.evaluate(() => (window as any).caaProto.view.state.doc.textContent)).toBe("Marco mangia. La mamma beve. Il gatto dorme.");
  const d2 = await openPrintDialog(page);
  await d2.getByLabel("Una frase per riga").uncheck();
  await expect(page.locator("br.snl")).toHaveCount(0);
});

test("stampa: «una frase per riga» nel PDF: ogni frase comincia su una riga nuova", async ({ page }) => {
  const sentences = ["Marco mangia il pane.", "Anna beve il latte.", "Il gatto dorme."];
  await open(page, sentences.join(" "));
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0);
  const firstWords = ["Marco", "Anna", "Il"];
  const startsLine = (text: string, w: string) => text.split("\n").some((l) => new RegExp(`^\\s*${w}\\b`).test(l));
  // Senza l'opzione le frasi di seguito stanno sulla stessa riga (la pagina è larga).
  await page.keyboard.press("Control+1"); // piccolo
  let text = pdfPages(await pdfOf(page)).join("\n");
  expect(["Anna", "Il"].some((w) => !startsLine(text, w))).toBe(true);
  // Con l'opzione (accesa solo per la stampa) ogni frase va a capo.
  await page.emulateMedia({ media: "screen" });
  const dlg = await openPrintDialog(page);
  await dlg.getByLabel("Una frase per riga").check();
  await dlg.getByRole("button", { name: "Chiudi" }).click();
  text = pdfPages(await pdfOf(page)).join("\n");
  for (const w of firstWords) expect(startsLine(text, w)).toBe(true);
});

test("stampa: testo sopra, bordo, maiuscolo e carattere si vedono subito e il testo salvato non cambia", async ({ page }) => {
  await open(page, "Marco mangia pane");
  const d = await openPrintDialog(page);
  await d.getByLabel("Posizione del testo").selectOption("above");
  await d.getByLabel("Carattere").selectOption("lexend");
  await d.getByLabel("Bordo attorno a ogni simbolo").check();
  await d.getByLabel(/Tutto maiuscolo/).check();
  await d.getByRole("button", { name: "Chiudi" }).click();
  const cls = await page.evaluate(() => [...document.documentElement.classList]);
  for (const c of ["p-above", "pf-lexend", "p-border", "p-upper"]) expect(cls).toContain(c);
  expect(await page.locator(".ProseMirror").evaluate((e) => getComputedStyle(e).textTransform)).toBe("uppercase");
  const w = page.locator(".w", { hasText: /^pane$/ });
  expect(await w.evaluate((e) => [getComputedStyle(e).paddingTop, parseFloat(getComputedStyle(e).paddingBottom) > 0])).toEqual(["0px", true]);
  expect(await page.evaluate(() => (window as any).caaProto.view.state.doc.textContent)).toBe("Marco mangia pane");
});

test("stampa: le impostazioni stanno nel documento (si salvano, si ritrovano, valori strani si ripuliscono)", async ({ page }) => {
  await open(page, "", true);
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Pane e latte");
  const d = await openPrintDialog(page);
  await d.getByLabel("Orientamento").selectOption("landscape");
  await d.getByLabel("Carattere").selectOption("atkinson");
  await d.getByLabel(/Tutto maiuscolo/).check();
  await d.getByRole("button", { name: "Chiudi" }).click();
  await expect.poll(async () => (await mockSaves(page)).at(-1)?.prefs?.print?.orientation).toBe("landscape");
  expect((await mockSaves(page)).at(-1).prefs.print).toMatchObject({ orientation: "landscape", font: "atkinson", uppercase: true, margin: 15 });
  await page.getByRole("button", { name: "Nuovo" }).click();
  expect(await page.evaluate(() => [...document.documentElement.classList])).not.toContain("pf-atkinson"); // il nuovo riparte da zero
  await page.evaluate(() => {
    const save = (window as any).__mock.saves.at(-1);
    (window as any).__mock.docsStore.set("Strano.caa", { entry: { file: "Strano.caa", id: "id-x", title: "Strano", modified: new Date().toISOString(), rev: 1, author: "X", origin: null }, payload: { document: save.document, prefs: { print: { orientation: "sideways", margin: 9999, font: "comic", border: "sì", uppercase: true } }, render: [], sense_locks: [], lexicon: "lex-new" } });
  });
  await openStored(page, "Strano");
  const cls = await page.evaluate(() => [...document.documentElement.classList]);
  expect(cls).toContain("p-upper"); // il valore valido si tiene
  expect(cls).not.toContain("p-landscape"); // orientamento non valido: quello di partenza
  expect(cls).not.toContain("pf-lexend");
  expect(cls).not.toContain("p-border"); // «sì» non è un booleano
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--p-margin"))).toBe("40mm"); // margine ricondotto al massimo
});

test("stampa: Ctrl+P apre la finestra con Stampa e Chiudi", async ({ page }) => {
  await open(page, "Marco mangia pane");
  await page.keyboard.press("Control+p");
  await expect(page.locator(".print-dialog")).toBeVisible();
  await expect(page.locator(".print-dialog")).toContainText("Microsoft Print to PDF");
  await page.keyboard.press("Escape");
  await expect(page.locator(".print-dialog")).toHaveCount(0);
});

test("Informazioni: attribuzioni obbligatorie (ARASAAC, Morph-it!, ISDT, caratteri) e versione; non si stampa", async ({ page }) => {
  await open(page, "Marco mangia pane");
  await voceAltro(page, "Informazioni"); // M11-4: nel menu «Altro»
  const d = page.locator(".about-dialog");
  await expect(d).toContainText("Sergio Palao per ARASAAC");
  await expect(d).toContainText("CC BY-NC-SA");
  await expect(d).toContainText("Morph-it!");
  await expect(d).toContainText("ISDT");
  await expect(d).toContainText("SIL Open Font License");
  await expect(d).toContainText("Versione 0.1.0");
  // Con la finestra aperta, la stampa non la include.
  const file = await pdfOf(page);
  expect(pdfPages(file).join("\n")).not.toContain("Morph-it!");
  await page.emulateMedia({ media: "screen" });
  await page.keyboard.press("Escape");
  await expect(d).toHaveCount(0);
});
