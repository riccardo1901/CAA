// Prove di accettazione di M3 (SPEC.md, "Resa simbolo sopra la parola"), eseguite nel browser.
// Le prove 5 (parte dal sistema operativo), 6 (correttore di sistema) e quelle sul PC Windows
// restano a mano: vedi il pannello dell'app e docs/RAPPORTO-M3.md.
import { expect, test, type Page } from "@playwright/test";

const MODES = (process.env.CAA_MODES ?? "A").split(",");
const SIZES: Array<[string, number]> = [["piccolo", 45], ["medio", 68], ["grande", 94], ["molto grande", 151]];

/* eslint-disable @typescript-eslint/no-explicit-any */
const proto = (page: Page) => ({
  eval: <T>(fn: (p: any) => T) => page.evaluate((src) => new Function("p", `return (${src})(p)`)((window as any).caaProto), fn.toString()) as Promise<T>,
});

async function open(page: Page, mode: string, size = 68, repeat = 1): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).caaProto);
  await page.evaluate(([m, s, r]) => {
    const p = (window as any).caaProto;
    p.setMode(m);
    p.setSize(s);
    p.loadSample(r);
  }, [mode, size, repeat] as const);
  await page.waitForSelector(mode === "A" ? ".w" : ".wb");
}

const wordSel = (mode: string) => (mode === "A" ? ".w" : ".wb");

