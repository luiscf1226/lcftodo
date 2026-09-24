import { readFileSync } from "node:fs";
import { clerk } from "@clerk/testing/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { fmt, shiftDays, todayKey, weekStart } from "../src/lib/dates";
import { readRunState } from "./support/clerk";

/**
 * The core journey from issue #20: sign in → create team → create project → add todos →
 * change status → carry over → History → export CSV. Runs against the Convex DEV deployment
 * with a throwaway Clerk user created (and deleted) by the global setup/teardown.
 */

// The innermost element that holds a todo's title button also holds its status select.
function todoCard(scope: Locator, title: string) {
  return scope
    .locator("div")
    .filter({ has: scope.page().getByRole("button", { name: title, exact: true }) })
    .last();
}

// The first-run tutorial is a modal that can open on any /app page until it is completed.
async function autoDismissTutorial(page: Page) {
  await page.addLocatorHandler(page.getByRole("dialog", { name: "Primeros pasos" }), async (dialog) => {
    await dialog.getByRole("button", { name: "Cerrar" }).click();
  });
}

test("sign in, plan a week, carry over, review history and export CSV", async ({ page }) => {
  const { runId, email } = readRunState();
  const teamName = `E2E Team ${runId}`;
  const projectName = `E2E Project ${runId}`;
  const carried = `Write the spec ${runId}`;
  const finished = `Ship the build ${runId}`;

  // Monday of the current week is always on or before today, so it always offers "Carry",
  // and its next day (Tuesday) is in the same week.
  const monday = weekStart(todayKey());
  const tuesday = shiftDays(monday, 1);

  await autoDismissTutorial(page);
  // Surface client crashes (e.g. Convex auth errors) in the report instead of a generic error page.
  page.on("pageerror", (error) => console.error(`[browser] ${error.message}`));

  await test.step("sign in with a Clerk testing token", async () => {
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: email });
    await page.goto("/app");
  });

  await test.step("create a team", async () => {
    // The Clerk instance requires an organization, so a new user's session is pending and
    // the proxy sends them to /onboarding, which hosts Clerk's choose-organization task (#31).
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.getByRole("heading", { name: "Crea tu equipo" })).toBeVisible();
    await page.getByRole("textbox", { name: "Nombre del equipo" }).fill(teamName);
    await page.getByRole("button", { name: "Crear equipo" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByText(`${teamName} · resumen de esta semana`)).toBeVisible();
  });

  await test.step("create a project", async () => {
    await page.getByRole("link", { name: "Proyectos" }).first().click();
    await expect(page.getByRole("heading", { name: "Proyectos" })).toBeVisible();
    await page.getByRole("button", { name: "Nuevo proyecto" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Nuevo proyecto" });
    await dialog.getByLabel("Nombre").fill(projectName);
    await dialog.getByRole("button", { name: "Crear proyecto" }).click();
    await expect(page).toHaveURL(/\/app\/projects\/[^/?]+/);
    await expect(page.getByRole("heading", { name: projectName })).toBeVisible();
  });

  const mondayColumn = page.getByRole("region", { name: fmt(monday, "EEEE, MMMM d") });
  const tuesdayColumn = page.getByRole("region", { name: fmt(tuesday, "EEEE, MMMM d") });

  await test.step("add todos", async () => {
    await mondayColumn.getByRole("button", { name: "Añadir", exact: true }).click();
    const input = mondayColumn.getByPlaceholder(/nueva tarea/i);
    await input.fill(carried);
    await input.press("Enter");
    await expect(mondayColumn.getByRole("button", { name: carried, exact: true })).toBeVisible();
    await input.fill(finished);
    await input.press("Enter");
    await expect(mondayColumn.getByRole("button", { name: finished, exact: true })).toBeVisible();
    await input.press("Escape");
  });

  await test.step("change status", async () => {
    await todoCard(mondayColumn, carried).getByLabel("Estado").selectOption({ label: "En progreso" });
    await todoCard(mondayColumn, finished).getByLabel("Estado").selectOption({ label: "Hecho" });
    await expect(todoCard(mondayColumn, carried).getByLabel("Estado")).toHaveValue("doing");
    await expect(todoCard(mondayColumn, finished).getByLabel("Estado")).toHaveValue("done");
  });

  await test.step("carry over unfinished todos", async () => {
    await mondayColumn.getByRole("button", { name: "Pasar 1" }).click();
    await expect(todoCard(mondayColumn, carried).getByLabel("Estado")).toHaveValue("not_done");
    await expect(todoCard(mondayColumn, finished).getByLabel("Estado")).toHaveValue("done");
    const copy = todoCard(tuesdayColumn, carried);
    await expect(copy.getByLabel("Estado")).toHaveValue("doing");
    await expect(copy.getByText("pasada")).toBeVisible();
  });

  await test.step("review History", async () => {
    await page.getByRole("link", { name: "Historial" }).first().click();
    await expect(page.getByRole("heading", { name: "Historial" })).toBeVisible();
    await page.getByLabel("Proyecto", { exact: true }).selectOption({ label: projectName });
    const mondayRow = page.getByRole("button", { name: new RegExp(fmt(monday, "EEE, MMM d")) });
    await expect(mondayRow).toContainText("1/2");
    await mondayRow.click();
    await expect(page.getByText(carried, { exact: true })).toBeVisible();
    await expect(page.getByText(finished, { exact: true })).toBeVisible();
  });

  await test.step("export todos as CSV", async () => {
    await page.getByRole("button", { name: "Exportar" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Tareas (CSV)" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^todos_\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}\.csv$/);

    const csv = readFileSync(await download.path(), "utf8").replace(/^﻿/, "");
    const [header, ...rows] = csv.split("\r\n");
    expect(header).toBe("date,project,title,status,assignee,created_by,notes,completed_at,carried_over");
    const row = (title: string) => rows.find((r) => r.includes(`,${title},`));
    expect(row(carried)).toContain(`${monday},${projectName},${carried},Sin terminar,`);
    expect(row(finished)).toContain(`${monday},${projectName},${finished},Hecho,`);
  });
});
