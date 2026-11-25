import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/lexend/400.css";
import "@fontsource/lexend/700.css";
import "./style.css";
import { startApp } from "./app";

const root = document.querySelector<HTMLDivElement>("#app");
if (root) startApp(root);
