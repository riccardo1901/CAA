// La finestra «Documenti» (M9a; riordinata in M11-6): tre schede, «I miei documenti» (la cartella `Documenti\CAA`),
// «Biblioteca» (il Drive condiviso dell'istituto) e «Correzioni» (le correzioni anonime, se il programma le ha).
// Ogni riga ha la sua azione principale a destra («Apri», «Adatta») e il menu «⋯» con le altre; il modulo
// Pubblica è una sotto-pagina con «← Indietro» (K17).
import type { CorrectionsClient, DocClient, DocEntry, LibraryClient, LibStatus } from "../engine/client";
import { statoVuoto } from "./empty";
import { distinct, showCorrectionsTab, showLibraryTab } from "./library";
import { formatWhen } from "./panel-format";
import type { Session } from "./session";
import { conIcona } from "../ui/icons";
import { conferma } from "../ui/confirm";
import { finestra } from "../ui/dialog";
import { menuRiga, type VoceMenuRiga } from "../ui/rowmenu";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export type DocsTab = "mine" | "library" | "corrections";

export interface DocsPanel {
  open(tab?: DocsTab): void;
  close(): void;
}

export interface PanelOptions {
  /** La biblioteca nel Drive condiviso (assente: la scheda dice che non c'è). */
  library?: LibraryClient;
  /** Lo stato della biblioteca è cambiato (cartella scelta). */
  libraryChanged?: (status: LibStatus) => void;
  /** Si chiude il pannello (il cursore torna nel testo). */
  onClose?: () => void;
  /** Le correzioni anonime (M9c-3): se ci sono, hanno una scheda propria. */
  corrections?: CorrectionsClient;
}

