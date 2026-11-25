// Il pannello «Documenti» (M9a): due schede, «I miei documenti» (la cartella `Documenti\CAA`) e
// «Biblioteca» (il Drive condiviso dell'istituto, in arrivo con M9b).
import type { DocClient, DocEntry } from "../engine/client";
import type { Session } from "./session";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Data e ora di un documento come le scrive il docente (il manifest ha la data in UTC). */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export interface DocsPanel {
  open(): void;
  close(): void;
}

export function createDocsPanel(docs: DocClient, session: Session, confirmDelete: (title: string) => boolean): DocsPanel {
  let overlay: HTMLElement | null = null;

  const close = (): void => {
    document.removeEventListener("keydown", onKey, true);
    overlay?.remove();
    overlay = null;
  };
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  function open(): void {
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
      body.replaceChildren(
        el("p", "docs-note", "La biblioteca dell'istituto (il Drive condiviso) arriva con la prossima versione del programma: qui compariranno i documenti di riferimento da adattare e quelli che pubblichi tu."),
      );
    };
    mine.addEventListener("click", () => void showMine());
    library.addEventListener("click", showLibrary);
    void showMine();
  }

  return { open, close };
}
