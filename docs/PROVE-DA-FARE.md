# Prove a mano da fare su Windows

Elenco delle prove già pronte che aspettano un PC Windows. Si aggiorna a ogni blocco; quando una prova è fatta, si segna qui con l'esito.

| Blocco | Istruzioni | Stato |
| --- | --- | --- |
| M8b — barra laterale, ricerca, F8, card | `docs/PROVE-M8b.md` | fatto, "M8b ok" |
| M8c-1 — politica Personalizzato (tabella, parole nascoste correggibili) | `docs/PROVE-M8c1.md` | **da fare** |
| M8c-2 — unisci e dividi parole | `docs/PROVE-M8c2.md` | **da fare** (pacchetto dati nuovo: 1.706 immagini) |
| M8c-3 — simboli personali (importa, ritaglia, riusa, cerca) | `docs/PROVE-M8c3.md` | **da rifare dalla prova 1**: la prima volta l'immagine non si vedeva (indirizzo `picto://` che rifiutava gli id dei simboli personali, corretto) |
| M9a — documenti `.caa`, salvataggio automatico, Documenti, lessico nuovo | `docs/PROVE-M9a.md` | **fatto: tutto ok tranne la 15** (due copie salvate senza avviso visibile). Avviso ora in alto e persistente: **da rifare solo la prova 15** |
| M9b-1 — biblioteca nel Drive condiviso (cartella, elenco, ricerca, Adatta, offline) | `docs/PROVE-M9b1.md` | **da fare** (serve Google Drive per computer e una cartella `CAA\biblioteca` nel Drive condiviso) |
| M9b-2 — Pubblica, Aggiorna, Ritira, «originale aggiornato», avviso di versione | `docs/PROVE-M9b2.md` | **da fare** (servono due computer o due account sullo stesso Drive; è la prova più importante per il Drive) |
| M9c-1 — «ricorda per sempre» (memoria del docente) | `docs/PROVE-M9c1.md` | **da fare** (solo app) |
| M9c-2 — simboli della scuola (condividi, prendi, ritira), elimina simbolo, autore per nome utente | `docs/PROVE-M9c2.md` | **da fare** (Drive; due computer per le prove 4–8) |
| M9c-3 — correzioni anonime (registro, anteprima, invio, `caa-eval correzioni`) | `docs/PROVE-M9c3.md` | **da fare** (Drive per l'invio) |
| M10 — stampa e PDF (finestra Stampa…, A4, piè di pagina, Informazioni) | `docs/PROVE-M10.md` | **da fare** (serve una stampante vera per le prove 7–9). Da M11 la finestra Stampa è la **scheda Pagina** del pannello laterale: le impostazioni sono le stesse, cambia solo dove stanno |
| M11 — nuova interfaccia (barre, pannello laterale a schede, finestre, scorciatoie, dimensione dell'interfaccia) | `docs/PROVE-M11.md` | **da fare** (meglio su un portatile piccolo e su un monitor grande, al 100%, 125% e 150%) |
| M11 — prova con un docente che non ha mai visto il programma | `docs/PROVE-M11.md`, ultima sezione | **da fare** (criterio di chiusura di M11) |

Nota per le prove di M8–M10 fatte dopo M11: i comandi sono cambiati di posto. «Testo di esempio» e «Informazioni» stanno nel menu **«Altro»**; «Contorna simbolo e parola» si chiama «Riquadro attorno a simbolo e parola» ed è nella scheda **Pagina**; le conferme sono finestre del programma con il verbo sul pulsante («Elimina», «Ritira»…) invece di «OK»; «Butta via» (correzioni) si chiama «Cancella senza inviare»; Pubblica, Elimina e Ritira dei documenti stanno nel menu **«⋯»** della riga.

Per ogni blocco serve `caa-app.exe` della CI dell'ultimo commit (artifact `caa-app`) e il pacchetto dati `caa-dati-prova.zip` più recente.
