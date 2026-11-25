// M11-1 · Tavolozza, contrasto e fuoco da tastiera dell'interfaccia (PIANO-M11.md, 2.2, 2.6 e 3.8).
//
// 1. Le coppie della tavolozza rispettano WCAG AA: almeno 4,5:1 per il testo, 3:1 per bordi dei controlli e anello
//    di fuoco (i valori si leggono dalle variabili CSS vere, non da una copia).
// 2. Il contrasto vero: in diverse situazioni del programma, ogni testo visibile dell'interfaccia contro lo sfondo su
//    cui sta davvero (il foglio è escluso: non cambia; i pulsanti spenti sono esclusi, come dice WCAG).
// 3. Il fuoco da tastiera: andando avanti con Tab, ogni controllo raggiunto mostra un anello di almeno 2 px.
import { expect, test, type Page } from "@playwright/test";
import { apriCompleto, documentiSalvati, tuttiGliAvvisi } from "./schermi";

/* eslint-disable @typescript-eslint/no-explicit-any */

type RGB = [number, number, number];
const hex = (h: string): RGB => {
  const m = h.trim().replace("#", "");
  return [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16)) as RGB;
};
const lum = ([r, g, b]: RGB) => {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrasto = (a: RGB, b: RGB) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

/** Le coppie della tavolozza (testo o bordo, sfondo, minimo). */
const COPPIE: Array<[string, string, number]> = [
  ["--c-text", "--c-bar", 4.5],
  ["--c-text", "--c-panel", 4.5],
  ["--c-text-2", "--c-surface", 4.5],
  ["--c-text-2", "--c-bar", 4.5],
  ["--c-text-2", "--c-panel", 4.5],
  ["--c-text-3", "--c-bar", 4.5],
  ["--c-text-3", "--c-panel", 4.5],
  ["--c-text-3", "--c-surface", 4.5],
  ["--c-control-line", "--c-bar", 3],
  ["--c-control-line", "--c-surface", 3],
  ["--c-control-line", "--c-panel", 3],
  ["--n-0", "--c-accent", 4.5],
  ["--n-0", "--c-accent-hover", 4.5],
  ["--c-accent-hover", "--c-selected", 4.5],
  ["--c-accent-hover", "--c-surface", 4.5],
  ["--c-focus", "--c-surface", 3],
  ["--c-focus", "--c-bar", 3],
  ["--doubt-fg", "--c-surface", 4.5],
  ["--doubt-fg", "--c-bar", 4.5],
  ["--ok-fg", "--ok-bg", 4.5],
  ["--ok-fg", "--c-panel", 4.5],
  ["--warn-fg", "--warn-bg", 4.5],
  ["--err-fg", "--err-bg", 4.5],
  ["--err-fg", "--c-panel", 4.5],
  ["--n-0", "--err-fg", 4.5],
  ["--p-800", "--p-100", 4.5],
  ["--p-800", "--c-accent-soft", 4.5],
];

test("le coppie della tavolozza rispettano WCAG AA (testo 4,5:1, bordi e fuoco 3:1)", async ({ page }) => {
  await page.goto("/");
  const v = await page.evaluate((nomi) => {
    const cs = getComputedStyle(document.documentElement);
    return Object.fromEntries(nomi.map((n) => [n, cs.getPropertyValue(n).trim()]));
  }, [...new Set(COPPIE.flatMap(([a, b]) => [a, b]))]);
  const mancano = Object.entries(v).filter(([, x]) => !/^#[0-9a-f]{6}$/i.test(x)).map(([n]) => n);
  expect(mancano, "variabili della tavolozza mancanti o non in #rrggbb").toEqual([]);
  const sotto = COPPIE.map(([a, b, min]) => ({ a, b, min, c: Math.round(contrasto(hex(v[a]), hex(v[b])) * 100) / 100 })).filter((x) => x.c < x.min);
  expect(sotto, "coppie sotto il minimo").toEqual([]);
});

/** I testi visibili dell'interfaccia con contrasto insufficiente contro il loro sfondo vero. */
const contrastoVero = (page: Page) =>
  page.evaluate(() => {
    const rgba = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
    const lumi = (c: number[]) => {
      const f = (x: number) => {
        const s = x / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    // Lo sfondo vero: si sale finché si trova un colore pieno, componendo quelli trasparenti.
    const sfondo = (e: Element | null): number[] => {
      const strati: number[][] = [];
      for (let x = e; x; x = x.parentElement) {
        const c = rgba(getComputedStyle(x).backgroundColor);
        const a = c.length > 3 ? c[3] : 1;
        if (a > 0) {
          strati.push([c[0], c[1], c[2], a]);
          if (a >= 1) break;
        }
      }
      let out = [255, 255, 255];
      for (const [r, g, b, a] of strati.reverse()) out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)];
      return out;
    };
    const male: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent?.trim();
      const e = n.parentElement;
      if (!t || !e || e.closest(".sheet, script, style, option, [hidden]") || e.closest("button:disabled, select:disabled, input:disabled")) continue;
      const r = document.createRange();
      r.selectNodeContents(n);
      const box = r.getBoundingClientRect();
      if (box.width < 1 || box.height < 1 || getComputedStyle(e).visibility === "hidden") continue;
      // Solo il testo davvero in vista (non coperto da un velo o da una finestra).
      const top = document.elementFromPoint(box.left + Math.min(box.width / 2, 4), box.top + box.height / 2);
      if (!top || !(top === e || e.contains(top) || top.contains(e))) continue;
      const cs = getComputedStyle(e);
      const fg = rgba(cs.color);
      const bg = sfondo(e);
      const [l1, l2] = [lumi(fg), lumi(bg)].sort((a, b) => b - a);
      const c = (l1 + 0.05) / (l2 + 0.05);
      const px = parseFloat(cs.fontSize);
      const grande = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
      const min = grande ? 3 : 4.5;
      if (c < min - 0.005) male.push(`«${t.slice(0, 30)}» ${c.toFixed(2)}:1 (minimo ${min}) ${cs.color} su rgb(${bg.map(Math.round).join(", ")})`);
    }
    return [...new Set(male)];
  });

const SITUAZIONI: Array<[string, (page: Page) => Promise<void>]> = [
  ["foglio", (page) => apriCompleto(page)],
  ["alternative", async (page) => {
    await apriCompleto(page);
    await page.locator(".w", { hasText: /^mamma$/ }).first().click({ position: { x: 20, y: 8 } });
    await page.locator(".pm-cell").first().waitFor();
  }],
  ["personalizzato", async (page) => {
    await apriCompleto(page);
    await page.selectOption("select[aria-label='Politica delle parole funzionali']", "custom");
  }],
  ["documenti", async (page) => {
    await apriCompleto(page);
    await documentiSalvati(page);
    await page.getByRole("button", { name: "Documenti" }).click();
    await page.locator(".docs-row").first().waitFor();
  }],
  ["biblioteca", async (page) => {
    await apriCompleto(page);
    await page.getByRole("button", { name: "Documenti" }).click();
    await page.locator(".docs-panel").getByRole("button", { name: "Biblioteca" }).click();
    await page.locator(".docs-panel .docs-row").first().waitFor();
  }],
  ["stampa", async (page) => {
    await apriCompleto(page);
    await page.getByRole("button", { name: /^Stampa/ }).click();
  }],
  ["informazioni", async (page) => {
    await apriCompleto(page);
    await page.getByRole("button", { name: "Informazioni" }).click();
  }],
  ["avvisi", (page) => tuttiGliAvvisi(page)],
];

test.describe("contrasto vero dei testi dell'interfaccia", () => {
  for (const [nome, prepara] of SITUAZIONI) {
    test(nome, async ({ page }) => {
      await prepara(page);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(150);
      expect(await contrastoVero(page)).toEqual([]);
    });
  }
});

/** Avanti con Tab fino a tornare al punto di partenza; per ogni controllo raggiunto: com'è l'anello di fuoco. */
async function giroDiTab(page: Page, max = 120): Promise<string[]> {
  const male: string[] = [];
  const visti = new Set<string>();
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const f = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement | null;
      if (!e || e === document.body) return null;
      const id = e.outerHTML.slice(0, 120) + (e.getBoundingClientRect().top | 0);
      if (e.closest(".sheet")) return { id, salta: true };
      const cs = getComputedStyle(e);
      const anello = cs.outlineStyle !== "none" ? parseFloat(cs.outlineWidth) : 0;
      const ombra = cs.boxShadow !== "none";
      const nome = (e.getAttribute("aria-label") || e.textContent || e.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
      return { id, salta: false, anello, ombra, nome: `${e.tagName.toLowerCase()} «${nome}»`, visibile: e.matches(":focus-visible") };
    });
    if (!f) continue;
    if (visti.has(f.id)) break;
    visti.add(f.id);
    if (f.salta) continue;
    if (!f.visibile) male.push(`${f.nome}: il fuoco da tastiera non è «visibile»`);
    else if ((f.anello ?? 0) < 2 && !f.ombra) male.push(`${f.nome}: anello di ${f.anello} px`);
  }
  expect(visti.size, "il giro con Tab deve toccare dei controlli").toBeGreaterThan(3);
  return male;
}

