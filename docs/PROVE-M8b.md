# Prove a mano di M8b (PC Windows): correggere un simbolo con la barra laterale

Cosa serve: l'app compilata dalla CI (`caa-app.exe`, artifact del run di GitHub Actions) e il pacchetto `caa-dati-prova.zip` aggiornato (1.686 immagini). **Chiudi l'app prima di sostituire la cartella `dati`.**

Nel pacchetto di prova ci sono le immagini delle parole del "Testo di esempio" e delle loro alternative. Nella **ricerca** (prova 8) molte immagini mancheranno e si vedrà un riquadro tratteggiato con "?": è un limite del pacchetto, nell'uso vero ci sono tutte.

## Le prove

A destra c'è una **barra laterale fissa**: all'inizio mostra solo i suggerimenti, poi si riempie quando agisci su una parola.

| # | Cosa fare | Cosa deve succedere |
| --- | --- | --- |
| 1 | Clicca **"Testo di esempio"**, poi clicca **sul simbolo** (la parte alta) di una parola. | La parola si evidenzia in giallo e la barra mostra: la parola, il simbolo attuale, la riga "perché", fino a 8 immagini numerate, i pulsanti **Nessun simbolo**, **Solo testo**, **Cerca…** e la casella **usa per tutto il testo** (spuntata). |
| 2 | Clicca sul **testo** della parola (sotto il simbolo). | La barra non cambia: il cursore va nella parola come sempre. |
| 3 | Nella barra, clicca una delle immagini. | Il simbolo cambia nel testo e nella barra (compare **Automatico** e il "perché" dice "scelto da te"). Se la stessa parola compare altre volte, cambia anche lì. Il cursore torna nel testo. |
| 4 | Premi **Ctrl+Z**, poi **Ctrl+Y**. Poi prova i pulsanti **Annulla** e **Ripeti** in alto, e **Ctrl+Maiusc+Z**. | Annulla riporta il simbolo di prima (un solo passo), Ripeti rimette la scelta. **Dimmi quali dei tre modi di ripetere funzionano** (Ctrl+Y, Ctrl+Maiusc+Z, pulsante). |
| 5 | Scegli un'altra parola, **togli la spunta** da "usa per tutto il testo" e scegli un'immagine. | Cambia solo quella parola. |
| 6 | Metti il cursore dentro una parola e premi **Alt+↓**; poi premi un numero da **1** a **8**. | La barra si riempie con la parola del cursore e il numero sceglie quell'immagine. **Esc** riporta il cursore nel testo senza cambiare niente. Quando il cursore è nel testo, i numeri si scrivono normalmente. |
| 7 | Dalla barra scegli **Nessun simbolo**; poi **Solo testo**; poi (Alt+↓ sulla parola) **Automatico**. | "Nessun simbolo": spazio vuoto sopra la parola, senza riquadro tratteggiato. "Solo testo": la parola resta senza spazio sopra. "Automatico": torna il simbolo scelto dal motore. |
| 8 | Dalla barra scegli **Cerca…** e scrivi `casa` (poi prova `pa`). | Compaiono pittogrammi; clicca uno (o premi **Invio** per il primo) e il simbolo cambia. Una parola senza risultati dice "Nessun simbolo trovato". |
| 9 | Scrivi parecchie righe, in fondo una parola inventata (es. `blorpf`), poi risali in cima al foglio e premi **F8**. | Il foglio scorre fino alla parola con la sottolineatura arancione, che si evidenzia in giallo; la barra la mostra. F8 ancora passa alla successiva; dopo l'ultima si ricomincia. |
| 10 | Clicca sulla scritta **"N parole da controllare"** in basso a sinistra. | Come F8, anche se la parola è fuori schermo. |
| 11 | Scegli un simbolo per una parola da controllare. | Il contatore scende di uno. |
| 12 | Cambia una parola già corretta (aggiungi una lettera in fondo). | La scelta non vale più, torna il simbolo automatico e la barra si svuota. |
| 13 | In alto spunta **Contorna simbolo e parola**. | Ogni coppia simbolo-parola ha un contorno, come una card. Chiudi e riapri l'app: l'impostazione resta. Togli la spunta: i contorni spariscono. |
| 14 | Scrivi veloce per 10 secondi. | Nessun ritardo (come in M8a). |

## Come mi riporti il risultato

- Se tutto va bene: "M8b ok".
- Altrimenti: il numero della prova e cosa hai visto (se puoi, una foto dello schermo).
- Dimmi anche: la barra laterale ti sembra comoda? Le 8 immagini bastano? La riga "perché" ti è utile o confonde? Le card sono leggibili anche con simboli piccoli?

## Cosa non c'è ancora (M8c)

Simbolo personale (importare un'immagine), unire e dividere parole, politica personalizzata. Le correzioni valgono solo nel documento aperto: il salvataggio e la memoria fra documenti arrivano con M9.