export function createDocsPanel(docs: DocClient, session: Session, confirmDelete: (title: string) => Promise<boolean>, opts: PanelOptions = {}): DocsPanel {
  const onClose = opts.onClose;
  let overlay: HTMLElement | null = null;
  let chiudiFinestra: (() => void) | null = null;
  /** Il pannello si chiude per aprire un documento: il cursore va nel testo. */
  let versoIlTesto = false;

  // Chiudendo con Esc, «Chiudi» o un clic fuori, il fuoco torna al pulsante che ha aperto il pannello (M11-3);
  // aprendo un documento, invece, il cursore va nel testo.
  const close = (): void => {
    chiudiFinestra?.();
  };
  const closeToText = (): void => {
    versoIlTesto = true;
    close();
  };

  function open(tab: DocsTab = "mine"): void {
    close();
    overlay = el("div", "docs-overlay");
    const box = el("div", "docs-panel");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Documenti");
    const head = el("div", "docs-head");
    const tabs = el("div", "docs-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Documenti");
    const body = el("div", "docs-body");
    body.id = "docs-scheda";
    body.setAttribute("role", "tabpanel");
    const schede: Array<{ id: DocsTab; tab: HTMLButtonElement }> = [];
    const linguetta = (id: DocsTab, nome: string): HTMLButtonElement => {
      const t = el("button", "docs-tab", nome);
      t.type = "button";
      t.id = `docs-tab-${id}`;
      t.setAttribute("role", "tab");
      t.setAttribute("aria-controls", body.id);
      tabs.append(t);
      schede.push({ id, tab: t });
      return t;
    };
    const mine = linguetta("mine", "I miei documenti");
    const library = linguetta("library", "Biblioteca");
    const corrections = opts.corrections ? linguetta("corrections", "Correzioni") : null;
    const closeBtn = conIcona(el("button", "docs-close", "Chiudi"), "chiudi");
    closeBtn.type = "button";
    head.append(tabs, el("span", "grow"), closeBtn);
    box.append(head, body);
    overlay.append(box);
    document.body.append(overlay);

    let attiva: DocsTab = tab;
    /** Accende la linguetta della scheda (una sola si raggiunge con Tab; fra le linguette si va con ← →). */
    const accendi = (id: DocsTab): void => {
      attiva = id;
      for (const s of schede) {
        const qui = s.id === id;
        s.tab.classList.toggle("on", qui);
        s.tab.setAttribute("aria-selected", String(qui));
        s.tab.tabIndex = qui ? 0 : -1;
        if (qui) body.setAttribute("aria-labelledby", s.tab.id);
      }
    };
    accendi(tab);

    // Comportamento unico delle finestre (M11-3): il fuoco entra nel pannello, Tab resta dentro, Esc lo chiude.
    versoIlTesto = false;
    chiudiFinestra = finestra({
      overlay,
      box,
      fuoco: box,
      onChiudi: () => {
        overlay = null;
        chiudiFinestra = null;
        if (versoIlTesto) onClose?.();
      },
    });
    closeBtn.addEventListener("click", close);

    /** La riga di «I miei documenti» il cui menu «⋯» riprende il fuoco quando l'elenco si ridisegna. */
    let fuocoSu: string | null = null;

    const showMine = async (message?: { text: string; ok: boolean }): Promise<void> => {
      accendi("mine");
      body.replaceChildren(el("p", "docs-note", "Carico i documenti…"));
      // Il documento aperto si salva prima: così compare nell'elenco (e si può pubblicare) com'è adesso.
      await session.flush();
      let list;
      try {
        list = await docs.list();
      } catch (e) {
        if (attiva === "mine") body.replaceChildren(el("p", "docs-note warn", `Non riesco a leggere la cartella dei documenti: ${String(e)}`));
        return;
      }
      // Lo stato della biblioteca decide se si può pubblicare o aggiornare.
      let lib: LibStatus | null = null;
      if (opts.library) {
        try {
          lib = await opts.library.status();
        } catch {
          lib = null;
        }
      }
      // Il docente nel frattempo ha cambiato scheda o chiuso la finestra.
      if (!overlay || attiva !== "mine") return;
      const current = session.state().file;
      const parts: HTMLElement[] = [];
      if (message) parts.push(el("p", message.ok ? "docs-note ok" : "docs-note warn", message.text));
      if (list.entries.length === 0) {
        parts.push(
          statoVuoto("documenti", "Nessun documento salvato. Scrivi qualcosa: il documento si salva da solo.", {
            testo: "Nuovo documento",
            fai: () => void session.newDocument().then(closeToText),
          }),
        );
      } else {
        const ul = el("ul", "docs-list");
        for (const entry of list.entries) ul.append(row(entry, entry.file === current, lib));
        parts.push(ul);
      }
      if (list.broken > 0) {
        parts.push(el("p", "docs-note warn", `${list.broken} ${list.broken === 1 ? "file non si legge" : "file non si leggono"} (forse sono ancora in sincronizzazione o rovinati).`));
      }
      parts.push(el("p", "docs-folder", `Cartella: ${list.dir}`));
      body.replaceChildren(...parts);
      if (fuocoSu) {
        const file = fuocoSu;
        fuocoSu = null;
        [...body.querySelectorAll<HTMLElement>(".docs-row")].find((r) => r.dataset.file === file)?.querySelector<HTMLElement>(".row-more-button")?.focus();
      }
    };

    /** Il documento aperto si salva prima di pubblicarlo o aggiornarlo, così il file è quello che si vede. */
    const saveIfCurrent = async (file: string): Promise<boolean> => (file === session.state().file ? session.flush() : true);

    const update = async (entry: DocEntry): Promise<void> => {
      if (!opts.library) return;
      fuocoSu = entry.file;
      if (!(await saveIfCurrent(entry.file))) {
        void showMine({ text: "Il documento aperto non si è salvato: riprova tra poco.", ok: false });
        return;
      }
      try {
        const out = await opts.library.update(entry.file);
        if (entry.file === session.state().file) session.adopt(out.entry);
        void showMine(
          out.kind === "saved_as_new"
            ? { text: "La biblioteca era già andata avanti (qualcun altro, o un tuo altro computer, l'ha aggiornata): ho salvato questo documento come nuovo in biblioteca. Da adesso aggiorni quello. Il precedente non è stato toccato.", ok: true }
            : { text: `Aggiornato in biblioteca: revisione ${out.rev}.`, ok: true },
        );
      } catch (e) {
        void showMine({ text: `Non riesco ad aggiornare «${entry.title}»: ${String(e)}`, ok: false });
      }
    };

    /** Il modulo di pubblicazione, come sotto-pagina con «← Indietro» (K17): titolo, materia, livello, etichette
     *  (con i suggerimenti dei documenti già in biblioteca). */
    const publishForm = async (entry: DocEntry): Promise<void> => {
      if (!opts.library) return;
      let known: { subject: string[]; level: string[] } = { subject: [], level: [] };
      try {
        const scan = await opts.library.scan();
        known = { subject: distinct(scan.entries.map((x) => x.subject)), level: distinct(scan.entries.map((x) => x.level)) };
      } catch {
        /* i suggerimenti sono facoltativi */
      }
      if (!overlay || attiva !== "mine") return;
      const back = (): void => {
        fuocoSu = entry.file;
        void showMine();
      };
      const form = el("form", "pub-form docs-subpage");
      const top = el("div", "subpage-head");
      const indietro = conIcona(el("button", "subpage-back", "Indietro"), "indietro");
      indietro.type = "button";
      indietro.dataset.tip = "Torna all'elenco dei documenti";
      indietro.addEventListener("click", back);
      const titolo = el("h2", "subpage-title", `Pubblica «${entry.title}» nella biblioteca`);
      titolo.id = "pub-titolo";
      form.setAttribute("aria-labelledby", titolo.id);
      top.append(indietro, titolo);
      form.append(top, el("p", "docs-note", "Gli altri docenti potranno farne una copia da adattare; solo tu potrai aggiornarlo."));
      const campi = el("div", "pub-fields");
      let n = 0;
      const field = (label: string, value: string, list?: string[], aiuto?: string): HTMLInputElement => {
        const id = `pub-campo-${++n}`;
        const l = el("label", "pub-label", label);
        l.htmlFor = id;
        const i = el("input");
        i.type = "text";
        i.id = id;
        i.value = value;
        const cella = el("div", "pub-input");
        cella.append(i);
        if (list) {
          const dl = el("datalist");
          dl.id = `${id}-elenco`;
          for (const v of list) dl.append(Object.assign(document.createElement("option"), { value: v }));
          i.setAttribute("list", dl.id);
          cella.append(dl);
        }
        if (aiuto) {
          const h = el("span", "pub-help", aiuto);
          h.id = `${id}-aiuto`;
          i.setAttribute("aria-describedby", h.id);
          cella.append(h);
        }
        campi.append(l, cella);
        return i;
      };
      const title = field("Titolo", entry.title);
      const subject = field("Materia", "", known.subject);
      const level = field("Livello", "", known.level);
      const tags = field("Etichette", "", undefined, "Separate da virgole, per esempio: storia sociale, mensa");
      form.append(campi);
      const err = el("p", "docs-note warn");
      err.setAttribute("role", "alert");
      const actions = el("div", "lib-actions pub-actions");
      const cancel = el("button", "", "Annulla");
      cancel.type = "button";
      cancel.addEventListener("click", back);
      const go = conIcona(el("button", "primary", "Pubblica"), "pubblica");
      go.type = "submit";
      // La principale per ultima, a destra.
      actions.append(cancel, go);
      form.append(err, actions);
      form.addEventListener("submit", (ev) => {
        ev.preventDefault();
        go.disabled = true;
        err.textContent = "";
        void (async () => {
          if (!(await saveIfCurrent(entry.file))) {
            go.disabled = false;
            err.textContent = "Il documento aperto non si è salvato: riprova tra poco.";
            return;
          }
          try {
            const out = await opts.library!.publish(entry.file, {
              title: title.value,
              subject: subject.value,
              level: level.value,
              tags: tags.value.split(",").map((t) => t.trim()).filter(Boolean),
            });
            // Il titolo scelto nel modulo vale anche per il documento aperto (altrimenti il prossimo salvataggio
            // automatico rimette il vecchio).
            if (entry.file === session.state().file) session.adopt(out.entry);
            fuocoSu = entry.file;
            void showMine({ text: `Pubblicato in biblioteca (revisione ${out.rev}). Quando lo modifichi, scegli «Aggiorna in biblioteca» dal menu «⋯» del documento.`, ok: true });
          } catch (e) {
            go.disabled = false;
            err.textContent = String(e);
          }
        })();
      });
      body.replaceChildren(form);
      body.scrollTop = 0;
      title.focus();
    };

    const row = (entry: DocEntry, isCurrent: boolean, lib: LibStatus | null): HTMLElement => {
      const li = el("li", isCurrent ? "docs-row row current" : "docs-row row");
      li.dataset.file = entry.file;
      const name = entry.title || entry.file;
      const info = el("div", "docs-info");
      const meta = el("div", "docs-meta");
      meta.append(el("span", "docs-when", formatWhen(entry.modified)));
      // Etichette con il testo, mai solo colore: anche la riga del documento aperto lo dice a parole.
      if (isCurrent) meta.append(el("span", "docs-tag chip open", "aperto adesso"));
      if (entry.origin) meta.append(el("span", "docs-tag chip", "copia"));
      if (entry.published_rev != null) meta.append(el("span", "docs-tag chip pub", `in biblioteca (rev. ${entry.published_rev})`));
      info.append(el("strong", "docs-title", name), meta);
      const actions = el("div", "row-actions");
      const openBtn = conIcona(el("button", "primary", "Apri"), "apri");
      openBtn.type = "button";
      openBtn.addEventListener("click", () => {
        openBtn.disabled = true;
        session.openFile(entry.file).then(
          () => closeToText(),
          (e: unknown) => {
            openBtn.disabled = false;
            body.prepend(el("p", "docs-note warn", `Non riesco ad aprire «${entry.title}»: ${String(e)}`));
          },
        );
      });
      const voci: VoceMenuRiga[] = [];
      // Pubblica o aggiorna in biblioteca: solo con la biblioteca collegata (e raggiungibile per scrivere).
      if (lib?.configured) {
        const pubblicato = entry.published_rev != null;
        voci.push({
          testo: pubblicato ? "Aggiorna in biblioteca" : "Pubblica…",
          icona: pubblicato ? "aggiorna" : "pubblica",
          fai: () => void (pubblicato ? update(entry) : publishForm(entry)),
          spenta: lib.reachable ? undefined : "Il Drive non risponde: riprova quando è raggiungibile",
        });
      }
      voci.push({
        testo: "Elimina",
        icona: "elimina",
        pericolo: true,
        fai: () =>
          void (async () => {
            if (!(await confirmDelete(name))) return;
            docs.remove(entry.file).then(
              () => {
                if (entry.file === session.state().file) session.forget();
                void showMine();
              },
              (e: unknown) => body.prepend(el("p", "docs-note warn", `Non riesco a eliminare: ${String(e)}`)),
            );
          })(),
      });
      actions.append(openBtn, menuRiga(`Altre azioni per «${name}»`, voci));
      li.append(info, actions);
      return li;
    };

    const showLibrary = (): void => {
      accendi("library");
      if (!opts.library) {
        body.replaceChildren(el("p", "docs-note", "La biblioteca dell'istituto non è disponibile in questa versione."));
        return;
      }
      showLibraryTab(body, {
        library: opts.library,
        changed: (s) => opts.libraryChanged?.(s),
        confirm: conferma,
        attiva: () => !!overlay && attiva === "library",
        toMine: () => {
          void showMine();
          mine.focus();
        },
        openCopy: async (file) => {
          await session.openFile(file);
          closeToText();
        },
      });
    };

    const showCorrections = (): void => {
      if (!opts.corrections) return;
      accendi("corrections");
      showCorrectionsTab(body, {
        corrections: opts.corrections,
        library: opts.library,
        confirm: conferma,
        attiva: () => !!overlay && attiva === "corrections",
      });
    };

    const mostra = (id: DocsTab): void => {
      if (id === "library") showLibrary();
      else if (id === "corrections" && opts.corrections) showCorrections();
      else void showMine();
    };
    mine.addEventListener("click", () => void showMine());
    library.addEventListener("click", showLibrary);
    corrections?.addEventListener("click", showCorrections);
    // Frecce fra le linguette (come vuole il ruolo «tablist»): la scheda si apre subito.
    tabs.addEventListener("keydown", (e) => {
      const i = schede.findIndex((s) => s.id === attiva);
      let j = -1;
      if (e.key === "ArrowRight") j = (i + 1) % schede.length;
      else if (e.key === "ArrowLeft") j = (i - 1 + schede.length) % schede.length;
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = schede.length - 1;
      if (j < 0) return;
      e.preventDefault();
      mostra(schede[j].id);
      schede[j].tab.focus();
    });
    mostra(tab);
  }

  return { open, close };
}