for (const mode of MODES) {
  test.describe(`resa ${mode}`, () => {
    test("1 · frecce destra e sinistra non saltano e tornano al punto di partenza", async ({ page }) => {
      await open(page, mode);
      const p = proto(page);
      await p.eval((c) => c.setCaret(1));
      const start = await p.eval((c) => c.domHead());
      const forward: number[] = [start];
      for (let i = 0; i < 80; i++) {
        await page.keyboard.press("ArrowRight");
        forward.push(await p.eval((c) => c.domHead()));
      }
      for (let i = 1; i < forward.length; i++) {
        const d = forward[i] - forward[i - 1];
        expect(d, `passo ${i}: ${forward[i - 1]} → ${forward[i]}`).toBeGreaterThanOrEqual(1);
        expect(d, `passo ${i}`).toBeLessThanOrEqual(2); // 2 solo al confine tra due blocchi
      }
      for (let i = forward.length - 2; i >= 0; i--) {
        await page.keyboard.press("ArrowLeft");
        expect(await p.eval((c) => c.domHead()), `ritorno al passo ${i}`).toBe(forward[i]);
      }
    });

    test("1 · frecce su e giù spostano di una riga alla volta", async ({ page }) => {
      await open(page, mode);
      const p = proto(page);
      const pitch = (await page.locator(wordSel(mode)).first().boundingBox())!.height;
      // Cursore dentro il secondo paragrafo (dopo il titolo e il primo paragrafo).
      await p.eval((c) => c.setCaret(c.view.state.doc.child(0).nodeSize + c.view.state.doc.child(1).nodeSize + 12));
      const tops: number[] = [await p.eval((c) => c.caret().top)];
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press("ArrowDown");
        tops.push(await p.eval((c) => c.caret().top));
      }
      for (let i = 1; i < tops.length; i++) {
        const d = tops[i] - tops[i - 1];
        expect(d, `ArrowDown ${i}`).toBeGreaterThan(pitch * 0.6);
        expect(d, `ArrowDown ${i}`).toBeLessThan(pitch * 1.7);
      }
      for (let i = tops.length - 2; i >= 0; i--) {
        await page.keyboard.press("ArrowUp");
        expect(await p.eval((c) => c.caret().top), `ArrowUp verso la riga ${i}`).toBeCloseTo(tops[i], 0);
      }
    });

    test("2 · selezione col mouse su più righe", async ({ page }) => {
      await open(page, mode);
      const words = page.locator(wordSel(mode));
      const first = (await words.nth(3).boundingBox())!;
      let lastIdx = -1;
      for (let i = 4; i < 200; i++) {
        const b = (await words.nth(i).boundingBox())!;
        if (b.y > first.y + first.height * 2.9) { lastIdx = i; break; }
      }
      expect(lastIdx).toBeGreaterThan(0);
      const last = (await words.nth(lastIdx).boundingBox())!;
      const x1 = first.x + 3, y1 = first.y + first.height - 8;
      const x2 = last.x + last.width - 3, y2 = last.y + last.height - 8;
      await page.mouse.move(x1, y1);
      await page.mouse.down();
      await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 8 });
      await page.mouse.move(x2, y2, { steps: 8 });
      await page.mouse.up();
      const p = proto(page);
      const sel = await p.eval((c) => c.selection());
      const down = await page.evaluate(([x, y]) => (window as any).caaProto.posAt(x, y), [x1, y1]);
      const up = await page.evaluate(([x, y]) => (window as any).caaProto.posAt(x, y), [x2, y2]);
      expect(Math.abs(sel.anchor - down!)).toBeLessThanOrEqual(1);
      expect(Math.abs(sel.head - up!)).toBeLessThanOrEqual(1);
      expect(sel.to - sel.from).toBeGreaterThan(15);
      const rows = await page.evaluate(([f, t]) => { const c = (window as any).caaProto; return [c.caret(f).top, c.caret(t).top]; }, [sel.from, sel.to]);
      expect(rows[1] - rows[0]).toBeGreaterThan(first.height * 2.5);
    });

    test("3 · doppio clic seleziona la parola", async ({ page }) => {
      await open(page, mode);
      const words = page.locator(wordSel(mode));
      const total = await words.count();
      let tested = 0;
      for (let i = 5; i < total && tested < 6; i += 7) {
        const text = ((await words.nth(i).textContent()) ?? "").trim();
        if (!/^\p{L}{4,}$/u.test(text)) continue;
        await words.nth(i).scrollIntoViewIfNeeded(); // il foglio scorre: la parola deve essere in vista
        const b = (await words.nth(i).boundingBox())!;
        await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height - 9);
        const selected = await page.evaluate(() => (window as any).caaProto && window.getSelection()?.toString());
        expect((selected ?? "").trim(), `parola ${i}`).toBe(text);
        tested++;
      }
      expect(tested).toBeGreaterThanOrEqual(5);
    });

    for (const [label, size] of SIZES) {
      test(`4 · a capo: il simbolo non si separa dalla parola (${label}, ${size} px)`, async ({ page }) => {
        await open(page, mode, size, 2);
        for (const width of [794, 560, 420]) {
          await page.evaluate((w) => (window as any).caaProto.setSheetWidth(w), width);
          const r = await page.evaluate(() => (window as any).caaProto.checkWrap());
          expect(r.broken, `larghezza ${width}: ${r.examples.join("; ")}`).toBe(0);
          expect(r.words).toBeGreaterThan(400);
        }
      });
    }

    test("4 · il grassetto parziale non duplica il simbolo di una parola", async ({ page }) => {
      await open(page, mode);
      const r = await page.evaluate(() => (window as any).caaProto.checkWrap());
      expect(r.fragments, "pezzi di parola in più (un simbolo per pezzo)").toBe(0);
    });

    test("4 · la formattazione si applica a parole intere: nessuna parola spezzata", async ({ page }) => {
      await open(page, mode, 45);
      // Documento con parole spezzate: all'apertura vengono riallineate.
      await page.evaluate(() => (window as any).caaProto.loadFragments());
      for (let width = 300; width <= 760; width += 29) {
        await page.evaluate((w) => (window as any).caaProto.setSheetWidth(w), width);
        const r = await page.evaluate(() => (window as any).caaProto.checkWrap());
        expect(r.fragments, `larghezza ${width}`).toBe(0);
        expect(r.broken, `larghezza ${width}: ${r.examples.join("; ")}`).toBe(0);
      }
      const p = proto(page);
      // Ctrl+B su una selezione che copre solo metà parola: il grassetto va sull'intera parola.
      await page.evaluate(() => (window as any).caaProto.loadSample(1));
      const found = await p.eval((c) => {
        let hit = -1;
        c.view.state.doc.descendants((n: any, pos: number) => {
          if (hit < 0 && n.isText && n.text.includes("bambina e")) hit = pos + n.text.indexOf("bambina");
          return hit < 0;
        });
        return hit;
      });
      expect(found).toBeGreaterThan(0);
      await p.eval((c) => c.setCaret(1, 1));
      await page.evaluate((from) => (window as any).caaProto.setCaret(from + 2, from + 5), found); // "mbi" dentro "bambina"
      await page.keyboard.press("Control+b");
      const bold = await p.eval((c) => {
        const out: string[] = [];
        c.view.state.doc.descendants((n: any) => {
          if (n.isText && n.marks.length) out.push(n.text);
          return true;
        });
        return out;
      });
      expect(bold).toContain("bambina");
      expect(bold.some((t: string) => t !== "bambina" && t.length < 6 && /mbi/.test(t))).toBe(false);
      // Incollare HTML con grassetto a metà parola: la parola resta uniforme.
      await p.eval((c) => c.setCaret(c.docSize() - 1));
      await page.evaluate(() => (window as any).caaProto.pasteHTML("<p>gras<b>setto</b> e <b>pa</b>rola</p>"));
      const r2 = await page.evaluate(() => (window as any).caaProto.checkWrap());
      expect(r2.fragments).toBe(0);
    });

    test("5 · copia e incolla", async ({ page }) => {
      await open(page, mode);
      const p = proto(page);
      const sizeBefore = await p.eval((c) => c.docSize());
      // Seleziona il primo paragrafo dopo il titolo, copia, incolla in fondo.
      const range = await p.eval((c) => { const t = c.view.state.doc.child(0).nodeSize; return [t + 1, t + c.view.state.doc.child(1).nodeSize - 1]; });
      await p.eval((c) => c.setCaret(c.view.state.doc.child(0).nodeSize + 1, c.view.state.doc.child(0).nodeSize + c.view.state.doc.child(1).nodeSize - 1));
      await page.keyboard.press("Control+c");
      await p.eval((c) => c.setCaret(c.docSize() - 1));
      await page.keyboard.press("Control+v");
      const copied = await p.eval((c) => c.text(c.view.state.doc.child(0).nodeSize + 1, c.view.state.doc.child(0).nodeSize + c.view.state.doc.child(1).nodeSize - 1));
      const tail = await p.eval((c) => c.text(c.docSize() - 400, c.docSize()));
      expect(await p.eval((c) => c.docSize())).toBeGreaterThan(sizeBefore + (range[1] - range[0]) - 5);
      expect(tail).toContain(copied.slice(-40));

      // Da Word o dal web: titoli e grassetto sì; colori, caratteri e script no.
      await p.eval((c) => c.setCaret(c.docSize() - 1));
      await page.evaluate(() => (window as any).caaProto.pasteHTML('<h1 style="color:red">Titolo incollato</h1><p style="font-family:Comic Sans MS;color:#f0f">Testo <span style="background:yellow">evidenziato</span> e <b>grassetto</b><script>alert(1)</script></p>'));
      const json = JSON.stringify(await p.eval((c) => c.docJSON()));
      expect(json).toContain("Titolo incollato");
      expect(json).toContain('"type":"heading"');
      expect(json).toContain('"type":"strong"');
      expect(json).not.toMatch(/alert|color|font-family|background/);
    });

    test("6 · il campo di scrittura dichiara lingua italiana e correttore attivo", async ({ page }) => {
      await open(page, mode);
      await expect(page.locator(".ProseMirror")).toHaveAttribute("lang", "it");
      await expect(page.locator(".ProseMirror")).toHaveAttribute("spellcheck", "true");
    });

    for (const [label, size] of SIZES) {
      test(`extra · un clic sul simbolo individua la parola giusta (${label})`, async ({ page }) => {
        await open(page, mode, size);
        const r = await page.evaluate(() => (window as any).caaProto.checkSymbolHits());
        expect(r.tested).toBeGreaterThan(300);
        expect(r.wrong, r.examples.join("; ")).toBe(0);
        // Informativo: il cursore messo col mouse sul simbolo sbaglia al più in rari casi (grassetto).
        expect(r.caretMisses / r.tested).toBeLessThan(0.02);
      });
    }

    test("7 · digitando dal vivo le battute arrivano tutte", async ({ page }) => {
      await open(page, mode, 68, 3);
      const p = proto(page);
      await p.eval((c) => c.setCaret(c.view.state.doc.child(0).nodeSize + c.view.state.doc.child(1).nodeSize - 1));
      const text = "Il gatto è già stanco perché dorme. ";
      await page.keyboard.type(text.repeat(5), { delay: 0 });
      const para = await p.eval((c) => c.view.state.doc.child(1).textContent);
      expect(para.endsWith(text.repeat(5))).toBe(true);
    });

    // Dipende dalla velocità della macchina: non gira nella CI (`--grep-invert @perf`).
    test("7 · velocità: 95° percentile sotto i 30 ms con tre pagine @perf", async ({ page }) => {
      await open(page, mode, 68, 3);
      const r = await page.evaluate(() => (window as any).caaProto.benchmark(400));
      console.log(`resa ${mode}: ${r.keystrokes} battute su ${r.words} parole · mediana ${r.medianMs.toFixed(1)} ms · p95 ${r.p95Ms.toFixed(1)} ms · max ${r.maxMs.toFixed(1)} ms`);
      expect(r.p95Ms).toBeLessThan(30);
    });
  });
}
