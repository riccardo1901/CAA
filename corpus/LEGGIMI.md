# Corpus di valutazione (M7)

20 testi per misurare il motore su un italiano da scuola: 7 storie, 6 favole, 7 storie sociali. Sono **scritti per il progetto** (sintetici), non testi veri della scuola: il corpus è fatto per crescere con testi reali e con le correzioni dei docenti.

- `testi/NN_titolo.txt`: il testo (con `# genere:`, `# gruppo:`, `# origine:`).
- `annotati/NN_titolo.tsv`: il testo annotato parola per parola (formato di `SPEC.md`).
- **Gruppo `sviluppo`** (14 testi): serve a trovare e correggere gli errori del motore.
- **Gruppo `prova`** (6 testi, 2 per genere): non si usa per correggere, solo per misurare; così si vede se i miglioramenti valgono anche su testi mai visti.

```bash
cargo run --release -q -p caa-eval -- corpus                     # metriche e errori per causa, sviluppo e prova
cargo run --release -q -p caa-eval -- corpus --gruppo prova      # solo la prova
cargo run --release -q -p caa-eval -- prepara corpus/testi/X.txt # bozza TSV dal motore, da correggere a mano
cargo run --release -q -p caa-eval -- candidati sale             # pittogrammi dell'indice per una parola
```

## Come si annota (regole)

Una riga per token, 6 colonne separate da tabulazione: `forma`, `categoria`, `lemma`, `pittogrammi accettati`, `segni`, `visualizzazione`. La punteggiatura ha una riga (`PUNCT`, lemma = il segno, `-`, `-`, `TextOnly`).

- **Categoria**: una delle 18 di `SPEC.md` (NOUN, PROPN, VERB, AUX, MODAL, ADJ, ADV, ART, ADP, ARTADP, PRON, CLITIC, DET, CONJ, NUM, INTJ, PUNCT, SYM). Gli ausiliari dei tempi composti e del passivo sono AUX; "essere" e "avere" come verbi pieni ("ho fame", "è stanco") sono VERB; potere, dovere, volere seguiti da un infinito sono MODAL.
- **Lemma**: forma del dizionario in minuscolo (infinito per i verbi, singolare per i nomi, maschile singolare per gli aggettivi). Una preposizione articolata ha il lemma della preposizione (al → a, nella → in). Il lemma conta solo per le parole con significato; per articoli, preposizioni e pronomi non cambia il risultato.
- **Segni**: `PLURAL` per un nome plurale il cui pittogramma è del singolare; `PAST` e `FUTURE` per i tempi (imperfetto, passato remoto, passato prossimo → PAST; futuro → FUTURE), sulla testa del gruppo e non sull'ausiliare. Niente segno per le forme che hanno già una parola chiave plurale propria (occhiali, mani, denti) né per i nomi invariabili.
- **Visualizzazione**: `Full` se il token mostra un pittogramma, `TextOnly` se non ce n'è nessuno adatto (nomi propri, parole senza pittogramma), `Hidden` per ciò che sta dentro un gruppo: ausiliare di un tempo composto, clitico riflessivo di un verbo pronominale ("mi lavo" = lavarsi), parole assorbite da un pittogramma di espressione.
- **Pittogrammi accettati** (colonna 4): gli id ARASAAC che un docente accetterebbe per quel significato in quella frase, separati da `|`. Più di uno quando vanno bene più immagini. Gli ausiliari nascosti hanno `-`.
- **Espressioni**: dove ARASAAC ha un pittogramma che copre davvero un'espressione della frase ("far colazione", "lavarsi i denti", "andare a scuola"), la testa è la prima parola con l'id dell'espressione e le altre parole assorbite sono `Hidden`. Altrimenti ogni parola ha il suo simbolo.
- Un pittogramma sbagliato nel significato (per esempio "sale" = condimento dove serve "salire") **non** si accetta, anche se l'immagine è per la parola giusta.

## Cose da sapere sull'annotazione (M7)

- Le bozze del motore sono state corrette da cinque annotatori indipendenti (uno ogni quattro testi). Chi annota tende a lasciare la bozza com'è dove non è sicuro: per questo, dopo l'annotazione, le tre parole grammaticali più frequenti che il motore sbagliava nelle bozze ("e", "a", "i": la bozza dava la lettera dell'alfabeto) sono state **armonizzate**: il pittogramma accettato è quello grammaticale (11399, 7041, 8477), mai la lettera. Senza questa armonizzazione la misura di partenza sarebbe stata gonfiata dagli annotatori che avevano accettato le lettere.
- Il lemma dei verbi pronominali si scrive "lavarsi" ma per il motore è "lavare" (il pronominale sta nel pittogramma): la misura li considera uguali.
- I riflessivi della stessa persona ("mi lavo", "si è messa") sono sempre `Hidden`, anche se ARASAAC non ha il verbo con "-si"; "c'è", "ci sono" = "esserci" (il "ci" è nascosto).
- Sinonimi: dove una parola non ha pittogramma gli annotatori hanno accettato quello di un sinonimo sensato ("tornare" → "ritornare"); è il tipo di scelta che in M8 farà il menu delle alternative e che il motore impara dai file curati.
- 14 testi di sviluppo e 6 di prova; la prova non si usa per correggere (nemmeno guardando le singole parole).

