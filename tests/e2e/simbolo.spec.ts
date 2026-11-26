// M11-7 · Scheda «Simbolo» e scheda «Memoria» del pannello laterale (PIANO-M11.md 3.5 punti 3-4, 3.6, 3.7, 3.10;
// difetti K4 e K14).
import { expect, test, type Page } from "@playwright/test";
import { open } from "./fixtures";

/* eslint-disable @typescript-eslint/no-explicit-any */

const clicSimbolo = (page: Page, parola: string) => page.locator(".w", { hasText: new RegExp(`^${parola}$`) }).first().click({ position: { x: 20, y: 8 } });
const scheda = (page: Page, nome: string) => page.getByRole("tab", { name: nome, exact: true });
const memoria = (page: Page) => page.locator(".side-memoria");
const tip = (page: Page) => page.locator(".tip");

/** Memoria, simboli personali e simboli della scuola del motore finto, prima di aprire il programma. */
const prepara = (page: Page, init: { mem?: unknown[]; custom?: unknown[]; shared?: Record<string, unknown> }) =>
  page.addInitScript((i) => {
    if (i.mem) (window as any).__memInit = i.mem;
    if (i.custom) (window as any).__customInit = i.custom;
    if (i.shared) {
      (window as any).__withSharedFlag = true;
      (window as any).__sharedInit = i.shared;
    }
  }, init);

test("scheda Simbolo: sezioni con un titolo, nell'ordine dello schermo; scorciatoie scritte come tasti, a 13 px", async ({ page }) => {
  await prepara(page, { custom: [{ id: 2147483648, uuid: "u-mela", label: "mela" }], shared: { symbols: [] } });
  await open(page, "Marco mangia pane");
  await clicSimbolo(page, "pane");
  await expect(page.locator(".pm-cell")).toHaveCount(8);
  const side = page.locator(".side");
  // La ricerca resta in cima, poi la parola, poi le sezioni.
  expect(await side.evaluate((s) => s.firstElementChild!.classList.contains("pm-search"))).toBe(true);
  await expect(side.locator(".pm-sec:not([hidden]) > .pm-sec-title")).toHaveText(["Alternative", "Scelte rapide", "I miei simboli", "Simboli della scuola", "Opzioni"]);
  // Ogni sezione ha il nome del suo titolo (per i lettori di schermo).
  for (const nome of ["Alternative", "Scelte rapide", "I miei simboli", "Simboli della scuola", "Opzioni"]) {
    await expect(page.getByRole("region", { name: nome })).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Alternative" }).locator(".pm-cell")).toHaveCount(8);
  await expect(page.getByRole("region", { name: "Scelte rapide" }).getByRole("button", { name: "Nessun simbolo" })).toBeVisible();
  await expect(page.getByRole("region", { name: "I miei simboli" }).locator(".pm-mini")).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Opzioni" }).locator(".pm-all input")).toBeVisible();
  await expect(page.getByRole("region", { name: "Opzioni" }).locator(".pm-always input")).toBeVisible();
  // Le sezioni stanno una sotto l'altra, nell'ordine dei titoli.
  const tops = await side.locator(".pm-sec:not([hidden])").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  expect([...tops].sort((a, b) => a - b)).toEqual(tops);
  // La riga in fondo: tasti veri, testo da 13 px.
  const keys = page.locator(".pm-keys");
  await expect(keys).toHaveText("1–8 scegli · Esc torna al testo · F8 prossima parola da controllare");
  await expect(keys.locator("kbd")).toHaveText(["1", "8", "Esc", "F8"]);
  expect(await keys.evaluate((e) => getComputedStyle(e).fontSize)).toBe("13px");
  // Con una ricerca il titolo dice che sono risultati.
  await page.locator(".pm-search").fill("ma");
  await expect(page.locator(".pm-sec-alt > .pm-sec-title")).toHaveText("Risultati della ricerca");
  await page.locator(".pm-search").fill("");
  await expect(page.locator(".pm-sec-alt > .pm-sec-title")).toHaveText("Alternative");
});

test("scheda Simbolo: senza simboli personali e senza biblioteca le loro sezioni non ci sono", async ({ page }) => {
  await open(page, "Marco mangia pane");
  await clicSimbolo(page, "pane");
  await expect(page.locator(".pm-cell")).toHaveCount(8);
  await expect(page.locator(".side .pm-sec:not([hidden]) > .pm-sec-title")).toHaveText(["Alternative", "Scelte rapide", "Opzioni"]);
});

test("Tab nella scheda Simbolo segue l'ordine dello schermo", async ({ page }) => {
  await prepara(page, { custom: [{ id: 2147483648, uuid: "u-mela", label: "mela" }], shared: { symbols: [] } });
  await open(page, "Marco mangia pane");
  await clicSimbolo(page, "pane");
  await expect(page.locator(".pm-cell")).toHaveCount(8);
  await page.locator(".pm-search").focus();
  const posti: Array<{ top: number; left: number; nome: string }> = [];
  for (let i = 0; i < 30; i++) {
    const f = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement;
      if (!e.closest(".side")) return null;
      // Posizione dentro la barra (che scorre mentre il fuoco va avanti).
      const side = e.closest<HTMLElement>(".side")!;
      const r = e.getBoundingClientRect();
      const top = r.top - side.getBoundingClientRect().top + side.scrollTop;
      return { top: Math.round(top), left: Math.round(r.left), nome: (e.getAttribute("aria-label") || e.textContent || e.tagName).trim().slice(0, 30) };
    });
    if (!f) break;
    posti.push(f);
    await page.keyboard.press("Tab");
  }
  expect(posti.length, "controlli raggiunti nella scheda").toBeGreaterThan(14);
  // Dall'alto in basso; nella stessa riga da sinistra a destra.
  for (let i = 1; i < posti.length; i++) {
    const [a, b] = [posti[i - 1], posti[i]];
    const ok = b.top > a.top + 2 || (Math.abs(b.top - a.top) <= 40 && b.left > a.left);
    expect(ok, `${a.nome} (${a.top},${a.left}) → ${b.nome} (${b.top},${b.left})`).toBe(true);
  }
});

