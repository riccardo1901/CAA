import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/lexend/400.css";
import "@fontsource/lexend/700.css";
// L'interfaccia (M11-1): variabili, base, poi le zone. Il foglio e la stampa per ultimi (M11-0).
import "./css/tokens.css";
import "./css/base.css";
import "./css/bars.css";
import "./css/side.css";
import "./css/dialogs.css";
import "./css/docs.css";
import "./css/page.css";
import "./css/sheet.css";
import { startApp } from "./app";

const root = document.querySelector<HTMLDivElement>("#app");
if (root) startApp(root);
