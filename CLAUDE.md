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

Da compilare in M0 (build, test, avvio in sviluppo, `caa-eval`, build del lessico).