/** Il fuoco «da tastiera» dato a ogni controllo visibile dell'interfaccia, uno per uno: com'è l'anello. Vale anche
 *  dove il tasto Tab ha un altro compito (nella barra laterale porta alla prossima parola da controllare). */
async function anelliDiTutti(page: Page): Promise<{ male: string[]; quanti: number }> {
  await page.keyboard.press("Shift"); // l'ultima azione è da tastiera: il fuoco dato dopo è «visibile»
  return page.evaluate(() => {
    const male: string[] = [];
    const tutti = [...document.querySelectorAll<HTMLElement>("button, select, input, textarea, a[href], [tabindex]:not([tabindex='-1'])")].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !e.closest(".sheet, [hidden]") && !(e as HTMLButtonElement).disabled;
    });
    for (const e of tutti) {
      e.focus({ focusVisible: true } as FocusOptions);
      if (document.activeElement !== e) continue;
      const cs = getComputedStyle(e);
      const anello = cs.outlineStyle !== "none" ? parseFloat(cs.outlineWidth) : 0;
      const nome = (e.getAttribute("aria-label") || e.textContent || e.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
      if (!e.matches(":focus-visible")) male.push(`${e.tagName.toLowerCase()} «${nome}»: il fuoco da tastiera non è «visibile»`);
      else if (anello < 2 && cs.boxShadow === "none") male.push(`${e.tagName.toLowerCase()} «${nome}»: anello di ${anello} px`);
    }
    return { male, quanti: tutti.length };
  });
}

test.describe("fuoco da tastiera: anello di almeno 2 px su ogni controllo", () => {
  for (const [nome, prepara] of SITUAZIONI) {
    test(`${nome}: ogni controllo`, async ({ page }) => {
      await prepara(page);
      const r = await anelliDiTutti(page);
      expect(r.quanti, "controlli trovati").toBeGreaterThan(3);
      expect(r.male).toEqual([]);
    });
  }
  // Il giro con Tab dove Tab passa davvero da un controllo all'altro.
  for (const [nome, prepara] of SITUAZIONI.filter(([n]) => ["foglio", "documenti", "biblioteca", "stampa", "informazioni", "avvisi"].includes(n))) {
    test(`${nome}: giro con Tab`, async ({ page }) => {
      await prepara(page);
      expect(await giroDiTab(page)).toEqual([]);
    });
  }
});
