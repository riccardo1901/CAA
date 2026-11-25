// Il pannello «Documenti» (M9a): due schede, «I miei documenti» (la cartella `Documenti\CAA`) e
// «Biblioteca» (il Drive condiviso dell'istituto, in arrivo con M9b).
import type { CorrectionsClient, DocClient, DocEntry, LibraryClient, LibStatus } from "../engine/client";
import { distinct } from "./library";
import { showLibraryTab } from "./library";
import { formatWhen } from "./panel-format";
import type { Session } from "./session";
import { conIcona } from "../ui/icons";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface DocsPanel {
  open(tab?: "mine" | "library"): void;
  close(): void;
}

export interface PanelOptions {
  /** La biblioteca nel Drive condiviso (assente: la scheda dice che non c'è). */
  library?: LibraryClient;
  /** Lo stato della biblioteca è cambiato (cartella scelta). */
  libraryChanged?: (status: LibStatus) => void;
  /** Si chiude il pannello (il cursore torna nel testo). */
  onClose?: () => void;
  /** Le correzioni anonime (M9c-3). */
  corrections?: CorrectionsClient;
}

export function createDocsPanel(docs: DocClient, session: Session, confirmDelete: (title: string) => boolean, opts: PanelOptions = {}): DocsPanel {
  const onClose = opts.onClose;
  let overlay: HTMLElement | null = null;

  const close = (): void => {
    document.removeEventListener("keydown", onKey, true);
    const was = overlay;
    overlay?.remove();
    overlay = null;
    // Chiudendo il pannello il cursore torna nel testo.
    if (was) onClose?.();
  };
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  function open(tab: "mine" | "library" = "mine"): void {
    close();
    overlay = el("div", "docs-overlay");
    const box = el("div", "docs-panel");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Documenti");
    const tabs = el("div", "docs-tabs");
    const mine = el("button", "docs-tab on", "I miei documenti");
    mine.type = "button";
    const library = el("button", "docs-tab", "Biblioteca");
    library.type = "button";
    const closeBtn = conIcona(el("button", "docs-close", "Chiudi"), "chiudi");
    closeBtn.type = "button";
    tabs.append(mine, library, el("span", "grow"), closeBtn);
    const body = el("div", "docs-body");
    box.append(tabs, body);
    overlay.append(box);
    document.body.append(overlay);
    // Il fuoco entra nel pannello (la tastiera funziona lì e Esc lo chiude).
    box.tabIndex = -1;
    box.focus();
    document.addEventListener("keydown", onKey, true);
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close();
    });

    const showMine = async (message?: { text: string; ok: boolean }): Promise<void> => {
      mine.classList.add("on");
      library.classList.remove("on");
      body.replaceChildren(el("p", "docs-note", "Carico i documenti…"));
      // Il documento aperto si salva prima: così compare nell'elenco (e si può pubblicare) com'è adesso.
      await session.flush();
      let list;
      try {
        list = await docs.list();
      } catch (e) {
        body.replaceChildren(el("p", "docs-note warn", `Non riesco a leggere la cartella dei documenti: ${String(e)}`));
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
      if (!overlay) return;
      const current = session.state().file;
      const parts: HTMLElement[] = [];
      if (message) parts.push(el("p", message.ok ? "docs-note ok" : "docs-note warn", message.text));
      if (list.entries.length === 0) {
        parts.push(el("p", "docs-note", "Nessun documento salvato. Scrivi qualcosa: il documento si salva da solo."));
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
    };

    /** Il documento aperto si salva prima di pubblicarlo o aggiornarlo, così il file è quello che si vede. */
    const saveIfCurrent = async (file: string): Promise<boolean> => (file === session.state().file ? session.flush() : true);

    const update = async (entry: DocEntry): Promise<void> => {
      if (!opts.library) return;
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

    /** Il modulo di pubblicazione: titolo, materia, livello, etichette (con i suggerimenti dei documenti già in biblioteca). */
    const publishForm = async (entry: DocEntry): Promise<void> => {
      if (!opts.library) return;
      let known: { subject: string[]; level: string[] } = { subject: [], level: [] };
      try {
        const scan = await opts.library.scan();
        known = { subject: distinct(scan.entries.map((x) => x.subject)), level: distinct(scan.entries.map((x) => x.level)) };
      } catch {
        /* i suggerimenti sono facoltativi */
      }
      if (!overlay) return;
      const form = el("form", "pub-form");
      const field = (label: string, value: string, list?: string[], aria?: string): HTMLInputElement => {
        const l = el("label", "", label);
        const i = el("input");
        i.type = "text";
        i.value = value;
        i.setAttribute("aria-label", aria ?? label);
        if (list) {
          const id = `dl-${label}`;
          const dl = el("datalist");
          dl.id = id;
          for (const v of list) dl.append(Object.assign(document.createElement("option"), { value: v }));
          i.setAttribute("list", id);
          l.append(dl);
        }
        l.append(i);
        form.append(l);
        return i;
      };
      form.append(el("h2", "", `Pubblica «${entry.title}» nella biblioteca`));
      form.append(el("p", "docs-note", "Gli altri docenti potranno farne una copia da adattare; solo tu potrai aggiornarlo."));
      const title = field("Titolo", entry.title);
      const subject = field("Materia", "", known.subject);
      const level = field("Livello", "", known.level);
      const tags = field("Etichette (separate da virgole)", "", undefined, "Etichette");
      const err = el("p", "docs-note warn");
      const actions = el("div", "lib-actions");
      const go = conIcona(el("button", "primary", "Pubblica"), "pubblica");
      go.type = "submit";
      const cancel = el("button", "", "Annulla");
      cancel.type = "button";
      cancel.addEventListener("click", () => void showMine());
      actions.append(go, cancel);
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
            void showMine({ text: `Pubblicato in biblioteca (revisione ${out.rev}). Quando lo modifichi, premi «Aggiorna in biblioteca».`, ok: true });
          } catch (e) {
            go.disabled = false;
            err.textContent = String(e);
          }
        })();
      });
      body.replaceChildren(form);
      title.focus();
    };

    const row = (entry: DocEntry, isCurrent: boolean, lib: LibStatus | null): HTMLElement => {
      const li = el("li", isCurrent ? "docs-row current" : "docs-row");
      const info = el("div", "docs-info");
      info.append(el("strong", "", entry.title || entry.file), el("span", "docs-when", formatWhen(entry.modified)));
      if (entry.origin) info.append(el("span", "docs-tag", "copia"));
      if (entry.published_rev != null) info.append(el("span", "docs-tag pub", `in biblioteca (rev. ${entry.published_rev})`));
      const openBtn = conIcona(el("button", "", "Apri"), "apri");
      openBtn.type = "button";
      openBtn.addEventListener("click", () => {
        openBtn.disabled = true;
        session.openFile(entry.file).then(
          () => close(),
          (e: unknown) => {
            openBtn.disabled = false;
            body.prepend(el("p", "docs-note warn", `Non riesco ad aprire «${entry.title}»: ${String(e)}`));
          },
        );
      });
      const delBtn = conIcona(el("button", "", "Elimina"), "elimina");
      delBtn.type = "button";
      delBtn.addEventListener("click", () => {
        if (!confirmDelete(entry.title || entry.file)) return;
        docs.remove(entry.file).then(
          () => {
            if (entry.file === session.state().file) session.forget();
            void showMine();
          },
          (e: unknown) => body.prepend(el("p", "docs-note warn", `Non riesco a eliminare: ${String(e)}`)),
        );
      });
      li.append(info, openBtn);
      // Pubblica o aggiorna in biblioteca: solo con la biblioteca collegata (e raggiungibile per scrivere).
      if (lib?.configured) {
        const pub = conIcona(el("button", "", entry.published_rev != null ? "Aggiorna in biblioteca" : "Pubblica"), entry.published_rev != null ? "aggiorna" : "pubblica");
        pub.type = "button";
        pub.disabled = !lib.reachable;
        pub.title = lib.reachable ? "" : "Il Drive non risponde: riprova quando è raggiungibile";
        pub.addEventListener("click", () => void (entry.published_rev != null ? update(entry) : publishForm(entry)));
        li.append(pub);
      }
      li.append(delBtn);
      return li;
    };

    const showLibrary = (): void => {
      library.classList.add("on");
      mine.classList.remove("on");
      if (!opts.library) {
        body.replaceChildren(el("p", "docs-note", "La biblioteca dell'istituto non è disponibile in questa versione."));
        return;
      }
      showLibraryTab(body, {
        library: opts.library,
        changed: (s) => opts.libraryChanged?.(s),
        confirm: (m) => window.confirm(m),
        corrections: opts.corrections,
        openCopy: async (file) => {
          await session.openFile(file);
          close();
        },
      });
    };
    mine.addEventListener("click", () => void showMine());
    library.addEventListener("click", showLibrary);
    if (tab === "library") showLibrary();
    else void showMine();
  }

  return { open, close };
}
