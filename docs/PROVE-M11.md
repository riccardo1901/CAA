# Prove a mano di M11 (PC Windows): la nuova interfaccia

Serve l'app nuova (`caa-app.exe` della CI dell'ultimo commit, artifact `editor-caa-windows`) e il pacchetto dati più recente. Il foglio e la stampa **non devono essere cambiati**: se vedi un simbolo, una parola o un margine diverso da prima, è un difetto.

Se puoi, fai le prove su **due computer**: il portatile più piccolo della scuola e un monitor grande. Per cambiare il ridimensionamento: tasto destro sul desktop → Impostazioni schermo → «Scala» (100%, 125%, 150%).

| # | Cosa fare | Cosa deve succedere |
| --- | --- | --- |
| 1 | Chiudi il programma, rinomina `%APPDATA%\Editor CAA\settings.json` (per esempio in `settings-vecchio.json`, per rimetterlo dopo) e riapri il programma. | La finestra si apre **centrata e un po' più piccola dello schermo** (circa 85%), mai più grande. Benvenuto con il segno «Editor CAA» e una frase su cosa fa; si chiede solo il nome. |
| 2 | Scrivi il nome e premi **Continua**. | Foglio vuoto con l'invito «Scrivi qui il tuo testo…», tre suggerimenti e «Prova con un testo di esempio». |
| 3 | Clicca sul foglio e scrivi una frase. | L'invito sparisce alla prima lettera; i simboli arrivano. Il titolo in alto mostra subito la prima riga in grigio. |
| 4 | Clicca il simbolo di una parola e scegli un'alternativa (anche col tasto 1–8). | Si apre il pannello laterale sulla scheda **Simbolo**; il simbolo cambia. Sul portatile piccolo il pannello sta sopra il foglio, ma la parola scelta resta in vista; **Esc** lo richiude. |
| 5 | Premi **F8** (o clicca «N parole da controllare» in basso). | Il foglio va alla prossima parola da controllare e il pannello si apre su di lei. |
| 6 | Clicca nel pannello laterale, poi premi **Ctrl+Z** e **Ctrl+Y**. | Annulla e Ripeti funzionano anche con il fuoco fuori dal foglio (prima con Ctrl+Y non succedeva niente). |
| 7 | In alto clicca **Stampa…** (o Ctrl+P). | Il pannello passa alla scheda **Pagina**, con il foglio visibile accanto. Cambia orientamento, carattere, «Riquadro attorno a simbolo e parola», «Bordo attorno al solo simbolo»: il foglio cambia subito. |
| 8 | Nella scheda Pagina premi **Stampa…** e guarda l'anteprima di Windows, poi salva con «Microsoft Print to PDF». | Anteprima e PDF **uguali a quelli di M10**: niente barre o pannelli, attribuzione ARASAAC su ogni pagina, il tuo nome nel piè di pagina se l'hai acceso. |
| 9 | Restringi la finestra a poco a poco (trascinando il bordo), fino al minimo. | La barra degli strumenti resta **su una riga**: i gruppi che non ci stanno passano nel menu **«Altro»** (Annulla e Ripeti restano). Nessun pulsante tagliato. Il pannello laterale si chiude da solo quando il foglio non ci sta più accanto. |
| 10 | Apri **Altro**: prova Testo di esempio, Informazioni, Scorciatoie da tastiera. Premi anche **F1**. | Il menu si usa anche con le frecce e Invio. Le scorciatoie sono divise in tre gruppi, con i tasti disegnati; Esc chiude e il fuoco torna dove era. |
| 11 | **Altro › Dimensione dell'interfaccia › Molto grande**. Chiudi e riapri il programma. | Barre, pannello e finestre diventano più grandi; **il foglio no**. Dopo la riapertura la scelta resta. Torna a «Normale». |
| 12 | Apri **Documenti**: passa da una scheda all'altra con ← →; su una riga apri il menu **«⋯»**. | Ogni riga ha un'azione principale («Apri», «Adatta»); Pubblica, Elimina, Ritira stanno nel menu «⋯». «Elimina» chiede conferma con un pulsante rosso; **Annulla** è quello con il fuoco. |
| 13 | Con la biblioteca: **Pubblica…** un documento, poi **← Indietro**. Se puoi, prova con un collega che ha **lo stesso nome** da mostrare. | Pubblica si apre come sotto-pagina con «← Indietro». **«Ritira» lo vede solo l'autore vero** (o l'amministratore), non un omonimo. |
| 14 | Premi **Tab** appena aperto il programma, poi più volte. | Il primo elemento è **«Vai al testo»** (Invio porta nel testo); poi il fuoco passa da un controllo all'altro, sempre con un **anello blu ben visibile**. Nelle finestre Tab non esce. |
| 15 | Ripeti le prove 4, 7 e 9 con lo schermo al **125%** e al **150%**. | Tutto leggibile e nitido (icone comprese), niente tagliato. L'A4 **orizzontale** su un portatile piccolo al 125% può richiedere di scorrere: è previsto (non c'è lo zoom del foglio). |
| 16 | Togli il permesso di scrittura alla cartella `Documenti\CAA` (come in `PROVE-M9a.md`, prova 16), scrivi qualcosa e chiudi il programma. Poi rimetti il permesso. | Una finestra del programma chiede «Resta nel programma» o «Esci senza salvare»; il programma non si chiude da solo. |

## Come mi riporti il risultato
- Se tutto va bene: "M11 ok".
- Altrimenti: il numero della prova, il computer (dimensione dello schermo e «Scala» di Windows) e cosa hai visto; se puoi, una foto dello schermo.

## La prova con un docente nuovo (criterio di chiusura di M11)
Una persona che **non ha mai visto il programma**, meglio sul portatile più piccolo della scuola. Le dici solo: «Scrivi una breve storia per un alunno, correggi un simbolo che non ti piace e stampala (o salvala in PDF)». **Non aiutarla**: annota dove esita, cosa cerca senza trovare, cosa clicca per sbaglio, e quanto tempo ci mette. Quelle note mi servono più di tutto il resto.
