import { baseKeymap } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import type { Node as PMNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { normalizeMarks, normalizeState, toggleBoldWords } from "./wordMarks";
import { engineKey, engineSymbolPlugin } from "./engineSymbols";
import { hooks, symbolClickPlugin } from "./menuHooks";
import { symbolPlugin, symbolKey, type Mode } from "./symbolPlugin";

export function createEditor(mount: HTMLElement, doc: PMNode, mode: Mode = "A"): EditorView {
  const state = normalizeState(EditorState.create({
    doc,
    plugins: [
      history(),
      keymap({
        "Mod-z": undo,
        "Mod-y": redo,
        "Shift-Mod-z": redo,
        "Mod-b": toggleBoldWords,
        // Menu delle alternative (M8b).
        "Alt-ArrowDown": () => hooks.openAtCursor?.() ?? false,
        F8: () => hooks.next?.() ?? false,
      }),
      keymap(baseKeymap),
      normalizeMarks(),
      symbolPlugin(mode),
      engineSymbolPlugin(),
      symbolClickPlugin(),
    ],
  }));
  // Lingua italiana e correttore ortografico di sistema (prova 6 di M3).
  return new EditorView(mount, { state, attributes: { lang: "it", spellcheck: "true" } });
}

export function currentMode(view: EditorView): Mode {
  return symbolKey.getState(view.state)?.mode ?? "off";
}

/** Sostituisce il documento mantenendo il plugin (nuovo stato, cronologia azzerata). */
export function replaceDoc(view: EditorView, doc: PMNode): void {
  const mode = currentMode(view);
  // Un nuovo stato riparte da capo anche per i plugin: si ricordano motore e politica.
  const engine = engineKey.getState(view.state);
  view.updateState(normalizeState(EditorState.create({ doc, plugins: view.state.plugins })));
  view.dispatch(view.state.tr.setMeta(symbolKey, { mode, refresh: true }));
  view.dispatch(
    view.state.tr.setMeta(engineKey, engine?.client ? { client: engine.client, policy: engine.policy, refresh: true } : { refresh: true }),
  );
}
