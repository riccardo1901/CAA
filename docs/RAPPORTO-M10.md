# Rapporto M10: stampa ed esportazione

**Stato**: codice e prove automatiche fatti; prove a mano su Windows con stampante vera da fare (`docs/PROVE-M10.md`). Una revisione indipendente è prevista prima della chiusura.

## Cosa c'è
- **Finestra «Stampa…»** (pulsante e Ctrl+P): A4 verticale/orizzontale, margini (5–40 mm, 15 di partenza), testo sopra o sotto il simbolo, carattere (normale, Atkinson Hyperlegible, Lexend: SIL OFL, incorporati dal pacchetto npm `@fontsource`), bordo, una frase per riga, tutto maiuscolo, piè di pagina facoltativo (titolo, autore, numero di pagina). Le scelte stanno nel documento (`prefs.print`, ripulite alla lettura: valori strani tornano a quelli di partenza), quindi chiunque lo apre lo stampa uguale.
- **Stesso foglio dell'editor**: regole `@media print` (barre, barra laterale e pannelli nascosti; segnaposto, sottolineature dei dubbi e attenuazione non si stampano). I simboli stampano a grandezza vera: i pulsanti «Simboli» (45, 68, 94, 151 px a 96 dpi) sono 12, 18, 25 e 40 mm.
- **Simbolo e parola non si separano** (`break-inside: avoid` sull'unità parola).
- **Piè di pagina**: scritto nel riquadro del margine della pagina (`@page { @bottom-center }`, Chromium 131+), quindi **su ogni pagina**; l'attribuzione ARASAAC è fissa e non dipende da nessuna impostazione; titolo e autore sono messi dentro una stringa CSS con escape (virgolette, barre, a capo, `}` e `@page` non possono rompere la regola). Un elemento fisso come alternativa è stato provato e scartato: Chromium lo stampa solo sulla prima pagina. Se il motore è più vecchio (< 131) la finestra avvisa.
- **Una frase per riga**: a capo (segnaposto) inseriti solo durante la stampa e tolti dopo; il testo del documento non cambia.
- **Informazioni**: versione, attribuzione ARASAAC, Morph-it!, treebank ISDT, caratteri, uso non commerciale.
- **PDF**: dalla finestra di stampa con «Microsoft Print to PDF». Il PDF diretto da Rust e il PNG per pagina sono rimandati (PNG tolto dalla specifica).

## Prove automatiche (Playwright con PDF veri di Chromium 157)
PDF A4 verticale 595×842 pt e orizzontale 842×595; attribuzione su **ogni** pagina (12 pagine con simboli molto grandi); nessuna parola persa fra le pagine; interfaccia assente dal PDF; titolo con virgolette e `@page` dentro; una frase per riga nel PDF; impostazioni salvate e ritrovate; valori non validi ripuliti; avviso con motore vecchio; Ctrl+P; Informazioni non stampata.

## Metriche del motore
Non toccato: dorati 48/48; strutture 20/20; corpus sviluppo 6,9 (134/1945); prova 13,4 (86/643).

## Limiti noti
- Dimensioni reali dei simboli sulla carta e comportamento delle stampanti: solo con la prova a mano.
- `window.print()` dalla webview di Tauri su Windows: da verificare (dovrebbe aprire il dialogo di sistema con l'anteprima).
- Il numero di pagina compare solo se il motore supporta i riquadri dei margini.
