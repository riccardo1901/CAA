// M11-6 · Documenti e Biblioteca (PIANO-M11.md 2.7, 3.4, 3.6, 3.9 flusso B; difetti K1 e K17).
// Righe con un'azione principale e il menu «⋯», Pubblica come sotto-pagina con «← Indietro», «Ritira» solo con il
// permesso vero calcolato dal programma, Correzioni in una scheda propria, stati vuoti, tastiera.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { azioneRiga, open, voceRiga } from "./fixtures";
import { apriCompleto, BIBLIOTECA, documentiSalvati, LIB_ENTRIES } from "./schermi";

/* eslint-disable @typescript-eslint/no-explicit-any */

const panel = (page: Page) => page.locator(".docs-panel");
const riga = (page: Page, titolo: string) => page.locator(".docs-panel .docs-row", { hasText: titolo });
const conferme = (page: Page) =>
  page.evaluate(() => {
    delete (window as any).__caaConferma; // la finestra di conferma vera
  });
const withCorrections = (page: Page, corr: Record<string, unknown> = {}) =>
  page.addInitScript((c) => {
    (window as any).__withCorrFlag = true;
    (window as any).__corrInit = c;
  }, corr);
const scheda = (page: Page, nome: string) => panel(page).getByRole("tab", { name: nome, exact: true });

/** Il nome del controllo che ha il fuoco. */
const fuoco = (page: Page) => page.evaluate(() => (document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent || "").trim());

/** Ogni controllo visibile dentro `dove`: con il fuoco da tastiera ha un anello di almeno 2 px. */
async function anelli(page: Page, dove: Locator): Promise<string[]> {
  await page.keyboard.press("Shift"); // l'ultima azione è da tastiera: il fuoco dato dopo è «visibile»
  return dove.evaluate((root) => {
    const male: string[] = [];
    const tutti = [...root.querySelectorAll<HTMLElement>("button, select, input, summary, [tabindex]:not([tabindex='-1'])")].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !(e as HTMLButtonElement).disabled;
    });
    for (const e of tutti) {
      e.focus({ focusVisible: true } as FocusOptions);
      if (document.activeElement !== e) continue;
      const cs = getComputedStyle(e);
      const anello = cs.outlineStyle !== "none" ? parseFloat(cs.outlineWidth) : 0;
      const nome = (e.getAttribute("aria-label") || e.textContent || e.tagName).trim().slice(0, 40);
      if (!e.matches(":focus-visible")) male.push(`«${nome}»: fuoco non visibile`);
      else if (anello < 2 && cs.boxShadow === "none") male.push(`«${nome}»: anello di ${anello} px`);
    }
    if (tutti.length === 0) male.push("nessun controllo trovato");
    return male;
  });
}

