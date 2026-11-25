// Il primo avvio (M9b-1): si chiede solo il nome da mostrare (l'autore dei documenti che pubblicherai) e si
// guarda se la biblioteca del Drive condiviso si trova da sola. Poi un documento vuoto, pronto per scrivere.
import type { LibraryClient, LibStatus } from "../engine/client";
import { finestra } from "../ui/dialog";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** La finestra che chiede il nome: non si chiude senza scriverne uno. */
function askName(save: (name: string) => Promise<string>): Promise<string> {
  return new Promise((resolve) => {
    const overlay = el("div", "first-overlay");
    const box = el("div", "first-box");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Benvenuto");
    const input = el("input");
    input.type = "text";
    input.maxLength = 60;
    input.placeholder = "Nome e cognome";
    input.setAttribute("aria-label", "Il tuo nome");
    const ok = el("button", "primary", "Continua");
    ok.type = "button";
    ok.disabled = true;
    const err = el("p", "docs-note warn");
    box.append(
      el("h2", "", "Benvenuto/a nell'Editor CAA"),
      el("p", "docs-note", "Come ti chiami? Il tuo nome comparirà come autore dei documenti che pubblichi nella biblioteca dell'istituto."),
      input,
      err,
      ok,
    );
    overlay.append(box);
    document.body.append(overlay);
    // Comportamento unico delle finestre (M11-3), ma il nome serve: niente Esc né clic fuori per chiudere.
    const chiudi = finestra({ overlay, box, esc: false, clicFuori: false, fuoco: input });
    input.addEventListener("input", () => {
      ok.disabled = input.value.trim() === "";
    });
    const submit = (): void => {
      if (input.value.trim() === "") return;
      ok.disabled = true;
      save(input.value).then(
        (name) => {
          chiudi();
          resolve(name);
        },
        (e: unknown) => {
          ok.disabled = false;
          err.textContent = String(e);
        },
      );
    };
    ok.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
  });
}

export interface FirstRunDeps {
  settings: { getName(): Promise<string>; setName(name: string): Promise<string> };
  library: LibraryClient;
  notice(message: string): void;
  /** Lo stato della biblioteca (per l'indicatore in alto). */
  libraryStatus(status: LibStatus | null): void;
}

export async function firstRun(deps: FirstRunDeps): Promise<void> {
  let name = "";
  try {
    name = await deps.settings.getName();
  } catch {
    return; // senza impostazioni non si chiede niente
  }
  if (name === "") await askName((n) => deps.settings.setName(n));
  try {
    const status = await deps.library.status();
    deps.libraryStatus(status);
    if (!status.configured) {
      const found = await deps.library.find();
      if (found.length > 1) deps.notice("Ho trovato più Drive condivisi: scegli la biblioteca da «Documenti › Biblioteca».");
    }
  } catch {
    deps.libraryStatus(null);
  }
}
