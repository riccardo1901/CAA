// M11-2 · Icone e suggerimenti (PIANO-M11.md 2.5, 2.7, 3.7; difetto K15).
import { expect, test, type Page } from "@playwright/test";
import { apriCompleto, documentiSalvati } from "./schermi";

/* eslint-disable @typescript-eslint/no-explicit-any */

const tip = (page: Page) => page.locator(".tip");

/** Pulsanti visibili senza un nome per i lettori di schermo (testo o aria-label). */
const senzaNome = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("button, [role=button]")]
      .filter((b) => b.getBoundingClientRect().width > 0 && !b.closest(".sheet"))
      .filter((b) => !(b.getAttribute("aria-label") || b.textContent || "").trim())
      .map((b) => b.outerHTML.slice(0, 80)),
  );

test("ogni pulsante visibile ha un nome, anche quelli solo icona (Annulla, Ripeti)", async ({ page }) => {
  await apriCompleto(page);
  expect(await senzaNome(page)).toEqual([]);
  for (const nome of ["Annulla", "Ripeti"]) {
    const b = page.getByRole("button", { name: nome, exact: true });
    await expect(b).toHaveClass(/icon-only/);
    await expect(b.locator("svg.ico")).toHaveAttribute("aria-hidden", "true");
  }
  await page.locator(".w", { hasText: /^mamma$/ }).first().click({ position: { x: 20, y: 8 } });
  await page.locator(".pm-cell").first().waitFor();
  expect(await senzaNome(page)).toEqual([]);
  await documentiSalvati(page);
  await page.getByRole("button", { name: "Documenti" }).click();
  await page.locator(".docs-row").first().waitFor();
  expect(await senzaNome(page)).toEqual([]);
});

test("le icone stanno accanto al testo e il testo resta il nome del pulsante", async ({ page }) => {
  await apriCompleto(page);
  for (const nome of ["Documenti", "Nuovo", "Unisci", "Dividi", "Stampa…"]) {
    const b = page.getByRole("button", { name: nome, exact: true });
    await expect(b.locator("svg.ico")).toHaveCount(1);
    await expect(b.locator(".lbl")).toHaveText(nome);
  }
  // L'indicatore della biblioteca: icona e parola, mai solo colore.
  await expect(page.locator(".lib-status svg.ico")).toHaveCount(1);
  await expect(page.locator(".lib-status")).toHaveText("Biblioteca");
});

test("il suggerimento compare subito con la tastiera, con nome e scorciatoia, ed Esc lo chiude", async ({ page }) => {
  await apriCompleto(page);
  // Si arriva ad «Annulla» con la tastiera (dopo una modifica, così non è spento).
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("End");
  await page.keyboard.type("x");
  await page.keyboard.press("Shift");
  await page.getByRole("button", { name: "Annulla", exact: true }).evaluate((b: HTMLElement) => b.focus({ focusVisible: true } as FocusOptions));
  await expect(tip(page)).toBeVisible();
  await expect(tip(page)).toHaveText("Annulla · Ctrl+Z");
  await expect(page.getByRole("button", { name: "Annulla", exact: true })).toHaveAttribute("aria-describedby", "caa-tip");
  await expect(page.getByRole("button", { name: "Annulla", exact: true })).toHaveAttribute("aria-keyshortcuts", "Control+Z");
  await page.keyboard.press("Escape");
  await expect(tip(page)).toBeHidden();
  // Il suggerimento non esce dallo schermo.
  // «Altro» sta al bordo destro: il suggerimento deve restare dentro lo schermo.
  await page.getByRole("button", { name: "Altro", exact: true }).evaluate((b: HTMLElement) => b.focus({ focusVisible: true } as FocusOptions));
  const box = (await tip(page).boundingBox())!;
  const vw = page.viewportSize()!.width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vw);
});

test("con il mouse il suggerimento aspetta un attimo; sparisce uscendo o cliccando", async ({ page }) => {
  await apriCompleto(page);
  const stampa = page.getByRole("button", { name: "Stampa…" });
  await stampa.hover();
  await page.waitForTimeout(150);
  await expect(tip(page)).toBeHidden();
  await expect(tip(page)).toBeVisible({ timeout: 2000 });
  await expect(tip(page)).toHaveText("Stampa o salva in PDF · Ctrl+P");
  await page.mouse.move(5, 300);
  await expect(tip(page)).toBeHidden();
});

test("sul pulsante spento il suggerimento spiega perché (Unisci, Dividi)", async ({ page }) => {
  await apriCompleto(page);
  const unisci = page.getByRole("button", { name: "Unisci" });
  await expect(unisci).toBeDisabled();
  await unisci.hover({ force: true });
  await expect(tip(page)).toHaveText("Per unire, seleziona due o più parole della stessa frase", { timeout: 2000 });
  await page.mouse.move(5, 300);
  const dividi = page.getByRole("button", { name: "Dividi" });
  await expect(dividi).toBeDisabled();
  await dividi.hover({ force: true });
  await expect(tip(page)).toHaveText(/Per dividere, metti il cursore su un gruppo/, { timeout: 2000 });
});

test("un elemento con title usa lo stesso suggerimento, senza perdere il suo title", async ({ page }) => {
  await apriCompleto(page);
  await page.locator(".w", { hasText: /^mamma$/ }).first().click({ position: { x: 20, y: 8 } });
  const cella = page.locator(".pm-cell").first();
  await expect(cella).toHaveAttribute("title", "altro senso");
  await cella.hover();
  await expect(tip(page)).toHaveText("altro senso", { timeout: 2000 });
  await expect(cella).not.toHaveAttribute("title", /./); // mentre è aperto non c'è il suggerimento del browser
  await page.mouse.move(5, 300);
  await expect(cella).toHaveAttribute("title", "altro senso");
});

test("nessuna richiesta fuori da questo computer: icone e caratteri sono dentro il programma", async ({ page }) => {
  const fuori: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!["localhost", "127.0.0.1"].includes(u.hostname) && !["data:", "blob:"].includes(u.protocol)) fuori.push(r.url());
  });
  await apriCompleto(page);
  await page.locator(".w", { hasText: /^mamma$/ }).first().click({ position: { x: 20, y: 8 } });
  await page.locator(".pm-cell").first().waitFor();
  await documentiSalvati(page);
  await page.getByRole("button", { name: "Documenti" }).click();
  await page.locator(".docs-panel").getByRole("tab", { name: "Biblioteca", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Stampa…" }).click();
  await page.waitForTimeout(300);
  expect(fuori).toEqual([]);
});
