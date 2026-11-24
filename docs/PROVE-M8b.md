# Prove a mano di M8b (PC Windows): correggere un simbolo

Cosa serve: l'app compilata dalla CI (`caa-app.exe`, artifact del run di GitHub Actions) e il pacchetto `caa-dati-prova.zip` aggiornato (1.686 immagini). **Chiudi l'app prima di sostituire la cartella `dati`.**

Nel pacchetto di prova ci sono le immagini delle parole del "Testo di esempio" e delle loro alternative. Nella **ricerca** (prova 8) molte immagini mancheranno e si vedrà un riquadro tratteggiato con "?": è un limite del pacchetto, nell'uso vero ci sono tutte.

## Le prove

| # | Cosa fare | Cosa deve succedere |
| --- | --- | --- |
| 1 | Clicca **"Testo di esempio"**, poi clicca **sul simbolo** (la parte alta) di una parola con un pittogramma. | Si apre un menu sotto la parola in meno di mezzo secondo: la parola, il simbolo attuale, una riga che dice perché ("nome, dal contesto…"), fino a 8 immagini numerate 1–8, i pulsanti **Nessun simbolo**, **Solo testo**, **Cerca…** e la casella **usa per tutto il testo** (spuntata). |
| 2 | Clicca sul **testo** della parola (sotto il simbolo). | Il menu non si apre: il cursore va nella parola come sempre. |
| 3 | Dal menu, clicca una delle immagini. | Il menu si chiude, il simbolo cambia. Se la stessa parola compare altre volte nel testo, cambia anche lì. |
| 4 | Premi **Ctrl+Z**, poi **Ctrl+Y**. | Ctrl+Z riporta il simbolo di prima (in un solo passo), Ctrl+Y rimette la scelta. |
| 5 | Riapri il menu su un'altra parola, **togli la spunta** da "usa per tutto il testo" e scegli un'immagine. | Cambia solo quella parola. |
| 6 | Metti il cursore dentro una parola e premi **Alt+↓**; poi premi un numero da **1** a **8**. | Il menu si apre sulla parola del cursore e il numero sceglie quell'immagine. **Esc** chiude il menu senza cambiare niente. |
| 7 | Dal menu scegli **Nessun simbolo**; poi **Solo testo**; poi (Alt+↓ sulla parola) **Automatico**. | "Nessun simbolo": spazio vuoto sopra la parola, senza riquadro tratteggiato. "Solo testo": la parola resta senza spazio sopra. "Automatico": torna il simbolo scelto dal motore. |
| 8 | Dal menu scegli **Cerca…** e scrivi `casa` (poi prova `pa`). | Compaiono pittogrammi; clicca uno (o premi **Invio** per il primo) e il simbolo cambia. Una parola senza risultati dice "Nessun simbolo trovato". |
| 9 | Scrivi una parola inventata, es. `blorpf`, poi premi **F8**. | Il cursore salta alla prossima parola con la sottolineatura arancione e si apre il menu (per una parola inventata ci sono solo la ricerca e le voci fisse). Premere ancora F8 passa alla successiva, dopo l'ultima si ricomincia. |
| 10 | Clicca sulla scritta **"N parole da controllare"** in basso a sinistra. | Come F8. |
| 11 | Scegli un simbolo per una parola da controllare. | Il contatore scende di uno. |
| 12 | Cambia una parola già corretta (aggiungi una lettera in fondo). | La scelta non vale più: torna il simbolo automatico per la parola nuova. |
| 13 | Con il menu aperto: clicca fuori, oppure scorri il foglio. | Il menu si chiude. |
| 14 | Scrivi veloce per 10 secondi. | Nessun ritardo (come in M8a). |

## Come mi riporti il risultato

- Se tutto va bene: "M8b ok".
- Altrimenti: il numero della prova e cosa hai visto (se puoi, una foto dello schermo).
- Dimmi anche: il menu ti sembra comodo? Le 8 immagini bastano? La riga "perché" ti è utile o confonde?

## Cosa non c'è ancora (M8c)

Simbolo personale (importare un'immagine), unire e dividere parole, politica personalizzata. Le correzioni valgono solo nel documento aperto: il salvataggio e la memoria fra documenti arrivano con M9.