/** I testi visibili dentro `dove` con contrasto sotto WCAG AA contro lo sfondo su cui stanno davvero. */
const contrasto = (dove: Locator) =>
  dove.evaluate((root) => {
    const rgba = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
    const lumi = (c: number[]) => {
      const f = (x: number) => {
        const s = x / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
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
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent?.trim();
      const e = n.parentElement;
      if (!t || !e || e.closest("option, [hidden]") || e.closest("button:disabled, input:disabled")) continue;
      const r = document.createRange();
      r.selectNodeContents(n);
      const box = r.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      const cs = getComputedStyle(e);
      const [l1, l2] = [lumi(rgba(cs.color)), lumi(sfondo(e))].sort((a, b) => b - a);
      const c = (l1 + 0.05) / (l2 + 0.05);
      if (c < 4.5 - 0.005) male.push(`«${t.slice(0, 30)}» ${c.toFixed(2)}:1`);
    }
    return male;
  });

test.describe("K1: «Ritira» solo per chi può davvero", () => {
  test("due «Maria Rossi»: chi non è l'autrice né amministratrice non vede «Ritira»", async ({ page }) => {
    // Un'altra Maria Rossi (nome utente di Windows «mrossi2») guarda la biblioteca. «La città di Marco» l'ha
    // pubblicata la Maria Rossi vera («mrossi»): il file lo ricorda. Prima di M11-6 l'interfaccia confrontava il nome
    // da mostrare e le mostrava «Ritira» (poi il programma rispondeva con un errore).
    await open(page, "", true, {
      configured: true,
      path: "G:/CAA",
      name: "Maria Rossi",
      user: "mrossi2",
      admins: ["segreteria"],
      entries: [
        { ...LIB_ENTRIES[0], author: "Maria Rossi", author_user: "mrossi" },
        { ...LIB_ENTRIES[1], author: "Luca Bianchi", author_user: "lbianchi" },
      ],
    });
    await page.getByRole("button", { name: "Documenti" }).click();
    await scheda(page, "Biblioteca").click();
    await expect(page.locator(".lib-row")).toHaveCount(2);
    const citta = page.locator(".lib-row", { hasText: "La città di Marco" });
    await expect(citta.getByRole("button", { name: /Ritira|Altre azioni/ })).toHaveCount(0);
    await expect(panel(page).getByRole("button", { name: /Ritira|Altre azioni/ })).toHaveCount(0);
    // «Adatta» resta per tutti.
    await expect(citta.getByRole("button", { name: "Adatta" })).toBeVisible();
  });

  test("la vera autrice (anche con un altro nome da mostrare) e l'amministratore lo vedono; senza Drive nessuno", async ({ page }) => {
    const entries = [
      { ...LIB_ENTRIES[0], author: "Maria Rossi", author_user: "mrossi" },
      { ...LIB_ENTRIES[1], author: "Luca Bianchi", author_user: "lbianchi" },
    ];
    await open(page, "", true, { configured: true, path: "G:/CAA", name: "M. Rossi", user: "MRossi", admins: [], entries, cached: entries });
    await page.getByRole("button", { name: "Documenti" }).click();
    await scheda(page, "Biblioteca").click();
    await expect(page.locator(".lib-row")).toHaveCount(2);
    await expect(panel(page).getByRole("button", { name: /^Altre azioni/ })).toHaveCount(1);
    await expect(await voceRiga(page.locator(".lib-row", { hasText: "La città di Marco" }), "Ritira")).toBeVisible();
    await page.keyboard.press("Escape");
    // Il Drive non risponde: non si può ritirare (si scrive nel Drive), quindi il menu non c'è.
    await page.evaluate(() => {
      (window as any).__mock.lib.reachable = false;
    });
    await panel(page).getByRole("button", { name: "Aggiorna" }).click();
    await expect(panel(page).locator(".lib-state")).toContainText("Drive non raggiungibile");
    await expect(panel(page).getByRole("button", { name: /^Altre azioni/ })).toHaveCount(0);
  });

  test("l'interfaccia segue il permesso del programma, non il nome", async ({ page }) => {
    // Il programma dice «può» su un documento di un altro autore (per esempio è amministratore) e «non può» su uno
    // con il suo stesso nome: l'interfaccia fa quello che dice il programma.
    await open(page, "", true, {
      configured: true,
      path: "G:/CAA",
      name: "Maria Rossi",
      user: "mrossi",
      entries: [
        { ...LIB_ENTRIES[0], author: "Maria Rossi", can_retire: false },
        { ...LIB_ENTRIES[1], author: "Luca Bianchi", can_retire: true },
      ],
    });
    await page.getByRole("button", { name: "Documenti" }).click();
    await scheda(page, "Biblioteca").click();
    await expect(page.locator(".lib-row", { hasText: "La città di Marco" }).getByRole("button", { name: /^Altre azioni/ })).toHaveCount(0);
    await expect(page.locator(".lib-row", { hasText: "Le frazioni" }).getByRole("button", { name: /^Altre azioni/ })).toHaveCount(1);
  });
});

test.describe("righe: azione principale a destra, le altre nel menu «⋯»", () => {
  test("I miei documenti: «Apri» in vista; «Elimina» solo nel menu, rossa, con la conferma rossa vera", async ({ page }) => {
    await apriCompleto(page);
    await documentiSalvati(page);
    await conferme(page);
    await page.getByRole("button", { name: "Documenti" }).click();
    const mensa = riga(page, "In mensa");
    await expect(mensa.getByRole("button", { name: "Apri" })).toBeVisible();
    await expect(mensa.getByRole("button", { name: "Apri" })).toHaveClass(/primary/);
    // Nessun «Elimina» (né «Pubblica») in vista sulla riga: stanno nel menu.
    await expect(mensa.getByRole("button", { name: /Elimina|Pubblica/ })).toHaveCount(0);
    const piu = mensa.getByRole("button", { name: "Altre azioni per «In mensa»" });
    await expect(piu).toHaveAttribute("aria-haspopup", "menu");
    await expect(piu).toHaveAttribute("aria-expanded", "false");
    await piu.click();
    await expect(piu).toHaveAttribute("aria-expanded", "true");
    const menu = mensa.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveText(["Pubblica…", "Elimina"]);
    const elimina = menu.getByRole("menuitem", { name: "Elimina" });
    await expect(elimina).toHaveClass(/danger-text/);
    await elimina.click();
    const c = page.getByRole("alertdialog");
    await expect(c.getByRole("heading")).toHaveText("Eliminare «In mensa»?");
    await expect(c.getByRole("button", { name: "Elimina" })).toHaveClass(/danger/);
    await expect(c.getByRole("button", { name: "Annulla" })).toBeFocused();
    // Annulla: il documento resta e il fuoco torna sul «⋯» della riga.
    await c.getByRole("button", { name: "Annulla" }).click();
    await expect(mensa).toBeVisible();
    await expect(piu).toBeFocused();
    await azioneRiga(mensa, "Elimina");
    await page.getByRole("alertdialog").getByRole("button", { name: "Elimina" }).click();
    await expect(mensa).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__mock.docsStore.has("Mensa.caa"))).toBe(false);
  });

  test("etichette con il testo: copia, in biblioteca (rev. N), aperto adesso; in Biblioteca «copia in conflitto»", async ({ page }) => {
    await apriCompleto(page);
    await documentiSalvati(page);
    await page.getByRole("button", { name: "Documenti" }).click();
    await expect(riga(page, "Le frazioni").locator(".chip")).toHaveText(["copia"]);
    await expect(riga(page, "Regole della classe").locator(".chip")).toHaveText(["in biblioteca (rev. 2)"]);
    // Il documento pubblicato offre «Aggiorna in biblioteca» al posto di «Pubblica…».
    await expect(await voceRiga(riga(page, "Regole della classe"), "Aggiorna in biblioteca")).toBeVisible();
    await page.keyboard.press("Escape");
    await riga(page, "In mensa").getByRole("button", { name: "Apri" }).click();
    await page.getByRole("button", { name: "Documenti" }).click();
    await expect(panel(page).locator(".docs-row.current .chip")).toHaveText(["aperto adesso"]);
    await scheda(page, "Biblioteca").click();
    await expect(panel(page).locator(".lib-row", { hasText: "Regole della classe" }).locator(".chip.conflict")).toHaveText("copia in conflitto");
  });

  test("menu «⋯» da tastiera: Invio o ↓ apre, frecce, Esc chiude e torna al pulsante (la finestra resta)", async ({ page }) => {
    await apriCompleto(page);
    await documentiSalvati(page);
    await page.getByRole("button", { name: "Documenti" }).click();
    const gatto = riga(page, "La storia del gatto Pepe");
    const piu = gatto.getByRole("button", { name: /^Altre azioni/ });
    await piu.focus();
    await page.keyboard.press("Enter");
    await expect(gatto.getByRole("menuitem", { name: "Pubblica…" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(gatto.getByRole("menuitem", { name: "Elimina" })).toBeFocused();
    await page.keyboard.press("ArrowDown"); // gira
    await expect(gatto.getByRole("menuitem", { name: "Pubblica…" })).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(gatto.getByRole("menuitem", { name: "Elimina" })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(gatto.getByRole("menuitem", { name: "Pubblica…" })).toBeFocused();
    // Esc chiude solo il menu: la finestra Documenti resta aperta e il fuoco torna su «⋯».
    await page.keyboard.press("Escape");
    await expect(gatto.getByRole("menu")).toHaveCount(0);
    await expect(piu).toBeFocused();
    await expect(panel(page)).toBeVisible();
    // ↓ sul pulsante apre; Tab chiude e va avanti (dentro la finestra).
    await page.keyboard.press("ArrowDown");
    await expect(gatto.getByRole("menuitem", { name: "Pubblica…" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(gatto.getByRole("menu")).toHaveCount(0);
    expect(await panel(page).evaluate((b) => b.contains(document.activeElement))).toBe(true);
    // Invio su una voce la sceglie: si apre la sotto-pagina Pubblica.
    await piu.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(page.locator(".pub-form")).toBeVisible();
    // Un clic fuori chiude il menu.
    await page.getByRole("button", { name: "Indietro" }).click();
    await gatto.getByRole("button", { name: /^Altre azioni/ }).click();
    await expect(gatto.getByRole("menu")).toBeVisible();
    await panel(page).locator(".docs-folder").click();
    await expect(gatto.getByRole("menu")).toHaveCount(0);
    await expect(panel(page)).toBeVisible();
  });

  test("menu «⋯» e sotto-pagina: anello di fuoco su ogni controllo e testi leggibili", async ({ page }) => {
    await apriCompleto(page);
    await documentiSalvati(page);
    await page.getByRole("button", { name: "Documenti" }).click();
    const gatto = riga(page, "La storia del gatto Pepe");
    await gatto.getByRole("button", { name: /^Altre azioni/ }).click();
    expect(await anelli(page, gatto.getByRole("menu"))).toEqual([]);
    expect(await contrasto(gatto.getByRole("menu"))).toEqual([]);
    await gatto.getByRole("menuitem", { name: "Pubblica…" }).click();
    await expect(page.locator(".pub-form")).toBeVisible();
    expect(await anelli(page, page.locator(".pub-form"))).toEqual([]);
    expect(await contrasto(page.locator(".pub-form"))).toEqual([]);
  });
});

test.describe("K17: Pubblica come sotto-pagina", () => {
  test("«← Indietro» ben visibile, campi con l'etichetta, «Pubblica» principale per ultimo; Indietro torna alla riga", async ({ page }) => {
    await apriCompleto(page);
    await documentiSalvati(page);
    await page.getByRole("button", { name: "Documenti" }).click();
    await azioneRiga(riga(page, "La storia del gatto Pepe"), "Pubblica…");
    const form = page.locator(".pub-form");
    const indietro = form.getByRole("button", { name: "Indietro" });
    await expect(indietro).toBeVisible();
    await expect(indietro.locator("svg.ico")).toHaveCount(1); // la freccia
    // È il primo controllo della sotto-pagina, in alto a sinistra accanto al titolo.
    expect(await form.evaluate((f) => (f.querySelector("button, input") as HTMLElement).textContent?.trim())).toBe("Indietro");
    await expect(form.getByRole("heading")).toHaveText("Pubblica «La storia del gatto Pepe» nella biblioteca");
    await expect(form.getByLabel("Titolo")).toBeFocused();
    for (const nome of ["Titolo", "Materia", "Livello", "Etichette"]) await expect(form.getByLabel(nome)).toBeVisible();
    // I campi sono allineati: iniziano tutti alla stessa distanza da sinistra.
    const sinistre = await form.locator(".pub-input input").evaluateAll((l) => l.map((i) => Math.round(i.getBoundingClientRect().left)));
    expect(new Set(sinistre).size).toBe(1);
    // Azioni: «Annulla» poi «Pubblica» (principale, a destra).
    const azioni = form.locator(".pub-actions button");
    await expect(azioni).toHaveText(["Annulla", "Pubblica"]);
    await expect(azioni.last()).toHaveClass(/primary/);
    // «Indietro»: di nuovo l'elenco, con il fuoco sul «⋯» della riga da cui si era partiti.
    await indietro.click();
    await expect(form).toHaveCount(0);
    await expect(riga(page, "La storia del gatto Pepe").getByRole("button", { name: /^Altre azioni/ })).toBeFocused();
    // «Annulla» fa lo stesso.
    await azioneRiga(riga(page, "La storia del gatto Pepe"), "Pubblica…");
    await page.locator(".pub-form").getByRole("button", { name: "Annulla" }).click();
    await expect(riga(page, "La storia del gatto Pepe")).toBeVisible();
  });

  test("su una finestra stretta i campi vanno uno sotto l'altro e niente esce di lato", async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 700 });
    await apriCompleto(page);
    await documentiSalvati(page);
    await page.getByRole("button", { name: "Documenti" }).click();
    await azioneRiga(riga(page, "La storia del gatto Pepe"), "Pubblica…");
    const form = page.locator(".pub-form");
    await expect(form).toBeVisible();
    const fuori = await panel(page).evaluate((p) => {
      const r = p.getBoundingClientRect();
      return [...p.querySelectorAll<HTMLElement>("button, input, h2")].filter((e) => {
        const b = e.getBoundingClientRect();
        return b.width > 0 && (b.left < r.left - 1 || b.right > r.right + 1);
      }).length;
    });
    expect(fuori).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe("schede e stati vuoti", () => {
  test("le schede si scorrono con ← → (e Inizio / Fine); una sola si raggiunge con Tab", async ({ page }) => {
    await withCorrections(page);
    await open(page, "", true, { configured: true, path: "G:/CAA", entries: LIB_ENTRIES });
    await page.getByRole("button", { name: "Documenti" }).click();
    await expect(panel(page).getByRole("tab")).toHaveText(["I miei documenti", "Biblioteca", "Correzioni"]);
    const mine = scheda(page, "I miei documenti");
    await expect(mine).toHaveAttribute("aria-selected", "true");
    await expect(panel(page).locator("[role=tab][tabindex='0']")).toHaveCount(1);
    await mine.focus();
    await page.keyboard.press("ArrowRight");
    await expect(scheda(page, "Biblioteca")).toBeFocused();
    await expect(scheda(page, "Biblioteca")).toHaveAttribute("aria-selected", "true");
    await expect(panel(page).locator(".lib-row")).toHaveCount(3);
    await page.keyboard.press("ArrowRight");
    await expect(scheda(page, "Correzioni")).toHaveAttribute("aria-selected", "true");
    await expect(panel(page).locator(".lib-corrections")).toBeVisible();
    await page.keyboard.press("ArrowRight"); // gira
    await expect(mine).toBeFocused();
    await expect(mine).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(scheda(page, "Correzioni")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(mine).toBeFocused();
    await page.keyboard.press("End");
    await expect(scheda(page, "Correzioni")).toBeFocused();
    await expect(panel(page).getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "docs-tab-corrections");
  });

  test("Correzioni anonime: scheda propria con la spiegazione sempre visibile; non più in fondo alla Biblioteca", async ({ page }) => {
    await withCorrections(page, { pending: ["pane\t1003"] });
    await open(page, "", true, { configured: true, path: "G:/CAA", entries: LIB_ENTRIES });
    await page.getByRole("button", { name: "Documenti" }).click();
    await scheda(page, "Biblioteca").click();
    await expect(panel(page).locator(".lib-row")).toHaveCount(3);
    await expect(panel(page).locator(".lib-corrections")).toHaveCount(0);
    await scheda(page, "Correzioni").click();
    const sec = panel(page).locator(".lib-corrections");
    await expect(sec.getByRole("heading", { name: "Correzioni anonime" })).toBeVisible();
    await expect(sec.locator(".corr-explain")).toBeVisible();
    await expect(sec).toContainText("Mai il testo e mai il tuo nome dentro il file");
    await expect(sec).toContainText("1 correzione in attesa");
    await expect(sec.getByRole("button", { name: "Invia correzioni" })).toBeEnabled();
    // Inviate: lo stato vuoto, e la spiegazione resta.
    await sec.getByRole("button", { name: "Invia correzioni" }).click();
    await expect(sec.locator(".empty")).toContainText("Nessuna correzione in attesa");
    await expect(sec.locator(".corr-explain")).toBeVisible();
  });

  test("Correzioni: senza la biblioteca collegata si vedono ma non si inviano; senza il client la scheda non c'è", async ({ page }) => {
    await withCorrections(page, { pending: ["pane\t1003"] });
    await open(page, "", true, { configured: false });
    await page.getByRole("button", { name: "Documenti" }).click();
    await scheda(page, "Correzioni").click();
    const sec = panel(page).locator(".lib-corrections");
    await expect(sec).toContainText("1 correzione in attesa");
    await expect(sec.getByRole("button", { name: "Invia correzioni" })).toBeDisabled();
    await expect(sec.getByRole("button", { name: "Vedi cosa parte" })).toBeEnabled();
  });

  test("senza il client delle correzioni ci sono solo due schede", async ({ page }) => {
    await open(page, "", true, { configured: true, path: "G:/CAA", entries: LIB_ENTRIES });
    await page.getByRole("button", { name: "Documenti" }).click();
    await expect(panel(page).getByRole("tab")).toHaveText(["I miei documenti", "Biblioteca"]);
  });

  test("Correzioni vuote: lo stato vuoto con la spiegazione", async ({ page }) => {
    await withCorrections(page);
    await open(page, "", true, { configured: true, path: "G:/CAA", entries: LIB_ENTRIES });
    await page.getByRole("button", { name: "Documenti" }).click();
    await scheda(page, "Correzioni").click();
    const sec = panel(page).locator(".lib-corrections");
    await expect(sec.locator(".empty")).toContainText("Nessuna correzione in attesa");
    await expect(sec.locator(".empty svg.ico")).toHaveCount(1);
    await expect(sec.locator(".corr-explain")).toBeVisible();
    await expect(sec.getByRole("button", { name: "Invia correzioni" })).toBeDisabled();
  });

  test("I miei documenti vuoto: icona, frase e «Nuovo documento» (che porta al testo)", async ({ page }) => {
    await apriCompleto(page, BIBLIOTECA, "");
    await page.getByRole("button", { name: "Documenti" }).click();
    const vuoto = panel(page).locator(".empty");
    await expect(vuoto).toContainText("Nessun documento salvato. Scrivi qualcosa: il documento si salva da solo.");
    await expect(vuoto.locator("svg.ico")).toHaveCount(1);
    await vuoto.getByRole("button", { name: "Nuovo documento" }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator(".ProseMirror")).toBeFocused();
  });

  test("Biblioteca vuota: la frase della 3.6 e «Vai a I miei documenti»", async ({ page }) => {
    await open(page, "", true, { configured: true, path: "G:/CAA", entries: [] });
    await page.getByRole("button", { name: "Documenti" }).click();
    await scheda(page, "Biblioteca").click();
    const vuoto = panel(page).locator(".empty");
    await expect(vuoto).toContainText("Nessun documento in biblioteca. Pubblica un tuo documento da «I miei documenti» perché i colleghi possano adattarlo.");
    await vuoto.getByRole("button", { name: "Vai a I miei documenti" }).click();
    await expect(scheda(page, "I miei documenti")).toHaveAttribute("aria-selected", "true");
    await expect(scheda(page, "I miei documenti")).toBeFocused();
  });

  test("ricerca senza risultati: «Cancella la ricerca» rimette tutto e il fuoco torna nella ricerca", async ({ page }) => {
    await open(page, "", true, { configured: true, path: "G:/CAA", entries: LIB_ENTRIES });
    await page.getByRole("button", { name: "Documenti" }).click();
    await scheda(page, "Biblioteca").click();
    await panel(page).getByLabel("Materia").selectOption("Matematica");
    await panel(page).getByLabel("Cerca nella biblioteca").fill("zzz");
    const vuoto = panel(page).locator(".empty");
    await expect(vuoto).toContainText("Nessun documento corrisponde alla ricerca.");
    await vuoto.getByRole("button", { name: "Cancella la ricerca" }).click();
    await expect(panel(page).locator(".lib-row")).toHaveCount(3);
    await expect(panel(page).getByLabel("Cerca nella biblioteca")).toHaveValue("");
    await expect(panel(page).getByLabel("Materia")).toHaveValue("");
    await expect(panel(page).getByLabel("Cerca nella biblioteca")).toBeFocused();
  });

  test("Biblioteca non collegata: in alto la frase e le cartelle trovate; «Per chi imposta la biblioteca» chiusa sotto", async ({ page }) => {
    await open(page, "", true, { candidates: [{ path: "G:/Drive condivisi/CAA Istituto/CAA", drive: "CAA Istituto" }], entries: LIB_ENTRIES });
    await page.getByRole("button", { name: "Documenti" }).click();
    await scheda(page, "Biblioteca").click();
    const p = panel(page);
    await expect(p.locator(".docs-lead")).toHaveText("La biblioteca della scuola non è ancora collegata. Chiedi al referente o scegli una cartella trovata.");
    const usa = p.getByRole("button", { name: "Usa questa: CAA Istituto" });
    await expect(usa).toBeVisible();
    await expect(usa).toHaveClass(/primary/);
    // La parte tecnica è chiusa: percorso e «Crea la biblioteca qui» non si vedono finché non la si apre.
    const tecnico = p.locator("details.lib-admin");
    await expect(tecnico).not.toHaveAttribute("open", "");
    await expect(p.getByLabel("Percorso della cartella della biblioteca")).toBeHidden();
    await expect(p.getByRole("button", { name: "Crea la biblioteca qui" })).toBeHidden();
    // Sta sotto le cartelle trovate.
    const [yUsa, yTec] = await Promise.all([usa.evaluate((e) => e.getBoundingClientRect().top), tecnico.evaluate((e) => e.getBoundingClientRect().top)]);
    expect(yTec).toBeGreaterThan(yUsa);
    // Si apre anche da tastiera.
    await p.getByText("Per chi imposta la biblioteca").focus();
    await page.keyboard.press("Enter");
    await expect(p.getByLabel("Percorso della cartella della biblioteca")).toBeVisible();
    await expect(p.getByRole("button", { name: "Crea la biblioteca qui" })).toBeVisible();
    expect(await anelli(page, p)).toEqual([]);
    expect(await contrasto(p)).toEqual([]);
  });

  test("la finestra è più larga (fino a circa 55rem) ma mai più larga dello schermo", async ({ page }) => {
    await apriCompleto(page);
    await documentiSalvati(page);
    await page.getByRole("button", { name: "Documenti" }).click();
    const w = await panel(page).evaluate((p) => p.getBoundingClientRect().width / parseFloat(getComputedStyle(document.documentElement).fontSize));
    expect(w).toBeGreaterThan(50);
    expect(w).toBeLessThanOrEqual(55.01);
    await page.setViewportSize({ width: 700, height: 600 });
    const r = await panel(page).evaluate((p) => ({ l: p.getBoundingClientRect().left, r: p.getBoundingClientRect().right, b: p.getBoundingClientRect().bottom }));
    expect(r.l).toBeGreaterThanOrEqual(0);
    expect(r.r).toBeLessThanOrEqual(700);
    expect(r.b).toBeLessThanOrEqual(600);
  });
});
