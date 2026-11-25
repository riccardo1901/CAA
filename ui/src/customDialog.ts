// Importazione di un simbolo personale (M8c-3): si sceglie un'immagine (PNG o JPG), la si ritaglia a
// quadrato spostandola e ingrandendola, e si ottiene un'immagine WebP quadrata pronta da salvare.
// Tutto avviene sul computer: niente va in rete.
import { hooks } from "./editor/menuHooks";

/** Lato dell'anteprima e dell'immagine finale (px). */
const PREVIEW = 320;
const OUTPUT = 500;
const MAX_ZOOM = 4;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Mostra la finestra di ritaglio. Restituisce l'immagine WebP quadrata, o `null` se si annulla. */
export function cropImage(file: File, word: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(url);
      hooks.notice?.("Non riesco a leggere questa immagine: prova con un file PNG o JPG.");
      resolve(null);
    };
    img.onload = () => {
      const overlay = el("div", "crop-overlay");
      const dialog = el("div", "crop-dialog");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-label", "Simbolo personale");
      const canvas = el("canvas", "crop-canvas");
      canvas.width = PREVIEW;
      canvas.height = PREVIEW;
      const zoom = el("input");
      zoom.type = "range";
      zoom.min = "1";
      zoom.max = String(MAX_ZOOM);
      zoom.step = "0.01";
      zoom.value = "1";
      zoom.setAttribute("aria-label", "Ingrandimento");
      const privacy = el(
        "p",
        "crop-privacy",
        "Non usare foto di studenti senza l'autorizzazione della scuola. L'immagine resta su questo computer.",
      );
      const ok = el("button", "pm-btn", "Usa questo simbolo");
      ok.type = "button";
      const cancel = el("button", "pm-btn", "Annulla");
      cancel.type = "button";
      const buttons = el("div", "pm-fixed");
      buttons.append(ok, cancel);
      dialog.append(
        el("h2", "", `Simbolo personale per «${word}»`),
        el("p", "crop-help", "Trascina l'immagine per spostarla e usa la barra per ingrandirla: il quadrato è quello che diventa il simbolo."),
        canvas,
        zoom,
        privacy,
        buttons,
      );
      overlay.append(dialog);
      document.body.append(overlay);

      // Posizione: spostamento (px dell'anteprima) rispetto al centro; si ricalcola a ogni disegno.
      let panX = 0;
      let panY = 0;
      const geometry = (size: number) => {
        const base = Math.max(size / img.naturalWidth, size / img.naturalHeight);
        const scale = base * Number(zoom.value);
        const w = img.naturalWidth * scale;
        const h = img.naturalHeight * scale;
        // L'immagine deve sempre coprire il quadrato.
        const limitX = Math.max(0, (w - size) / 2);
        const limitY = Math.max(0, (h - size) / 2);
        const k = size / PREVIEW;
        const px = Math.max(-limitX, Math.min(limitX, panX * k));
        const py = Math.max(-limitY, Math.min(limitY, panY * k));
        return { x: size / 2 - w / 2 + px, y: size / 2 - h / 2 + py, w, h, k };
      };
      const draw = (c: HTMLCanvasElement) => {
        const ctx = c.getContext("2d");
        if (!ctx) return;
        const g = geometry(c.width);
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(img, g.x, g.y, g.w, g.h);
      };
      const redraw = () => {
        // Il limite dello spostamento cambia con l'ingrandimento: lo si riporta dentro.
        const g = geometry(PREVIEW);
        panX = g.x - (PREVIEW / 2 - g.w / 2);
        panY = g.y - (PREVIEW / 2 - g.h / 2);
        draw(canvas);
      };
      redraw();
      zoom.addEventListener("input", redraw);
      let drag: { x: number; y: number; px: number; py: number } | null = null;
      canvas.addEventListener("pointerdown", (e) => {
        drag = { x: e.clientX, y: e.clientY, px: panX, py: panY };
        canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener("pointermove", (e) => {
        if (!drag) return;
        panX = drag.px + (e.clientX - drag.x);
        panY = drag.py + (e.clientY - drag.y);
        redraw();
      });
      const end = () => {
        drag = null;
      };
      canvas.addEventListener("pointerup", end);
      canvas.addEventListener("pointercancel", end);

      const close = (blob: Blob | null) => {
        document.removeEventListener("keydown", onKey, true);
        overlay.remove();
        URL.revokeObjectURL(url);
        resolve(blob);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close(null);
        }
      };
      document.addEventListener("keydown", onKey, true);
      cancel.addEventListener("click", () => close(null));
      overlay.addEventListener("mousedown", (e) => {
        if (e.target === overlay) close(null);
      });
      ok.addEventListener("click", () => {
        const out = el("canvas");
        out.width = OUTPUT;
        out.height = OUTPUT;
        draw(out);
        out.toBlob(
          (blob) => {
            if (!blob || blob.type !== "image/webp") {
              hooks.notice?.("Non riesco a preparare l'immagine.");
              close(null);
              return;
            }
            close(blob);
          },
          "image/webp",
          0.9,
        );
      });
      ok.focus();
    };
    img.src = url;
  });
}
