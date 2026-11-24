// Prove di M8a: l'editor con i simboli del motore. Nel browser non c'è il motore vero: si usa un
// motore finto (in pagina) che riconosce le parole con regole semplici e risponde dopo qualche
// millisecondo. Le prove con il motore vero e con le immagini ARASAAC sono a mano (app Tauri).
import { expect, test, type Page } from "@playwright/test";

/* eslint-disable @typescript-eslint/no-explicit-any */
const MOCK = `
(function () {
  const calls = [];
  const svg = (id) => 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="hsl(' + (id % 360) + ',60%,60%)"/></svg>');
  const RE = /\\p{L}[\\p{L}\\p{M}]*['’]?|\\d+(?:[.,:]\\d+)*|[^\\s\\p{L}\\d]/gu;
  function tokens(text, policy, forced, locks) {
    const out = [];
    for (const m of text.matchAll(RE)) {
      const w = m[0], s = m.index, e = s + w.length;
      const punct = !/[\\p{L}\\d]/u.test(w);
      let t = { s, e, kind: punct ? 'punct' : 'word', display: punct ? 'text' : 'full', picto: punct ? null : (w.toLowerCase().charCodeAt(0) * 7 + w.length), image: !punct, mods: 0, group: 0, head: false, confidence: 1, doubtful: false, placeholder: false };
      const lw = w.toLowerCase();
      if (lw === 'il' || lw === 'la') t.display = policy === 'essential' ? 'hidden' : 'reduced';
      if (lw === 'sera') { t.picto = null; t.image = false; t.display = 'text'; t.placeholder = true; }
      if (lw === 'dubbio') { t.confidence = 0.4; t.doubtful = true; }
      if (lw === 'andato') t.mods = 2;
      if (lw === 'ferri') t.mods = 1;
      if (lw === 'andremo') t.mods = 4;
      if (lw === 'andati') t.mods = 3;
      if (!punct) { t.lemma = lw; t.cat = 'NOUN'; t.teacher = false; t.why = 'nome, prova'; }
      else { t.lemma = ''; t.cat = ''; t.teacher = false; t.why = ''; }
      const lock = locks.find((l) => l.lemma === t.lemma && l.cat === t.cat);
      if (lock) { t.picto = lock.picto; t.image = true; t.display = 'full'; t.placeholder = false; }
      const f = forced.find((x) => x.s === s && x.e === e);
      if (f) {
        t.teacher = true; t.confidence = 1; t.doubtful = false; t.why = 'nome, scelto da te';
        if (f.picto === 0) { t.picto = null; t.image = false; t.display = 'text'; t.placeholder = false; }
        else { t.picto = f.picto; t.image = true; t.display = 'full'; t.placeholder = false; }
      }
      out.push(t);
    }
    return out;
  }
  window.__mock = { calls, delay: 4, fail: 0, alts: [], searches: [], altDelay: 3 };
  return {
    symbolize: (paras, policy, locks) => { calls.push({ texts: paras.map((p) => p.text), paras, locks, policy }); return new Promise((r, rej) => setTimeout(() => { if (window.__mock.fail > 0) { window.__mock.fail--; rej(new Error('motore guasto')); } else r(paras.map((p) => tokens(p.text, policy, p.forced, locks))); }, window.__mock.delay)); },
    alternatives: (para, policy, locks, s, e) => { window.__mock.alts.push({ para, s, e }); return new Promise((r) => setTimeout(() => r([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({ picto: 1000 + i, keyword: 'alt' + i, reason: 'altro senso', image: i !== 3 }))), window.__mock.altDelay)); },
    search: (q) => { window.__mock.searches.push(q); return new Promise((r) => setTimeout(() => r(q === 'zzz' ? [] : [{ picto: 9001, keyword: q + 'a', reason: 'cercato', image: true }, { picto: 9002, keyword: q + 'b', reason: 'cercato', image: true }]), 3)); },
    url: (id) => svg(id),
  };
})()
`;

async function open(page: Page, text?: string): Promise<void> {
  page.on("dialog", (d) => void d.accept());
  await page.goto("/");
  await page.waitForFunction(() => (window as any).caaProto);
  await page.evaluate(
    ([mock, txt]) => {
      const p = (window as any).caaProto;
      p.setSize(68);
      if (txt !== undefined) {
        const doc = p.view.state.schema.nodes.doc.create(null, txt.split("\n").map((t: string) => p.view.state.schema.nodes.paragraph.create(null, t ? p.view.state.schema.text(t) : undefined)));
        p.view.updateState(p.view.state.constructor.create({ doc, plugins: p.view.state.plugins }));
      }
      p.enterEngineMode(eval(mock));
    },
    [MOCK, text] as const,
  );
  await page.waitForSelector(".w[style*='--img']");
}

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
  await page.selectOption("select", "essential");
  await expect(page.locator(".w.hid")).toHaveCount(2);
  await expect(page.locator(".w.red")).toHaveCount(0);
  await page.selectOption("select", "complete");
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
  await page.selectOption("select", "essential");
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
  await page.selectOption("select", "essential");
  // «Testo di esempio»: sostituisce tutto il documento.
  await page.getByRole("button", { name: "Testo di esempio" }).click();
  await expect(page.locator(".w[style*='--img']").first()).toBeVisible();
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0);
  expect((await stats(page)).words).toBeGreaterThan(50);
  expect(await page.locator("select").inputValue()).toBe("essential");
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
  expect(picks[0]).toMatchObject({ text: "pane", word: "pane", picto: 1002, lock: 1, lemma: "pane", cat: "NOUN" });
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
  expect(last.locks).toEqual([{ lemma: "pane", cat: "NOUN", picto: 1002 }]);
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
  expect(await docPicks(page)).toHaveLength(2);
  // Una scelta con blocco («tutto il testo») sostituisce anche le scelte singole delle parole uguali:
  // resta una sola scelta e tutte le occorrenze hanno lo stesso simbolo.
  await clickSymbol(page, "pane", 2);
  await expect(page.locator(".pm-all input")).not.toBeChecked(); // la spunta tolta prima resta tolta
  await page.locator(".pm-all input").check();
  await page.locator(".pm-cell").nth(4).click();
  await expect.poll(async () => (await docPicks(page)).length).toBe(1);
  expect((await docPicks(page))[0]).toMatchObject({ lock: 1, picto: 1005 });
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
  await page.getByRole("button", { name: "Testo di esempio" }).click();
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0);
  const marks = () => page.evaluate(() => { let n = 0; (window as any).caaProto.view.state.doc.descendants((x: any) => { for (const m of x.marks ?? []) if (m.type.name === "pick") n++; }); return n; });
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
  await page.getByLabel("Contorna simbolo e parola").check();
  expect(await card.evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe("2px");
  await expect(page.locator(".sheet.cards")).toHaveCount(1);
  // Simbolo e parola restano uniti nella card (un solo blocco).
  expect(await page.evaluate(() => (window as any).caaProto.checkWrap().broken)).toBe(0);
  await page.reload();
  await page.waitForFunction(() => (window as any).caaProto);
  await page.evaluate(() => { (window as any).caaProto.enterEngineMode({ symbolize: async () => [], alternatives: async () => [], search: async () => [], url: () => "" }); });
  await expect(page.locator(".sheet.cards")).toHaveCount(1);
  await page.getByLabel("Contorna simbolo e parola").uncheck();
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
