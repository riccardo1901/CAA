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
  function tokens(text, policy) {
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
      out.push(t);
    }
    return out;
  }
  window.__mock = { calls, delay: 4, fail: 0 };
  return {
    symbolize: (texts, policy) => { calls.push({ texts, policy }); return new Promise((r, rej) => setTimeout(() => { if (window.__mock.fail > 0) { window.__mock.fail--; rej(new Error('motore guasto')); } else r(texts.map((t) => tokens(t, policy))); }, window.__mock.delay)); },
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
