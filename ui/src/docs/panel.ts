// Il pannello «Documenti» (M9a): due schede, «I miei documenti» (la cartella `Documenti\CAA`) e
// «Biblioteca» (il Drive condiviso dell'istituto, in arrivo con M9b).
import type { DocClient, DocEntry, LibraryClient, LibStatus } from "../engine/client";
import { showLibraryTab } from "./library";
import { formatWhen } from "./panel-format";
import type { Session } from "./session";

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
    const closeBtn = el("button", "docs-close", "Chiudi");
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

    const showMine = async (): Promise<void> => {
      mine.classList.add("on");
      library.classList.remove("on");
      body.replaceChildren(el("p", "docs-note", "Carico i documenti…"));
      let list;
      try {
        list = await docs.list();
      } catch (e) {
        body.replaceChildren(el("p", "docs-note warn", `Non riesco a leggere la cartella dei documenti: ${String(e)}`));
        return;
      }
      if (!overlay) return;
      const current = session.state().file;
      const rows: HTMLElement[] = [];
      for (const entry of list.entries) rows.push(row(entry, entry.file === current));
      const parts: HTMLElement[] = [];
      if (rows.length === 0) parts.push(el("p", "docs-note", "Nessun documento salvato. Scrivi qualcosa: il documento si salva da solo."));
      else parts.push(el("ul", "docs-list"));
      const ul = parts[0].tagName === "UL" ? parts[0] : null;
      rows.forEach((r) => ul?.append(r));
      if (list.broken > 0) {
        parts.push(el("p", "docs-note warn", `${list.broken} ${list.broken === 1 ? "file non si legge" : "file non si leggono"} (forse sono ancora in sincronizzazione o rovinati).`));
      }
      parts.push(el("p", "docs-folder", `Cartella: ${list.dir}`));
      body.replaceChildren(...parts);
    };

    const row = (entry: DocEntry, isCurrent: boolean): HTMLElement => {
      const li = el("li", isCurrent ? "docs-row current" : "docs-row");
      const info = el("div", "docs-info");
      info.append(el("strong", "", entry.title || entry.file), el("span", "docs-when", formatWhen(entry.modified)));
      if (entry.origin) info.append(el("span", "docs-tag", "copia"));
      const openBtn = el("button", "", "Apri");
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
      const delBtn = el("button", "", "Elimina");
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
      li.append(info, openBtn, delBtn);
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
