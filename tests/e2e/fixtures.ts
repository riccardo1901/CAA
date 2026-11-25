// Pezzi comuni delle prove dell'editor: il motore finto (in pagina) e l'apertura del programma con quel motore.
// Nel browser non c'è il motore vero: il motore finto riconosce le parole con regole semplici e risponde dopo
// qualche millisecondo. Usati da motore.spec.ts e dalle prove dell'aspetto (M11).
import type { Page } from "@playwright/test";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const MOCK = `
(function () {
  const calls = [];
  const svg = (id) => 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="hsl(' + (id % 360) + ',60%,60%)"/></svg>');
  const RE = /\\p{L}[\\p{L}\\p{M}]*['’]?|\\d+(?:[.,:]\\d+)*|[^\\s\\p{L}\\d]/gu;
  function tokens(text, policy, forced, locks) {
    const out = [];
    for (const m of text.matchAll(RE)) {
      const w = m[0], s = m.index, e = s + w.length;
      const punct = !/[\\p{L}\\d]/u.test(w);
      let t = { s, e, kind: punct ? 'punct' : 'word', display: punct ? 'text' : 'full', picto: punct ? null : (w.toLowerCase().charCodeAt(0) * 7 + w.length), image: !punct, mods: 0, group: 0, head: false, gkind: '', confidence: 1, doubtful: false, placeholder: false };
      const lw = w.toLowerCase();
      if (lw === 'il' || lw === 'la') {
        const m = /articles=(\\w+)/.exec(policy);
        const rule = policy === 'essential' ? 'hidden' : policy.startsWith('custom:') ? (m ? m[1] : 'reduced') : 'reduced';
        t.display = { reduced: 'reduced', full: 'full', text: 'text', hidden: 'hidden' }[rule];
      }
      if (lw === 'sera') { t.picto = null; t.image = false; t.display = 'text'; t.placeholder = true; }
      if (lw === 'dubbio') { t.confidence = 0.4; t.doubtful = true; }
      if (lw === 'andato') t.mods = 2;
      if (lw === 'ferri') t.mods = 1;
      if (lw === 'andremo') t.mods = 4;
      if (lw === 'andati') t.mods = 3;
      if (!punct) { t.lemma = lw; t.cat = 'NOUN'; t.teacher = false; t.why = 'nome, prova'; }
      else { t.lemma = ''; t.cat = ''; t.teacher = false; t.why = ''; }
      const lock = locks.find((l) => l.lemma === t.lemma && l.cat === t.cat);
      if (lock) { t.picto = lock.picto; t.image = true; t.display = 'full'; t.placeholder = false; }
      const f = forced.find((x) => x.s === s && x.e === e && x.picto < 4294967294);
      if (f) {
        t.teacher = true; t.confidence = 1; t.doubtful = false; t.why = 'nome, scelto da te';
        if (f.picto === 0) { t.picto = null; t.image = false; t.display = 'text'; t.placeholder = false; }
        else { t.picto = f.picto; t.image = true; t.display = 'full'; t.placeholder = false; }
      }
      out.push(t);
    }
    // Gruppi: «scuola media» il motore la riconosce da solo (id 7); l'unione del docente (id 9) e la divisione.
    const splits = forced.filter((f) => f.picto === 4294967295);
    const overlaps = (a, b) => splits.some((f) => a < f.e && f.s < b);
    const group = (from, to, id) => {
      const idx = out.map((_, i) => i).filter((i) => out[i].s >= from && out[i].e <= to && out[i].kind === 'word');
      if (idx.length < 2) return;
      idx.forEach((i, k) => {
        const t = out[i];
        t.group = id; t.gkind = 'multiword'; t.head = k === 0;
        if (k > 0) { t.display = 'hidden'; t.picto = null; t.image = false; t.placeholder = false; t.doubtful = false; }
        else { t.picto = (from * 3 + to) % 900 + 100; t.image = true; t.display = 'full'; t.why = 'gruppo'; }
      });
    };
    const at = text.toLowerCase().indexOf('scuola media');
    if (at >= 0 && !overlaps(at, at + 12)) group(at, at + 12, 7);
    for (const f of forced.filter((x) => x.picto === 4294967294)) group(f.s, f.e, 9);
    // La scelta del docente sulla testa di un gruppo vince sul simbolo del gruppo.
    for (const f of forced.filter((x) => x.picto < 4294967294)) {
      const t = out.find((x) => x.s === f.s && x.e === f.e && x.head && x.group);
      if (t) { t.teacher = true; t.picto = f.picto || null; t.image = f.picto > 0; t.why = 'scelto da te'; }
    }
    return out;
  }
  window.__mock = { corr: Object.assign({ enabled: true, logged: [], pending: [], sendFail: '', sent: 0 }, window.__corrInit || {}), shared: Object.assign({ reachable: true, configured: true, symbols: [], shares: [], takes: [], retires: [], shareFail: '' }, window.__sharedInit || {}), deletes: [], memory: (window.__memInit || []).slice(), memoryFail: false, calls, delay: 4, fail: 0, alts: [], searches: [], altDelay: 3, custom: (window.__customInit || []).slice(), imports: [], docsStore: new Map(), saves: [], saveFail: 0, saveDelay: 0, conflictNext: false, broken: 0, readOnly: {}, mediaMap: [], lib: Object.assign({ configured: false, path: null, reachable: true, name: 'Maria', candidates: [], entries: [], cached: [], incomplete: 0, setCalls: [], scans: 0, adapts: [], adaptFail: false, nameFail: false, user: 'maria', admins: [], publishes: [], updates: [], retires: [], opens: [], publishFail: '', updateMode: '', retireFail: '', version: null }, window.__libInit || {}) };
  return {
    symbolize: (paras, policy, locks) => { calls.push({ texts: paras.map((p) => p.text), paras, locks, policy }); return new Promise((r, rej) => setTimeout(() => { if (window.__mock.fail > 0) { window.__mock.fail--; rej(new Error('motore guasto')); } else r(paras.map((p) => tokens(p.text, policy, p.forced, locks))); }, window.__mock.delay)); },
    alternatives: (para, policy, locks, s, e) => { window.__mock.alts.push({ para, s, e }); return new Promise((r) => setTimeout(() => r([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({ picto: 1000 + i, keyword: 'alt' + i, reason: 'altro senso', image: i !== 3 }))), window.__mock.altDelay)); },
    search: (q) => { window.__mock.searches.push(q); return new Promise((r) => setTimeout(() => r(q === 'zzz' ? [] : [{ picto: 9001, keyword: q + 'a', reason: 'cercato', image: true }, { picto: 9002, keyword: q + 'b', reason: 'cercato', image: true }]), 3)); },
    docs: window.__withDocs ? {
      list: async () => ({ entries: [...window.__mock.docsStore.values()].map((v) => v.entry).sort((a, b) => b.modified.localeCompare(a.modified)), broken: window.__mock.broken, dir: 'Documenti/CAA' }),
      save: async (p) => {
        window.__mock.saves.push(JSON.parse(JSON.stringify(p)));
        if (window.__mock.saveDelay) await new Promise((r) => setTimeout(r, window.__mock.saveDelay));
        if (window.__mock.saveFail > 0) { window.__mock.saveFail--; throw new Error('disco pieno'); }
        const store = window.__mock.docsStore;
        let file = p.file;
        if (!file) { let n = 1; do { file = (p.title || 'Senza titolo') + (n > 1 ? ' (' + n + ')' : '') + '.caa'; n++; } while (store.has(file)); }
        const prev = store.get(file);
        const conflict = !!window.__mock.conflictNext; window.__mock.conflictNext = false;
        const entry = { conflict, published_rev: prev ? prev.entry.published_rev : undefined, file, id: prev ? prev.entry.id : 'id-' + store.size, title: p.title, modified: new Date(Date.now() + store.size * 1000).toISOString(), rev: (prev ? prev.entry.rev : 0) + 1, author: 'Maria', origin: p.origin || null };
        store.set(file, { entry, payload: JSON.parse(JSON.stringify(p)) });
        return entry;
      },
      open: async (file) => {
        const v = window.__mock.docsStore.get(file);
        if (!v) throw new Error('documento non trovato');
        return { entry: v.entry, document: JSON.parse(JSON.stringify(v.payload.document)), render: v.payload.render, prefs: v.payload.prefs, sense_locks: v.payload.sense_locks, lexicon: v.payload.lexicon, created: v.entry.modified, read_only: !!window.__mock.readOnly[file], media: window.__mock.mediaMap };
      },
      remove: async (file) => { window.__mock.docsStore.delete(file); },
    } : undefined,
    library: window.__withLibrary ? {
      status: async () => { const l = window.__mock.lib; return { configured: l.configured, path: l.path, reachable: l.reachable, display_name: l.name, user: l.user, admins: l.admins }; },
      find: async () => window.__mock.lib.candidates,
      setFolder: async (path, create) => {
        const l = window.__mock.lib;
        l.setCalls.push({ path, create });
        if (path.includes('sbagliato') && !create) throw new Error('questa cartella non contiene una «biblioteca»: scegli quella giusta, oppure creala qui');
        l.configured = true; l.path = path;
        return { configured: true, path, reachable: l.reachable, display_name: l.name, user: l.user, admins: l.admins };
      },
      scan: async () => {
        const l = window.__mock.lib; l.scans++;
        if (!l.configured) return { configured: false, entries: [], incomplete: 0, offline: false };
        return { configured: true, entries: l.reachable ? l.entries : l.cached, incomplete: l.reachable ? l.incomplete : 0, offline: !l.reachable };
      },
      publish: async (file, meta) => {
        const l = window.__mock.lib; l.publishes.push({ file, meta, savedBefore: window.__mock.saves.length });
        if (l.publishFail) throw new Error(l.publishFail);
        const v = window.__mock.docsStore.get(file);
        v.entry = { ...v.entry, title: meta.title, published_rev: 1 };
        l.entries.unshift({ file: v.entry.id + '.caa', id: v.entry.id, title: meta.title, author: l.name, subject: meta.subject, level: meta.level, tags: meta.tags, created: new Date().toISOString(), modified: new Date().toISOString(), rev: 1, size: 100, conflict: false });
        return { kind: 'published', rev: 1, entry: v.entry };
      },
      update: async (file) => {
        const l = window.__mock.lib; l.updates.push({ file, savedBefore: window.__mock.saves.length });
        if (l.updateMode === 'fail') throw new Error('Luca lo sta aggiornando adesso: riprova tra poco');
        const v = window.__mock.docsStore.get(file);
        if (l.updateMode === 'new') { v.entry = { ...v.entry, id: 'new-id', published_rev: 1 }; return { kind: 'saved_as_new', rev: 1, entry: v.entry }; }
        const rev = (v.entry.published_rev || 1) + 1;
        v.entry = { ...v.entry, published_rev: rev };
        return { kind: 'updated', rev, entry: v.entry };
      },
      retire: async (file) => {
        const l = window.__mock.lib; l.retires.push(file);
        if (l.retireFail) throw new Error(l.retireFail);
        l.entries = l.entries.filter((e) => e.file !== file);
      },
      open: async (file) => {
        const l = window.__mock.lib; l.opens.push(file);
        const e = l.entries.concat(l.cached).find((x) => x.file === file);
        return { entry: { file, id: e.id, title: e.title, modified: e.modified, rev: e.rev, author: e.author, origin: null, published_rev: null }, document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Originale di ' + e.title }] }] }, render: [], prefs: {}, sense_locks: [], lexicon: 'lex-new', created: e.created, read_only: true, media: [] };
      },
      version: async () => window.__mock.lib.version,
      adapt: async (file) => {
        const l = window.__mock.lib; l.adapts.push(file);
        if (l.adaptFail) throw new Error('il documento non è disponibile');
        const e = l.entries.concat(l.cached).find((x) => x.file === file);
        const store = window.__mock.docsStore;
        const entry = { file: e.title + '.caa', id: 'copy-' + store.size, title: e.title, modified: new Date().toISOString(), rev: 1, author: l.name, origin: { id: e.id, rev: e.rev } };
        store.set(entry.file, { entry, payload: { document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Copia di ' + e.title }] }] }, prefs: {}, render: [], sense_locks: [], lexicon: 'lex-new' } });
        return entry;
      },
    } : undefined,
    settings: window.__withLibrary ? {
      getName: async () => window.__mock.lib.name,
      setName: async (n) => { if (window.__mock.lib.nameFail) throw new Error('non riesco a salvare il nome'); window.__mock.lib.name = n.trim().replace(/\\s+/g, ' '); return window.__mock.lib.name; },
    } : undefined,
    listCustom: async () => window.__mock.custom.slice(),
    corrections: window.__withCorrections ? {
      log: async (e) => { window.__mock.corr.logged.push(e); if (window.__mock.corr.enabled) window.__mock.corr.pending.push(e.lemma + '\t' + e.picto); },
      info: async () => ({ enabled: window.__mock.corr.enabled, pending: window.__mock.corr.pending.length }),
      preview: async () => window.__mock.corr.pending.map((p) => 'forma\tla\tè\t' + p),
      setEnabled: async (on) => { window.__mock.corr.enabled = on; },
      send: async () => { const c = window.__mock.corr; if (c.sendFail) throw new Error(c.sendFail); const n = c.pending.length; c.pending = []; c.sent += n; return n; },
      discard: async () => { window.__mock.corr.pending = []; },
    } : undefined,
    deleteCustom: async (uuid) => { window.__mock.deletes.push(uuid); window.__mock.custom = window.__mock.custom.filter((c) => c.uuid !== uuid); },
    shared: window.__withShared ? {
      share: async (uuid) => { const m = window.__mock.shared; if (m.shareFail) throw new Error(m.shareFail); m.shares.push(uuid); return { uuid, label: '', author: 'Maria', can_retire: true }; },
      list: async () => { const m = window.__mock.shared; return { configured: m.configured, reachable: m.reachable, symbols: m.reachable ? m.symbols : [] }; },
      take: async (uuid) => { const m = window.__mock.shared; m.takes.push(uuid); const s = m.symbols.find((x) => x.uuid === uuid); const sym = { id: 2147490000 + m.takes.length, uuid, label: s.label }; window.__mock.custom.push(sym); return sym; },
      retire: async (uuid) => { const m = window.__mock.shared; m.retires.push(uuid); m.symbols = m.symbols.filter((x) => x.uuid !== uuid); },
    } : undefined,
    memory: {
      list: async () => window.__mock.memory.slice(),
      add: async (e) => { if (window.__mock.memoryFail) throw new Error('disco pieno'); window.__mock.memory = window.__mock.memory.filter((m) => !(m.lemma === e.lemma && m.form === e.form)).concat([e]); },
      forget: async (e) => { window.__mock.memory = window.__mock.memory.filter((m) => !(m.lemma === e.lemma && m.form === e.form)); },
      clear: async () => { window.__mock.memory = []; },
    },
    importCustom: async (blob, label) => {
      window.__mock.imports.push({ size: blob.size, type: blob.type, label });
      const n = window.__mock.custom.length;
      const sym = { id: 2147483648 + n, uuid: 'uuid-' + n, label };
      window.__mock.custom.push(sym);
      return sym;
    },
    url: (id) => svg(id),
  };
})()
`;