test("scheda Simbolo vuota: una frase, le scorciatoie come tasti e «Vedi cosa ricordo» che apre la scheda Memoria", async ({ page }) => {
  await open(page, "Marco mangia pane");
  const vuota = page.locator(".side .side-empty");
  await expect(vuota).toBeVisible();
  await expect(vuota.getByRole("heading", { name: "Clicca il simbolo di una parola per cambiarlo" })).toBeVisible();
  await expect(vuota.locator("kbd")).toHaveText(["Alt", "↓", "F8"]);
  await expect(vuota.locator(".empty-ico svg")).toHaveCount(1);
  await vuota.getByRole("button", { name: "Vedi cosa ricordo" }).click();
  await expect(scheda(page, "Memoria")).toHaveAttribute("aria-selected", "true");
  await expect(scheda(page, "Memoria")).toBeFocused();
  await expect(memoria(page)).toBeVisible();
  await expect(page.locator(".side")).toBeHidden();
});

test("scheda Memoria: stato vuoto con la spiegazione", async ({ page }) => {
  await open(page, "Marco mangia pane");
  await scheda(page, "Memoria").click();
  await expect(memoria(page)).toContainText("Cosa ricordo");
  await expect(memoria(page)).toContainText("Non ricordo ancora nessuna scelta. Quando correggi un simbolo, spunta «ricorda per sempre».");
  await expect(page.locator(".side-memory")).toHaveCount(0);
  await expect(memoria(page).getByRole("button", { name: "Dimentica tutto" })).toHaveCount(0);
});

