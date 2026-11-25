// La scheda «Biblioteca» (M9b-1): trovare la cartella del Drive condiviso, elencare i documenti di
// riferimento, cercarli e farne una copia da adattare.
import type { CorrectionsClient, LibEntry, LibraryClient, LibScan, LibStatus } from "../engine/client";
import { formatWhen } from "./panel-format";
import { conIcona } from "../ui/icons";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Minuscolo e senza accenti: «città» si trova scrivendo «citta». */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** I documenti che corrispondono alla ricerca (titolo, autore, materia, livello, etichette) e ai filtri. */
export function filterLibrary(entries: LibEntry[], query: string, subject: string, level: string): LibEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    if (subject && fold(e.subject) !== fold(subject)) return false;
    if (level && fold(e.level) !== fold(level)) return false;
    const hay = fold([e.title, e.author, e.subject, e.level, ...e.tags].join(" "));
    return words.every((w) => hay.includes(w));
  });
}

/** I valori distinti di un campo, per i filtri (senza duplicati per accenti e maiuscole). */
export function distinct(values: string[]): string[] {
  const seen = new Map<string, string>();
  for (const v of values) {
    const t = v.trim();
    if (t && !seen.has(fold(t))) seen.set(fold(t), t);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "it"));
}

export interface LibraryTabDeps {
  library: LibraryClient;
  /** Una copia è stata creata: la apre e chiude il pannello. */
  openCopy(file: string): Promise<void>;
  /** Lo stato della biblioteca è cambiato (cartella scelta): aggiorna l'indicatore in alto. */
  changed(status: LibStatus): void;
  confirm(message: string): boolean;
  /** Le correzioni anonime (M9c-3): se c'è, in fondo alla scheda c'è la sezione per vederle e inviarle. */
  corrections?: CorrectionsClient;
}

/** Due nomi sono lo stesso (senza badare a maiuscole e spazi ai lati). */
function sameName(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  return x !== "" && x === b.trim().toLowerCase();
}

