// La scheda «Biblioteca» (M9b-1; riordinata in M11-6): trovare la cartella del Drive condiviso, elencare i documenti
// di riferimento, cercarli e farne una copia da adattare. E la scheda «Correzioni» (M9c-3, scheda propria da M11-6).
import type { CorrectionsClient, LibEntry, LibraryClient, LibScan, LibStatus } from "../engine/client";
import { statoVuoto } from "./empty";
import { formatWhen } from "./panel-format";
import { conIcona, icona } from "../ui/icons";
import type { Conferma } from "../ui/confirm";
import { menuRiga } from "../ui/rowmenu";

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
  /** Chiede conferma al docente (finestra del programma). */
  confirm(c: Conferma): Promise<boolean>;
  /** La scheda è ancora quella in vista (le risposte lente del Drive non disegnano sopra un'altra scheda). */
  attiva?: () => boolean;
  /** Passa a «I miei documenti» (dallo stato vuoto: «pubblica un tuo documento»). */
  toMine?: () => void;
}

/** Disegna la scheda dentro `body`. */
export function showLibraryTab(body: HTMLElement, deps: LibraryTabDeps): void {
  const { library } = deps;
  const inVista = (): boolean => deps.attiva?.() ?? true;

  /** La biblioteca non è collegata (o la cartella scelta non risponde): prima la frase per il docente e le cartelle
   *  trovate; sotto, chiusa, la parte per chi imposta la biblioteca (così nessuno ne crea una vuota per sbaglio). */
  const setup = async (status: LibStatus | null): Promise<void> => {
    body.replaceChildren(el("p", "docs-note", "Cerco la biblioteca nel Drive condiviso…"));
    let found: Array<{ path: string; drive: string }> = [];
    try {
      found = await library.find();
    } catch {
      /* si può sempre scrivere il percorso a mano */
    }
    if (!inVista()) return;
    const box = el("div", "lib-setup");
    const lead = el("p", "docs-lead");
    lead.append(icona("bibliotecaOff"), el("span", "", status?.configured ? `La cartella della biblioteca (${status.path ?? ""}) non risponde. Controlla che Google Drive sia acceso, oppure scegli una cartella trovata.` : "La biblioteca della scuola non è ancora collegata. Chiedi al referente o scegli una cartella trovata."));
    box.append(lead, el("p", "docs-note", "Serve Google Drive per computer, con il Drive condiviso dell'istituto: il programma legge la cartella che Drive mostra sul computer."));
    const err = el("p", "docs-note warn");
    err.setAttribute("role", "alert");
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
      box.append(el("h3", "lib-subtitle", "Ho trovato queste cartelle"));
      const ul = el("ul", "docs-list");
      for (const c of found) {
        const li = el("li", "docs-row row");
        const info = el("div", "docs-info");
        const meta = el("div", "docs-meta");
        meta.append(el("span", "docs-when", c.path));
        info.append(el("strong", "docs-title", c.drive), meta);
        const use = el("button", "primary", "Usa questa");
        use.type = "button";
        use.setAttribute("aria-label", `Usa questa: ${c.drive}`);
        use.addEventListener("click", () => void choose(c.path, false));
        const actions = el("div", "row-actions");
        actions.append(use);
        li.append(info, actions);
        ul.append(li);
      }
      box.append(ul);
    } else {
      box.append(el("p", "docs-note", "Non ho trovato nessun Drive condiviso con una cartella «CAA» e dentro «biblioteca». Chiedi al referente della biblioteca."));
    }
    box.append(err);

    // Per chi imposta la biblioteca: chiusa finché non la si apre.
    const tecnico = el("details", "lib-admin");
    const summary = el("summary", "", "Per chi imposta la biblioteca");
    const path = el("input", "lib-path");
    path.type = "text";
    path.placeholder = "Per esempio G:\\Drive condivisi\\CAA Istituto\\CAA";
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
    tecnico.append(
      summary,
      el("p", "docs-note", "Scrivi il percorso della cartella «CAA» nel Drive condiviso dell'istituto. «Crea la biblioteca qui» serve solo la prima volta: crea le cartelle della biblioteca (biblioteca, archivio, simboli…)."),
      path,
      row,
    );
    box.append(tecnico);
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
      if (inVista()) body.replaceChildren(el("p", "docs-note warn", `Non riesco a leggere la biblioteca: ${String(e)}`));
      return;
    }
    if (!scan.configured) return void (await setup(status));
    deps.changed(status);
    if (!inVista()) return;

    const top = el("div", "lib-top");
    const state = el("span", scan.offline ? "lib-state off" : "lib-state on");
    state.append(icona(scan.offline ? "bibliotecaOff" : "biblioteca"), el("span", "", scan.offline ? "Drive non raggiungibile: vedi l'ultima copia" : "Collegata al Drive"));
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
    const vuoto = el("div", "lib-empty");
    const draw = (): void => {
      const shown = filterLibrary(scan.entries, q.value, subject.value, level.value);
      ul.replaceChildren();
      vuoto.replaceChildren();
      if (scan.entries.length === 0) {
        vuoto.append(
          statoVuoto(
            "biblioteca",
            "Nessun documento in biblioteca. Pubblica un tuo documento da «I miei documenti» perché i colleghi possano adattarlo.",
            deps.toMine ? { testo: "Vai a I miei documenti", fai: deps.toMine } : undefined,
          ),
        );
        return;
      }
      if (shown.length === 0) {
        vuoto.append(
          statoVuoto("cerca", "Nessun documento corrisponde alla ricerca.", {
            testo: "Cancella la ricerca",
            fai: () => {
              q.value = "";
              subject.value = "";
              level.value = "";
              draw();
              q.focus();
            },
          }),
        );
        return;
      }
      for (const e of shown) ul.append(row(e));
    };
    const row = (e: LibEntry): HTMLElement => {
      const li = el("li", "docs-row row lib-row");
      const name = e.title || e.file;
      const info = el("div", "docs-info");
      const meta = el("div", "docs-meta");
      const who = [e.author, e.subject, e.level].filter(Boolean).join(" · ");
      if (who) meta.append(el("span", "docs-when", who));
      meta.append(el("span", "docs-when", formatWhen(e.modified)));
      for (const t of e.tags) meta.append(el("span", "docs-tag chip", t));
      if (e.conflict) {
        const c = el("span", "docs-tag chip conflict", "copia in conflitto");
        c.title = "Un altro file ha lo stesso documento: chiedi all'autore quale tenere";
        meta.append(c);
      }
      info.append(el("strong", "docs-title", name), meta);
      const actions = el("div", "row-actions");
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
      actions.append(adapt);
      // Ritira: solo se il programma dice che l'utente può davvero (autore, riconosciuto dal nome utente di Windows,
      // o amministratore; K1). Sta nel menu «⋯» e chiede conferma.
      if (e.can_retire) {
        actions.append(
          menuRiga(`Altre azioni per «${name}»`, [
            {
              testo: "Ritira",
              icona: "ritira",
              pericolo: true,
              fai: () =>
                void (async () => {
                  const ok = await deps.confirm({
                    domanda: `Ritirare «${e.title}» dalla biblioteca?`,
                    spiegazione: "Esce dall'elenco ma resta nella cartella «archivio» del Drive.",
                    azione: "Ritira",
                    pericolo: true,
                  });
                  if (!ok) return;
                  library.retire(e.file).then(
                    () => void list(),
                    (err: unknown) => {
                      msg.textContent = `Non riesco a ritirare «${e.title}»: ${String(err)}`;
                    },
                  );
                })(),
            },
          ]),
        );
      } else {
        // Lo stesso spazio del pulsante «⋯»: le azioni principali restano in colonna.
        actions.append(el("span", "row-more-spazio"));
      }
      li.append(info, actions);
      return li;
    };
    for (const input of [q, subject, level]) input.addEventListener("input", draw);
    draw();
    body.replaceChildren(top, filters, notes, msg, ul, vuoto);
  }

  void list();
}

