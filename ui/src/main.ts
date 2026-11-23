import "./style.css";
import { startApp } from "./app";

const root = document.querySelector<HTMLDivElement>("#app");
if (root) startApp(root);
