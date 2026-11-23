# Rapporto M5 — disambiguazione (fase 7)

Data: 2026-11-23. Misure con `caa-eval` su `data/build` (schema 2) e sul treebank ISDT (Universal Dependencies italiano, tag r2.17). I test sul mini-lessico girano anche in CI; quelli sui dati veri si eseguono in locale e si saltano da soli se `data/build` o il treebank mancano.

## Criteri di accettazione

| Criterio (SPEC.md) | Esito |
| --- | --- |
| Test dorati 1, 2, 9, 10, 17, 18, 19 verdi | **7 su 7**, nel file `lexicon/golden/analisi.tsv` (48 casi in tutto, tutti verdi). Il PASSATO e "un po'" intero sono di M6: qui si controllano categoria e lemma |
| I 20 test dorati di tokenizzazione restano verdi | **48 su 48** |
| Velocità: meno di 5 ms per un paragrafo di 100 parole | **0,34 ms** (mediana, paragrafo di 74 parole, build di rilascio) |

Verifiche: tutti i test verdi (`cargo test`), `fmt` e `clippy -D warnings` puliti, `caa-engine` compila ancora per WebAssembly.

## Misura sul treebank (prima e dopo)

Parole valutate: quelle del treebank che il motore trova nel testo con lo stesso intervallo, senza punteggiatura. "Lettura giusta fra quelle del motore" è il massimo ottenibile: se la lettura giusta non è fra le candidate, nessuna decodifica può trovarla.

| Misura | M4 (scelta fissa) | M5, sviluppo | M5, **prova** (misurata una sola volta) |
| --- | --- | --- | --- |
| Parole valutate | 9.666 | 9.666 | 8.465 |
| Lettura giusta fra le candidate | 94,5% | 97,3% | 97,4% |
| **Categoria giusta** | 78,0% | **94,8%** | **94,9%** |
| Lemma giusto | 70,0% | 82,4% | 82,0% |
| Parole ambigue: categoria giusta | 53,5% | 91,9% | 92,7% |
| Errori sottolineati (confidenza < 0,6) | 93,4%* | 38,0% | 42,0% |
| Parole giuste sottolineate | 36,3%* | 2,8% | 3,1% |

\* In M4 la confidenza era provvisoria (0,5 a ogni parola ambigua): sottolineava quasi tutto, quindi non è confrontabile.

Sviluppo e prova danno lo stesso risultato: i pesi non sono stati adattati al file di prova, che è stato misurato una sola volta alla fine.

## Come funziona

- **Treebank → statistiche** (`tagger.bin`, 0,8 MB, cartella `treebank/` separata per licenza): conteggi (categoria, lemma) per forma, trigrammi di categoria con smoothing per interpolazione (0,70 trigramma, 0,25 bigramma, 0,05 unigramma) e probabilità di ogni categoria. La build usa solo `train`; `dev` serve alla taratura, `test` alla misura finale.
- **Categorie**: le 18 nostre da UPOS. Decisioni: l'ausiliare copulativo ("è stanco") vale verbo pieno, come nella fase 5 della specifica; potere, dovere e volere sono modali; articolo e clitico si riconoscono da `PronType=Art` e da `PronType=Clit` o `Clitic=Yes` (ISDT usa la seconda forma per "si", "mi", "ne"); una preposizione articolata ("dalla") è un solo token `ArtAdp`.
- **Punteggio di una frase**: prior della lettura (dal treebank, diviso per la frequenza della categoria, cioè la probabilità di emissione di un HMM) + trigramma di categoria + regole di contesto della specifica (accordo, pronome soggetto + verbo, "non" + verbo, preposizione + infinito, modale + infinito, bonus della maiuscola). Viterbi sulle coppie di letture sceglie la sequenza; forward-backward dà la probabilità a posteriori di ogni lettura, che è la **confidenza** (sommando le letture con stessa categoria e lemma, che differiscono solo per i tratti).
- **Confidenza**: temperatura 1,5 (scelta in modo che le parole giuste sottolineate restino sotto il 5%: una sottolineatura costa un controllo al docente, troppe e non le guarda più). Le fonti incerte (chiave ARASAAC 0,7, refuso 0,4, suffisso 0,3) restano un tetto.
- Senza `tagger.bin` il motore funziona come in M4 (scelta provvisoria): il file è facoltativo, ma se c'è deve venire dalla stessa build del lessico.