export interface CorrectionsTabDeps {
  corrections: CorrectionsClient;
  /** Per sapere se il Drive c'è (senza, non si invia). */
  library?: LibraryClient;
  confirm(c: Conferma): Promise<boolean>;
  attiva?: () => boolean;
}

/** La scheda «Correzioni» (M9c-3, scheda propria da M11-6): la spiegazione sempre in vista, cosa partirebbe, la
 *  raccolta che si può spegnere, l'invio a mano. */
export function showCorrectionsTab(body: HTMLElement, deps: CorrectionsTabDeps): void {
  const c = deps.corrections;
  body.replaceChildren(el("p", "docs-note", "Carico le correzioni…"));
  void (async () => {
    let info;
    try {
      info = await c.info();
    } catch (e) {
      if (deps.attiva?.() ?? true) body.replaceChildren(el("p", "docs-note warn", `Non riesco a leggere le correzioni: ${String(e)}`));
      return;
    }
    // Si inviano nella cartella «correzioni» del Drive: serve la biblioteca collegata e raggiungibile.
    let drive = false;
    if (deps.library) {
      try {
        const s = await deps.library.status();
        drive = s.configured && s.reachable;
      } catch {
        drive = false;
      }
    }
    if (!(deps.attiva?.() ?? true)) return;
    const box = el("section", "lib-corrections");
    box.setAttribute("aria-labelledby", "corr-titolo");
    const h = el("h3", "", "Correzioni anonime");
    h.id = "corr-titolo";
    box.append(h);
    box.append(
      el(
        "p",
        "docs-note corr-explain",
        "Quando scegli un simbolo diverso da quello proposto, il programma ricorda solo la parola, una parola prima e una dopo (senza nomi propri né numeri) e il simbolo scelto. Mai il testo e mai il tuo nome dentro il file. Attenzione: il file lo crea il tuo account Google, quindi chi ha accesso alla cartella del Drive può vedere da quale account arriva. Parte solo se premi «Invia»: servono a migliorare i simboli per tutti.",
      ),
    );
    const on = el("input");
    on.type = "checkbox";
    on.checked = info.enabled;
    const label = el("label", "pm-all corr-switch");
    label.append(on, " Raccogli le correzioni");
    on.addEventListener("change", () => {
      c.setEnabled(on.checked).catch(() => (on.checked = !on.checked));
    });
    const count = el("div", "corr-count");
    const nessuna = (): void => {
      count.replaceChildren(statoVuoto("invia", "Nessuna correzione in attesa."));
    };
    if (info.pending === 0) nessuna();
    else count.append(el("p", "docs-note", `${info.pending} ${info.pending === 1 ? "correzione in attesa" : "correzioni in attesa"}.`));
    const msg = el("p", "docs-note");
    msg.setAttribute("role", "status");
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
    const discard = conIcona(el("button", "", "Cancella senza inviare"), "elimina");
    discard.type = "button";
    discard.disabled = info.pending === 0;
    const send = conIcona(el("button", "primary", "Invia correzioni"), "invia");
    send.type = "button";
    send.disabled = info.pending === 0 || !drive;
    send.title = drive ? "Le copia nella cartella «correzioni» del Drive" : "Serve il Drive: la biblioteca deve essere collegata e raggiungibile";
    send.addEventListener("click", () => {
      send.disabled = true;
      msg.textContent = "";
      msg.classList.remove("warn");
      c.send().then(
        (n) => {
          msg.textContent = `Inviate ${n} ${n === 1 ? "correzione" : "correzioni"}. Grazie!`;
          nessuna();
          show.disabled = discard.disabled = true;
          preview.hidden = true;
        },
        (e: unknown) => {
          send.disabled = false;
          msg.textContent = `Non sono riuscito a inviarle: ${String(e)}`;
          msg.classList.add("warn");
        },
      );
    });
    discard.addEventListener("click", async () => {
      const ok = await deps.confirm({
        domanda: "Cancellare le correzioni raccolte senza inviarle?",
        spiegazione: "Non si può annullare.",
        azione: "Cancella senza inviare",
        pericolo: true,
      });
      if (!ok) return;
      c.discard().then(() => {
        nessuna();
        show.disabled = send.disabled = discard.disabled = true;
        preview.hidden = true;
      }, () => undefined);
    });
    // La principale («Invia») per ultima, a destra.
    actions.append(show, discard, send);
    box.append(label, count, actions, msg, preview);
    body.replaceChildren(box);
  })();
}