test("scheda Memoria: elenco, Dimentica, Dimentica tutto con la conferma del programma", async ({ page }) => {
  await prepara(page, { mem: [{ lemma: "pane", cat: "NOUN", form: "", picto: 1003 }, { lemma: "casa", cat: "NOUN", form: "", picto: 1004 }, { lemma: "", cat: "", form: "blorpf", picto: 1005 }] });
  await open(page, "pane e casa");
  await scheda(page, "Memoria").click();
  const elenco = page.locator(".side-memory");
  await expect(elenco.locator("li")).toHaveCount(3);
  await expect(elenco.locator("li").first()).toContainText("pane");
  // Dimentica una voce.
  await elenco.getByRole("button", { name: "Dimentica pane" }).click();
  await expect(elenco.locator("li")).toHaveCount(2);
  expect(await page.evaluate(() => (window as any).__mock.memory.map((m: any) => m.lemma || m.form))).toEqual(["casa", "blorpf"]);
  // Il fuoco resta nella scheda (non si perde con i pulsanti ridisegnati).
  expect(await page.evaluate(() => !!document.activeElement?.closest(".side-memoria"))).toBe(true);
  // Dimentica tutto: la finestra di conferma vera. «Annulla» non cambia niente.
  await page.evaluate(() => {
    delete (window as any).__caaConferma;
  });
  await elenco.getByRole("button", { name: "Dimentica tutto" }).click();
  const c = page.getByRole("alertdialog");
  await expect(c).toContainText("Dimenticare tutte le scelte «per sempre»?");
  await c.getByRole("button", { name: "Annulla" }).click();
  await expect(c).toBeHidden();
  await expect(elenco.locator("li")).toHaveCount(2);
  await elenco.getByRole("button", { name: "Dimentica tutto" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Dimentica tutto" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__mock.memory.length)).toBe(0);
  await expect(memoria(page)).toContainText("Non ricordo ancora nessuna scelta.");
});

test("scheda Memoria: una scelta «ricorda per sempre» fatta nella scheda Simbolo compare nell'elenco", async ({ page }) => {
  await open(page, "Marco mangia pane");
  await clicSimbolo(page, "pane");
  await page.locator(".pm-always input").check();
  await page.locator(".pm-cell").nth(1).click();
  await expect.poll(() => page.evaluate(() => (window as any).__mock.memory.length)).toBe(1);
  await scheda(page, "Memoria").click();
  await expect(page.locator(".side-memory li")).toHaveCount(1);
  await expect(page.locator(".side-memory li")).toContainText("pane");
});

test("scheda Memoria: i miei simboli si eliminano (con conferma) e spariscono anche dalla scheda Simbolo", async ({ page }) => {
  await prepara(page, { custom: [{ id: 2147483648, uuid: "u-mela", label: "mela" }, { id: 2147483649, uuid: "u-pane", label: "pane" }] });
  await open(page, "Marco mangia pane");
  await clicSimbolo(page, "pane");
  await expect(page.locator(".pm-custom .pm-mini")).toHaveCount(2);
  await scheda(page, "Memoria").click();
  const miei = page.getByRole("region", { name: "I miei simboli" });
  await expect(miei.locator("li")).toHaveCount(2);
  await page.evaluate(() => {
    delete (window as any).__caaConferma;
  });
  await miei.getByRole("button", { name: "Elimina il simbolo mela" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Elimina" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__mock.deletes)).toEqual(["u-mela"]);
  await expect(miei.locator("li")).toHaveCount(1);
  await scheda(page, "Simbolo").click();
  await expect(page.locator(".pm-custom .pm-mini")).toHaveCount(1);
});

test("← → fra le linguette Simbolo, Pagina e Memoria (in quest'ordine), Home e Fine", async ({ page }) => {
  await open(page, "Marco mangia pane");
  await scheda(page, "Simbolo").focus();
  await page.keyboard.press("ArrowRight");
  await expect(scheda(page, "Pagina")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(scheda(page, "Memoria")).toBeFocused();
  await expect(scheda(page, "Memoria")).toHaveAttribute("aria-selected", "true");
  await expect(memoria(page)).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(scheda(page, "Pagina")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(scheda(page, "Simbolo")).toBeFocused();
  await expect(page.locator(".side")).toBeVisible();
  await expect(memoria(page)).toBeHidden();
  await page.keyboard.press("End");
  await expect(scheda(page, "Memoria")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(scheda(page, "Simbolo")).toBeFocused(); // gira in tondo
});

test("un clic sul simbolo di una parola riporta alla scheda Simbolo; Esc nella Memoria torna al testo", async ({ page }) => {
  await open(page, "Marco mangia pane");
  await scheda(page, "Memoria").click();
  await expect(memoria(page)).toBeVisible();
  await clicSimbolo(page, "pane");
  await expect(scheda(page, "Simbolo")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".pm-cell")).toHaveCount(8);
  await scheda(page, "Memoria").click();
  await memoria(page).focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ProseMirror")).toBeFocused();
});

test("schermo stretto: Esc nella scheda Memoria richiude il pannello che sta sopra il foglio", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await open(page, "Marco mangia pane");
  await page.getByRole("button", { name: "Apri il pannello laterale" }).click();
  await scheda(page, "Memoria").click();
  await expect(page.locator(".side-panel")).toHaveClass(/sopra/);
  await memoria(page).focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".side-panel")).toHaveClass(/closed/);
  await expect(page.locator(".ProseMirror")).toBeFocused();
});

test("K14: i simboli della scuola sono etichette intere su righe proprie, con la × come pulsante a parte e con un nome", async ({ page }) => {
  await prepara(page, { shared: { symbols: [
    { uuid: "s1", label: "autobus", author: "Luca", can_retire: false },
    { uuid: "s2", label: "palestra", author: "Maria", can_retire: true },
    { uuid: "s3", label: "mensa scolastica della scuola primaria Carlo Collodi", author: "Anna Maria Bianchi", can_retire: true },
  ] } });
  await open(page, "Marco mangia pane");
  await clicSimbolo(page, "pane");
  await page.getByRole("button", { name: "Simboli della scuola…" }).click();
  const chip = page.locator(".pm-school .pm-mini-cell");
  await expect(chip).toHaveCount(3);
  const misure = await chip.evaluateAll((els) =>
    els.map((li) => {
      const main = li.querySelector<HTMLElement>(".pm-chip-main")!;
      const x = li.querySelector<HTMLElement>(".pm-chip-x");
      const name = li.querySelector<HTMLElement>(".pm-chip-name")!;
      const r = li.getBoundingClientRect();
      const m = main.getBoundingClientRect();
      const xr = x?.getBoundingClientRect() ?? null;
      const side = li.closest(".side")!.getBoundingClientRect();
      return {
        top: r.top,
        bottom: r.bottom,
        tagliato: name.scrollWidth > name.clientWidth + 1 || main.scrollWidth > main.clientWidth + 1,
        dentro: r.left >= side.left && r.right <= side.right,
        sovrapposti: xr ? xr.left < m.right && xr.right > m.left && xr.top < m.bottom && xr.bottom > m.top : false,
      };
    }),
  );
  for (let i = 0; i < misure.length; i++) {
    expect(misure[i].tagliato, `etichetta ${i + 1} tagliata`).toBe(false);
    expect(misure[i].dentro, `etichetta ${i + 1} dentro la barra`).toBe(true);
    expect(misure[i].sovrapposti, `× sopra l'etichetta ${i + 1}`).toBe(false);
    if (i > 0) expect(misure[i].top, "una riga per etichetta").toBeGreaterThanOrEqual(misure[i - 1].bottom - 1);
  }
  // Il nome intero si legge (anche quello lungo) e la × ha il suo nome.
  await expect(chip.nth(2)).toContainText("mensa scolastica della scuola primaria Carlo Collodi");
  await expect(chip.nth(2)).toContainText("Anna Maria Bianchi");
  await expect(page.getByRole("button", { name: "Ritira dalla scuola il simbolo palestra" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ritira dalla scuola il simbolo mensa scolastica della scuola primaria Carlo Collodi" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Ritira dalla scuola il simbolo autobus/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "autobus, di Luca" })).toBeVisible();
});

test("K4: «ricorda per sempre» spento con la spiegazione per un articolo, «che», una preposizione; acceso per un nome", async ({ page }) => {
  await open(page, "il pane di casa che piace");
  for (const parola of ["il", "di", "che"]) {
    await clicSimbolo(page, parola);
    await expect(page.locator(".pm-titles strong")).toHaveText(parola);
    await expect(page.locator(".pm-always input"), parola).toBeDisabled();
    await expect(page.locator(".pm-always input")).not.toBeChecked();
    await expect(page.locator(".pm-note")).toHaveText("Qui decide la politica delle parole funzionali.");
    await expect(page.locator(".pm-always input")).toHaveAccessibleDescription("Qui decide la politica delle parole funzionali.");
  }
  // Il suggerimento sul controllo spento spiega perché.
  await page.locator(".pm-always").hover();
  await expect(tip(page)).toHaveText(/decide la politica delle parole funzionali, nella barra degli strumenti/, { timeout: 2000 });
  await page.mouse.move(5, 300);
  // Un nome: acceso, senza la nota.
  await clicSimbolo(page, "pane");
  await expect(page.locator(".pm-titles strong")).toHaveText("pane");
  await expect(page.locator(".pm-always input")).toBeEnabled();
  await expect(page.locator(".pm-note")).toHaveCount(0);
});

test("K4: nella scheda Memoria le voci delle parole della politica hanno l'etichetta «la politica può nasconderla»", async ({ page }) => {
  await prepara(page, { mem: [
    { lemma: "il", cat: "ART", form: "", picto: 1003 },
    { lemma: "pane", cat: "NOUN", form: "", picto: 1004 },
    { lemma: "che", cat: "PRON", form: "", picto: 1005 },
    { lemma: "nel", cat: "ARTADP", form: "", picto: 1006 },
    { lemma: "e", cat: "CONJ", form: "", picto: 1007 },
    { lemma: "lo", cat: "CLITIC", form: "", picto: 1008 },
  ] });
  await open(page, "il pane");
  await scheda(page, "Memoria").click();
  const righe = page.locator(".side-memory li");
  await expect(righe).toHaveCount(6);
  const conEtichetta = await righe.evaluateAll((els) => els.map((li) => [li.querySelector(".mem-name")!.textContent, !!li.querySelector(".mem-chip")]));
  expect(conEtichetta).toEqual([["il", true], ["pane", false], ["che", true], ["nel", true], ["e", true], ["lo", true]]);
  await expect(righe.first().locator(".mem-chip")).toHaveText("la politica può nasconderla");
});
