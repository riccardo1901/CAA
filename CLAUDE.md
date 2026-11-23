# CLAUDE.md — Editor CAA in simboli

Programma desktop (Tauri 2) per docenti: scrivono un testo italiano e vedono sopra ogni parola il pittogramma ARASAAC corretto, già flesso, pronto da stampare. Alternativa gratuita e non commerciale a SymWriter.

## Documenti di riferimento

- `SPEC.md`: specifica completa della v1. È la fonte di verità.
- `docs/IDEE.md`: idee per V2 e V3. **Non implementarle** senza richiesta esplicita.

## Come lavoriamo

- Si procede **una milestone alla volta** (M0–M11, sezione "Piano di sviluppo" di `SPEC.md`).
- Prima di scrivere codice per una milestone: rileggi la sezione pertinente di `SPEC.md`, proponi un piano e **aspetta l'approvazione**.
- Una milestone è chiusa solo quando il suo criterio di accettazione è verificato e mostrato.
- Se la specifica e il codice divergono, o la specifica è ambigua, **segnalalo** invece di scegliere da solo.
- L'utente non è uno sviluppatore di professione: spiega in italiano, in modo semplice, cosa stai per fare prima dei comandi che installano software o modificano il sistema.

## Regole tecniche

- `caa-engine` è una libreria pura: nessun I/O, nessuna rete, nessuna dipendenza dall'interfaccia.
- Offset dei token sempre in **unità UTF-16** verso l'interfaccia; test con parole accentate fin dal primo giorno.
- Ogni modifica al motore: output di `caa-eval` **prima e dopo** nella descrizione del commit. Una modifica che peggiora le metriche si scarta.
- I 20 test dorati di `SPEC.md` (sezione Valutazione) devono restare verdi.
- Per ogni bug trovato: prima il test che lo riproduce, poi la correzione.
- Nessuna dipendenza di rete in esecuzione: pittogrammi e lessico sono locali.

## Dati e licenze

- I dati grezzi (ARASAAC, Morph-it!, treebank) **non vanno mai in git**: solo gli script che li scaricano, in `data/raw/` (in `.gitignore`).
- I file compilati restano **separati per licenza** (ARASAAC = CC BY-NC-SA, Morph-it! = CC BY-SA/LGPL): non fonderli in un unico file.
- Attribuzione ARASAAC obbligatoria nella schermata Informazioni e nel piè di pagina di ogni stampa e PDF.
- Il progetto è non commerciale: niente pubblicità, niente funzioni a pagamento.

## Comandi

Struttura: `crates/` (motore, build del lessico, valutazione, archivio), `src-tauri/` (app), `ui/` (frontend Vite + TypeScript), `scripts/` (scarico dei dati), `lexicon/overrides/` (correzioni curate in TSV, versionate), `lexicon/golden/` e `lexicon/lessico_base*.tsv` (casi e parole per misurare il motore), `docs/` (rapporti di milestone e idee).

```bash
# Test Rust (motore, lessico, valutazione, archivio; esclude l'app Tauri)
cargo test

# Controlli di formato e qualità, gli stessi della CI
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings

# Frontend: installazione e build (controllo TypeScript + Vite)
npm install
npm run build

# Prove automatiche dell'editor (Playwright + Chromium; M3). Prima volta fuori dal container:
#   npx playwright install --with-deps chromium
npx playwright test                  # resa A (quella scelta); in CI senza @perf
npm run test:e2e:confronto           # resa A e B
npx playwright test --grep @perf     # velocità (dipende dalla macchina)

# App in sviluppo (richiede Rust, Node e, su Windows, WebView2)
npm run tauri dev

# App compilata senza installer (target/release/caa-app, su Windows caa-app.exe)
npx tauri build --no-bundle

# Valutazione del motore (M4: test dorati, copertura delle parole di base, velocità; le metriche
# sul corpus arrivano in M7). Servono i dati: prima si costruisce il lessico (vedi sotto).
cargo run -q -p caa-eval -- dorati                       # test dorati di tokenizzazione
cargo run -q -p caa-eval -- copertura                    # parole di base con pittogramma
cargo run --release -q -p caa-eval -- velocita           # tempo per un paragrafo di ~100 parole
cargo run -q -p caa-eval -- mostra "Metti il sale nell'acqua."   # cosa decide il motore

# Build del lessico: data/raw + lexicon/overrides -> data/build (fuori da git, ~15 s)
cargo run --release -p caa-lexicon-build
#   rapporto di copertura:  data/build/report/report.md
#   chiavi senza lemma:     data/build/report/keys_without_lemma.tsv
#   multiparola con parole sconosciute: data/build/report/multiword_unknown_words.tsv

# Misura del caricamento del lessico (criterio di M2: < 300 ms)
cargo run --release -p caa-store --example load_lexicon -- data/build

# Acquisizione dati (M1): tutto finisce in data/raw/, fuori da git. Gli script sono riprendibili.
node scripts/fetch-arasaac-keywords.mjs   # parole chiave italiane ARASAAC (api.arasaac.org)
node scripts/fetch-morphit.mjs            # Morph-it! (usa curl) convertito in UTF-8
node scripts/fetch-arasaac-images.mjs     # ~14.000 pittogrammi a 500 px in WebP (~20 min); --limit N per provare
node scripts/report-m1.mjs                # rapporto con conteggi, etichette Morph-it!, categorie ARASAAC
```

Nota per gli script di scarico: dentro il container cloud Node ha bisogno di `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`; sul PC normale non serve nulla. Il sito di Unibo (Morph-it!) rifiuta con 402 ogni User-Agent diverso da quello di curl, per questo `fetch-morphit.mjs` chiama `curl`.

Su Linux, per compilare l'app servono le librerie di sistema elencate nel job `linux` di `.github/workflows/ci.yml`.

La CI (GitHub Actions) gira su Linux e Windows; il job Windows pubblica `caa-app.exe` come artifact per la prova manuale.
