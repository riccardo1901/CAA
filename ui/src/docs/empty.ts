// Stati vuoti della finestra Documenti (M11-6, PIANO-M11.md 3.6): icona, una frase, un'azione.
import { icona, type NomeIcona } from "../ui/icons";

export function statoVuoto(ico: NomeIcona, frase: string, azione?: { testo: string; fai: () => void }): HTMLElement {
  const box = document.createElement("div");
  box.className = "empty";
  const segno = document.createElement("span");
  segno.className = "empty-icon";
  segno.append(icona(ico));
  const p = document.createElement("p");
  p.className = "empty-text";
  p.textContent = frase;
  box.append(segno, p);
  if (azione) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = azione.testo;
    b.addEventListener("click", azione.fai);
    box.append(b);
  }
  return box;
}