/** Disegna la scheda dentro `body`. */
export function showLibraryTab(body: HTMLElement, deps: LibraryTabDeps): void {
  const { library } = deps;

  const setup = async (status: LibStatus | null): Promise<void> => {
    body.replaceChildren(el("p", "docs-note", "Cerco la biblioteca nel Drive condiviso…"));
    let found: Array<{ path: string; drive: string }> = [];
    try {
      found = await library.find();
    } catch {
      /* si può sempre scrivere il percorso a mano */
    }
    const box = el("div", "lib-setup");
    box.append(
      el("p", "docs-note", status?.configured ? `La cartella scelta (${status.path ?? ""}) non risponde. Puoi sceglierne un'altra.` : "La biblioteca dell'istituto non è ancora collegata."),
      el("p", "docs-note", "Serve Google Drive per computer, con il Drive condiviso dell'istituto: il programma legge la cartella che Drive mostra sul computer."),
    );
    const err = el("p", "docs-note warn");
    const choose = async (path: string, create: boolean): Promise<void> => {
      err.textContent = "";
      try {
        const s = await library.setFolder(path, create);
        deps.changed(s);
        await list();
      } catch (e) {
        err.textContent = String(e);
      }
    };
    if (found.length > 0) {
      box.append(el("p", "docs-note", "Ho trovato queste cartelle:"));
      const ul = el("ul", "docs-list");
      for (const c of found) {
        const li = el("li", "docs-row");
        const info = el("div", "docs-info");
        info.append(el("strong", "", c.drive), el("span", "docs-when", c.path));
        const use = el("button", "", "Usa questa");
        use.type = "button";
        use.addEventListener("click", () => void choose(c.path, false));
        li.append(info, use);
        ul.append(li);
      }
      box.append(ul);
    } else {
      box.append(el("p", "docs-note", "Non ho trovato nessun Drive condiviso con una cartella «CAA» e dentro «biblioteca». Scrivi il percorso della cartella."));
    }
    const path = el("input", "lib-path");
    path.type = "text";
    path.placeholder = "Percorso della cartella, per esempio G:\\Drive condivisi\\CAA Istituto\\CAA";
    path.setAttribute("aria-label", "Percorso della cartella della biblioteca");
    const row = el("div", "lib-actions");
    const use = el("button", "", "Usa questo percorso");
    use.type = "button";
    use.addEventListener("click", () => void choose(path.value, false));
    const create = el("button", "", "Crea la biblioteca qui");
    create.type = "button";
    create.title = "Solo la prima volta, per chi imposta la biblioteca: crea le cartelle biblioteca, archivio, simboli…";
    create.addEventListener("click", () => void choose(path.value, true));
    row.append(use, create);
    box.append(path, row, err);
    body.replaceChildren(box);
  };

  async function list(): Promise<void> {
    body.replaceChildren(el("p", "docs-note", "Carico la biblioteca…"));
    let status: LibStatus;
    let scan: LibScan;
    try {
      status = await library.status();
      if (!status.configured) return void (await setup(null));
      scan = await library.scan();
    } catch (e) {
      body.replaceChildren(el("p", "docs-note warn", `Non riesco a leggere la biblioteca: ${String(e)}`));
      return;
    }
    if (!scan.configured) return void (await setup(status));
    deps.changed(status);

    const top = el("div", "lib-top");
    const state = el("span", scan.offline ? "lib-state off" : "lib-state on", scan.offline ? "Drive non raggiungibile: vedi l'ultima copia" : "Collegata al Drive");
    state.title = status.path ?? "";
    const refresh = conIcona(el("button", "", "Aggiorna"), "aggiorna");
    refresh.type = "button";
    refresh.addEventListener("click", () => void list());
    const change = conIcona(el("button", "", "Cambia cartella"), "cartella");
    change.type = "button";
    change.addEventListener("click", () => void setup(status));
    top.append(state, el("span", "grow"), refresh, change);

    const q = el("input", "lib-search");
    q.type = "search";
    q.placeholder = "Cerca per titolo, autore, materia, etichetta…";
    q.setAttribute("aria-label", "Cerca nella biblioteca");
    const subject = el("select");
    subject.setAttribute("aria-label", "Materia");
    const level = el("select");
    level.setAttribute("aria-label", "Livello");
    const fill = (sel: HTMLSelectElement, all: string, values: string[]): void => {
      const o = el("option", "", all);
      o.value = "";
      sel.append(o);
      for (const v of values) {
        const x = el("option", "", v);
        x.value = v;
        sel.append(x);
      }
    };
    fill(subject, "Tutte le materie", distinct(scan.entries.map((e) => e.subject)));
    fill(level, "Tutti i livelli", distinct(scan.entries.map((e) => e.level)));
    const filters = el("div", "lib-filters");
    filters.append(q, subject, level);

    const notes = el("div", "lib-notes");
    if (scan.incomplete > 0) {
      notes.append(el("p", "docs-note warn", `${scan.incomplete} ${scan.incomplete === 1 ? "documento è ancora in sincronizzazione" : "documenti sono ancora in sincronizzazione"}: compariranno tra poco. Premi «Aggiorna».`));
    }
    const msg = el("p", "docs-note warn");
    const ul = el("ul", "docs-list");
    const draw = (): void => {
      const shown = filterLibrary(scan.entries, q.value, subject.value, level.value);
      ul.replaceChildren();
      if (scan.entries.length === 0) {
        ul.append(el("li", "docs-note", "La biblioteca è vuota."));
        return;
      }
      if (shown.length === 0) {
        ul.append(el("li", "docs-note", "Nessun documento corrisponde alla ricerca."));
        return;
      }
      for (const e of shown) ul.append(row(e));
    };
    const row = (e: LibEntry): HTMLElement => {
      const li = el("li", "docs-row lib-row");
      const info = el("div", "docs-info");
      info.append(el("strong", "", e.title || e.file));
      const meta = [e.author, e.subject, e.level].filter(Boolean).join(" · ");
      if (meta) info.append(el("span", "docs-when", meta));
      info.append(el("span", "docs-when", formatWhen(e.modified)));
      for (const t of e.tags) info.append(el("span", "docs-tag", t));
      if (e.conflict) {
        const c = el("span", "docs-tag conflict", "copia in conflitto");
        c.title = "Un altro file ha lo stesso documento: chiedi all'autore quale tenere";
        info.append(c);
      }
      const adapt = conIcona(el("button", "primary", "Adatta"), "adatta");
      adapt.type = "button";
      adapt.title = "Fai una tua copia da modificare";
      adapt.addEventListener("click", () => {
        adapt.disabled = true;
        msg.textContent = "";
        library.adapt(e.file).then(
          (entry) => deps.openCopy(entry.file),
          (err: unknown) => {
            adapt.disabled = false;
            msg.textContent = `Non riesco a fare la copia di «${e.title}»: ${String(err)}`;
          },
        );
      });
      li.append(info, adapt);
      // Ritira: l'autore, o un amministratore (nomi utente di Windows nel config.json del tecnico).
      const canRetire = sameName(e.author, status.display_name) || status.admins.some((a) => sameName(a, status.user));
      if (canRetire) {
        const retire = conIcona(el("button", "", "Ritira"), "ritira");
        retire.type = "button";
        retire.title = "Il documento esce dalla biblioteca (resta nella cartella «archivio»)";
        retire.addEventListener("click", () => {
          if (!deps.confirm(`Ritirare «${e.title}» dalla biblioteca? Esce dall'elenco ma resta nella cartella «archivio» del Drive.`)) return;
          retire.disabled = true;
          library.retire(e.file).then(
            () => void list(),
            (err: unknown) => {
              retire.disabled = false;
              msg.textContent = `Non riesco a ritirare «${e.title}»: ${String(err)}`;
            },
          );
        });
        li.append(retire);
      }
      return li;
    };
    for (const input of [q, subject, level]) input.addEventListener("input", draw);
    draw();
    body.replaceChildren(top, filters, notes, msg, ul);
    if (deps.corrections) void correctionsSection(deps.corrections, scan.offline);
  }

  /** «Correzioni anonime»: si vede cosa partirebbe, si può spegnere la raccolta e inviare a mano. */
  async function correctionsSection(c: CorrectionsClient, offline: boolean): Promise<void> {
    let info;
    try {
      info = await c.info();
    } catch {
      return;
    }
    const box = el("section", "lib-corrections");
    box.append(el("h3", "", "Correzioni anonime"));
    box.append(
      el(
        "p",
        "docs-note",
        "Quando scegli un simbolo diverso da quello proposto, il programma ricorda solo la parola, una parola prima e una dopo (senza nomi propri né numeri) e il simbolo scelto. Mai il testo e mai il tuo nome dentro il file. Attenzione: il file lo crea il tuo account Google, quindi chi ha accesso alla cartella del Drive può vedere da quale account arriva. Parte solo se premi «Invia»: servono a migliorare i simboli per tutti.",
      ),
    );
    const on = el("input");
    on.type = "checkbox";
    on.checked = info.enabled;
    const label = el("label", "pm-all");
    label.append(on, " Raccogli le correzioni");
    on.addEventListener("change", () => {
      c.setEnabled(on.checked).catch(() => (on.checked = !on.checked));
    });
    const count = el("p", "docs-note", info.pending === 0 ? "Nessuna correzione in attesa." : `${info.pending} ${info.pending === 1 ? "correzione in attesa" : "correzioni in attesa"}.`);
    const msg = el("p", "docs-note");
    const preview = el("pre", "lib-corr-preview");
    preview.hidden = true;
    const actions = el("div", "lib-actions");
    const show = el("button", "", "Vedi cosa parte");
    show.type = "button";
    show.disabled = info.pending === 0;
    show.addEventListener("click", () => {
      c.preview().then((lines) => {
        preview.hidden = false;
        const more = info.pending > lines.length ? [`… e altre ${info.pending - lines.length}: partono tutte quando premi «Invia»`] : [];
        preview.textContent = ["forma · prima · dopo · lemma · categoria · simbolo scelto · proposto", ...lines.map((l) => l.split("\t").join(" · ")), ...more].join("\n");
      }, () => undefined);
    });
    const send = conIcona(el("button", "", "Invia correzioni"), "invia");
    send.type = "button";
    send.disabled = info.pending === 0 || offline;
    send.title = offline ? "Serve il Drive" : "Le copia nella cartella «correzioni» del Drive";
    send.addEventListener("click", () => {
      send.disabled = true;
      msg.textContent = "";
      c.send().then(
        (n) => {
          msg.textContent = `Inviate ${n} ${n === 1 ? "correzione" : "correzioni"}. Grazie!`;
          count.textContent = "Nessuna correzione in attesa.";
          show.disabled = true;
          preview.hidden = true;
        },
        (e: unknown) => {
          send.disabled = false;
          msg.textContent = `Non sono riuscito a inviarle: ${String(e)}`;
          msg.classList.add("warn");
        },
      );
    });
    const discard = conIcona(el("button", "", "Butta via"), "elimina");
    discard.type = "button";
    discard.disabled = info.pending === 0;
    discard.addEventListener("click", () => {
      if (!deps.confirm("Buttare via le correzioni raccolte senza inviarle?")) return;
      c.discard().then(() => {
        count.textContent = "Nessuna correzione in attesa.";
        show.disabled = send.disabled = discard.disabled = true;
        preview.hidden = true;
      }, () => undefined);
    });
    actions.append(show, send, discard);
    box.append(label, count, actions, msg, preview);
    body.append(box);
  }

  void list();
}
