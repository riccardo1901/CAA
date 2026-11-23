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
  window.__mock = { calls, delay: 4 };
  return {
    symbolize: (texts, policy) => { calls.push({ texts, policy }); return new Promise((r) => setTimeout(() => r(texts.map((t) => tokens(t, policy))), window.__mock.delay)); },
    url: (id) => svg(id),
  };
})()
`;

async function open(page: Page, text?: string): Promise<void> {
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
  await page.evaluate(() => { (window as any).__mock.delay = 60; });
  const before = await page.locator(".w[style*='--img']").count();
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" casa", { delay: 0 });
  // Subito dopo la digitazione, i simboli di prima ci sono ancora (spostati, non cancellati).
  const immediately = await page.locator(".w[style*='--img']").count();
  expect(immediately).toBeGreaterThanOrEqual(before);
  // Dopo la risposta c'è anche "casa".
  await expect(page.locator(".w[style*='--img']", { hasText: "casa" })).toHaveCount(1);
  expect(await page.locator(".w[style*='--img']").count()).toBe(before + 1);
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

test("il formato in grassetto non spezza il simbolo e i paragrafi uguali partono una volta sola", async ({ page }) => {
  await open(page, "casa\ncasa\ncasa");
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0);
  const calls = await page.evaluate(() => (window as any).__mock.calls as Array<{ texts: string[] }>);
  expect(calls.flatMap((c) => c.texts).filter((t) => t === "casa")).toHaveLength(1);
  await expect(page.locator(".w[style*='--img']")).toHaveCount(3);
});

test("dal tasto al simbolo: la parola nuova ha il simbolo in meno di 30 ms oltre l'attesa del motore", async ({ page }) => {
  await open(page, "Marco mangia");
  await page.evaluate(() => { (window as any).__mock.delay = 2; });
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("End");
  const ms = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const p = (window as any).caaProto;
        const t0 = performance.now();
        const done = () => {
          const found = [...document.querySelectorAll(".w[style*='--img']")].some((e) => e.textContent === "pane");
          if (found) resolve(performance.now() - t0);
          else requestAnimationFrame(done);
        };
        const view = p.view;
        view.dispatch(view.state.tr.insertText(" pane", view.state.doc.content.size - 1));
        done();
      }),
  );
  expect(ms, `tempo ${ms.toFixed(1)} ms`).toBeLessThan(30);
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
