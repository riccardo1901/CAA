# Prove a mano di M9c-1 (PC Windows): «ricorda per sempre»

Serve l'app nuova (`caa-app.exe` della CI dell'ultimo commit) e il pacchetto dati più recente. La memoria sta in `%APPDATA%\Editor CAA\memoria.json` (puoi guardarla con Esplora file; **non** va nel Drive).

| # | Cosa fare | Cosa deve succedere |
| --- | --- | --- |
| 1 | Scrivi `Mi piace il pane.` Clicca il simbolo di **pane**. Nella barra, sotto «usa per tutto il testo», c'è **«ricorda per sempre»**. | La casella è **spenta** (ricordare è una scelta tua). |
| 2 | Accendi «ricorda per sempre» e scegli un'alternativa. | Il simbolo cambia. Nella cartella dati compare `memoria.json`. |
| 3 | **Nuovo** documento, scrivi `pane`. | La parola esce **subito** con il simbolo scelto; clicca il simbolo: il perché dice «scelta ricordata». |
| 4 | Chiudi il programma, riaprilo, scrivi `pane`. | Il simbolo scelto c'è ancora. |
| 5 | Nel documento della prova 3 scegli per «pane» un altro simbolo **senza** «ricorda per sempre». | Quella scelta vince nel documento. Un documento nuovo con `pane` ha ancora il simbolo ricordato. |
| 6 | Con «ricorda per sempre» acceso scegli **Solo testo** o **Nessun simbolo**. | Non si ricorda niente (`memoria.json` non cambia). |
| 7 | Clicca fuori dalle parole perché la barra si svuoti (o riavvia): in fondo c'è **«Cosa ricordo»** con la lista (miniatura, parola, **Dimentica**) e **Dimentica tutto**. | Dimentica toglie una voce e il documento aperto torna al simbolo automatico; Dimentica tutto chiede conferma. |
| 8 | Prova una parola che il programma non conosce (es. `blorpf`) con «ricorda per sempre». | Si ricorda per quella forma esatta; compare in «Cosa ricordo». |
| 9 | Rovina `memoria.json` (cancella una parentesi) e riavvia. | Il programma parte con la memoria vuota e il file rovinato è messo da parte come `memoria.rovinata.json`. |

## Come mi riporti il risultato
- Se tutto va bene: "M9c-1 ok".
- Altrimenti: il numero della prova e cosa hai visto.
- Dimmi anche: un documento **vecchio**, riaperto dopo aver ricordato una parola, cambia simbolo da solo. Ti sta bene o preferiresti che i documenti già fatti restassero come erano?

## Da sapere
- La memoria vale per lemma e categoria («pesca» frutto non tocca «pescare»); solo le parole sconosciute si ricordano per forma.
- È sul tuo computer: non viaggia nei documenti né nel Drive.