export async function open(page: Page, text?: string, docs = false, library: Record<string, unknown> | false = false): Promise<void> {
  page.on("dialog", (d) => void d.accept());
  await page.goto("/");
  await page.waitForFunction(() => (window as any).caaProto);
  await page.evaluate(
    ([mock, txt, withDocs, lib]) => {
      const p = (window as any).caaProto;
      (window as any).__withDocs = withDocs;
      (window as any).__withLibrary = lib !== false;
      (window as any).__withCorrections = (window as any).__withCorrFlag === true;
      (window as any).__withShared = (window as any).__withSharedFlag === true;
      (window as any).__libInit = lib || {};
      (window as any).__caaLibPollMs = 300;
      (window as any).__caaAutosaveMs = 150;
      (window as any).__caaRetryMs = 300;
      // Le conferme del programma (M11-3) dicono «sì» da sole, come prima la conferma del browser accettata qui sopra.
      // Le prove delle finestre (finestre.spec.ts) tolgono questa risposta e usano la finestra vera.
      (window as any).__caaConferma = () => true;
      p.setSize(68);
      if (txt !== undefined) {
        const doc = p.view.state.schema.nodes.doc.create(null, txt.split("\n").map((t: string) => p.view.state.schema.nodes.paragraph.create(null, t ? p.view.state.schema.text(t) : undefined)));
        p.view.updateState(p.view.state.constructor.create({ doc, plugins: p.view.state.plugins }));
      }
      p.enterEngineMode(eval(mock));
    },
    [MOCK, text, docs, library] as const,
  );
  // Un documento vuoto non ha simboli da aspettare: basta che l'interfaccia del motore sia su.
  if (text === "") await page.waitForSelector(".statusbar");
  else await page.waitForSelector(".w[style*='--img']");
}

/** La risposta automatica alle conferme del programma, da qui in avanti (true = l'azione, false = Annulla). */
export async function rispondiConferma(page: Page, si: boolean): Promise<void> {
  await page.evaluate((r) => {
    (window as any).__caaConferma = () => r;
  }, si);
}

/** Sceglie una voce del menu «Altro» (M11-4: «Testo di esempio», «Informazioni»…). */
export async function voceAltro(page: Page, nome: string | RegExp): Promise<void> {
  await page.getByRole("button", { name: "Altro", exact: true }).click();
  await page.getByRole("menuitem", { name: nome }).click();
}

/** «Contorna simbolo e parola»: nella barra degli strumenti o, se non ci sta, nel menu «Altro» (M11-4). */
export async function casellaContorno(page: Page) {
  const c = page.getByLabel("Contorna simbolo e parola");
  if (!(await c.isVisible())) await page.getByRole("button", { name: "Altro", exact: true }).click();
  return c;
}