## Decisioni prese (approvate nel piano)

1. **Treebank = ISDT** (CC BY-NC-SA 3.0, compatibile con il progetto non commerciale). `tagger.bin` eredita la licenza: file separato, attribuzione nella schermata Informazioni (da fare in M8). **MarkIT** (CC BY 4.0) provato e scartato: +0,1 punti su sviluppo, +0,0 su prova, e faceva fallire un caso dorato.
2. **Finché non c'è il corpus scolastico (M7), il treebank fa da corpus** per misurare e tarare.
3. **Etichette `WH` e `WH-CHE`** (questione aperta della specifica, chiusa): `che` ha ora anche la lettura di pronome relativo/interrogativo, e `quando`, `come`, `perché`, `qualora` anche quella di congiunzione, aggiunte in `lexicon/overrides/forms_extra.tsv`. Prima la lettura giusta mancava per 100 "che" su 9.666 parole; ora il tagger sceglie.
4. **Pesi della specifica invariati**. La taratura (`caa-eval tara`, discesa coordinata su sviluppo e casi dorati) non ha trovato nessuna combinazione migliore sullo sviluppo. L'ablazione (un peso alla volta a zero) mostra che sul treebank contano soprattutto la maiuscola (−20 parole) e l'accordo negativo (−7); le regole sul soggetto, "non", preposizione + infinito e modale + infinito non cambiano nessuna delle 9.666 parole, perché i trigrammi già le coprono. Restano per i testi scolastici, che il treebank rappresenta poco. Azzerare l'accordo e "non" e abbassare il prior fa passare un caso dorato in più ma costa 21 parole sullo sviluppo: scartato per non adattare i pesi ai miei casi.
5. **Due correzioni emerse dalla misura**, fatte perché senza di esse M4 peggiorava: (a) il prior del treebank non distingue le maiuscole, quindi "sasso" minuscolo diventava nome proprio: una lettura di nome proprio per una parola in minuscolo ha ora una penalità (−3,0); (b) se la lettura scelta non ha pittogramma ("tanto" avverbio) si usa quello di un'altra lettura dello stesso lemma ("tanto" aggettivo, via plurale "tanti"), con la penalità di confidenza della categoria diversa. La copertura delle parole di base è tornata a 96,7% con le stesse 17 eccezioni.

## Limiti noti

- **Dominio del treebank**: ISDT è fatto di giornali, leggi e wiki, non di storie per la primaria. "legge" è visto soprattutto come nome, "resto" come nome, "maestra" come aggettivo; "nome proprio + la + verbo" ("Marco la porta a scuola") non passa. I tre casi sono in `lexicon/golden/analisi_limiti.tsv` (non fa fallire la build; quando un caso passa si sposta in `analisi.tsv`). La correzione vera è il corpus scolastico di M7 o i prior curati a mano (`ambiguity_priors.tsv`, previsti dalla specifica).
- **Lemma 82%** contro categoria 95%: in parte sono convenzioni diverse fra Morph-it! e UD (participi, forme di "essere"), in parte lessico mancante. Non blocca la scelta del pittogramma, ma ne limita la qualità.
- **Parole sconosciute**: 62 nomi dello sviluppo (micelio, servitù…) non hanno nessuna lettura; per le parole di scuola dell'infanzia è meno frequente, ma da misurare in M7.
- Le regole di accordo e quelle sul soggetto lavorano su tratti che Morph-it! non dà per tutte le forme; le multiparola e le ipotesi di gruppo (bonus +1,0) arrivano con M6.

## Comandi nuovi

```bash
node scripts/fetch-treebank.mjs                      # ISDT e MarkIT in data/raw/treebank/ (fuori da git)
cargo run --release -p caa-lexicon-build             # ora costruisce anche data/build/treebank/tagger.bin
cargo run --release -q -p caa-eval -- tagger         # misura sul treebank (--conllu FILE per la prova)
cargo run --release -q -p caa-eval -- analisi        # test dorati di analisi
cargo run --release -q -p caa-eval -- tara           # taratura, ablazione e calibrazione (solo sviluppo)
```
