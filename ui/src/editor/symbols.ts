// Simboli del prototipo. Nessun disegno è in git: i simboli semplici sono forme generate al volo
// e le immagini ARASAAC vere si scelgono da una cartella dell'utente (mai incluse nel programma).

const COLORS = ["#d94f4f", "#3b7dd8", "#2e9d5b", "#e0a526", "#8a4fd0", "#17a2b8"];
const SHAPES = ["circle", "square", "triangle", "diamond"] as const;

function simpleSymbol(i: number): string {
  const color = COLORS[i % COLORS.length];
  const shape = SHAPES[Math.floor(i / COLORS.length) % SHAPES.length];
  const body = {
    circle: `<circle cx="250" cy="250" r="210"/>`,
    square: `<rect x="50" y="50" width="400" height="400" rx="40"/>`,
    triangle: `<polygon points="250,40 460,440 40,440"/>`,
    diamond: `<polygon points="250,30 470,250 250,470 30,250"/>`,
  }[shape];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500">` +
    `<g fill="${color}" stroke="#222" stroke-width="14">${body}</g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** 24 simboli semplici: 6 colori × 4 forme. */
export const SIMPLE_SYMBOLS: string[] = Array.from({ length: 24 }, (_, i) => simpleSymbol(i));

let current: string[] = SIMPLE_SYMBOLS;

export function setSymbols(urls: string[]): void {
  current = urls.length > 0 ? urls : SIMPLE_SYMBOLS;
}

export function symbolCount(): number {
  return current.length;
}

function hash(word: string): number {
  let h = 2166136261;
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Simbolo (finto) di una parola: sempre lo stesso per la stessa parola. */
export function symbolUrl(word: string): string {
  return current[hash(word) % current.length];
}
