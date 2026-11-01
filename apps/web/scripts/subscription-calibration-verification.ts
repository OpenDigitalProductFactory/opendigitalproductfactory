/** Focused served regression in the disposable quota-verification runtime only. */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser } from "@playwright/test";
import type { PrismaClient } from "../../../packages/db/generated/client/client";
import { NAV_MODE_COOKIE } from "../lib/navigation/nav-mode";
import { waitForRouteDomToSettle } from "./ux-route-sweep";
import { assertProviderQuotaFixtureRuntime, resetProviderQuotaFixture, type ProviderQuotaFixture } from "./provider-quota-recovery-fixtures";

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

export async function verifySubscriptionCalibrationHistory({ browser, db, fixture, out, storageState, requestCount }: {
  browser: Browser; db: PrismaClient; fixture: ProviderQuotaFixture; out: string; storageState: string; requestCount: () => number;
}) {
  const runtime = assertProviderQuotaFixtureRuntime(process.env);
  check(runtime.runKey === fixture.runKey && runtime.sourceSha === fixture.sourceSha, "Calibration fixture runtime differs");
  const runId = fixture.prefix + "partial-history", modelRecordId = fixture.prefix + "discovered-model";
  const summary = "Six dimensions measured; conversational quality remains unverified.";
  const directory = resolve(out, "calibration-history"), captures: unknown[] = [];
  const write = (name: string, value: unknown) => writeFileSync(resolve(directory, name), JSON.stringify(value, null, 2));
  mkdirSync(directory, { recursive: true });
  write("execution.json", { status: "running", ...runtime, synthetic: true, realQualityMeasurement: "unrun" });
  let created = false;
  const before = requestCount();
  try {
    await resetProviderQuotaFixture(db, fixture, "active");
    await db.$transaction(async tx => {
      check(!await tx.endpointTestRun.count({ where: { runId } })
        && !await tx.discoveredModel.count({ where: { providerId: "chatgpt", modelId: fixture.modelId } }), "Calibration fixture identity collision");
      const changed = await tx.modelProfile.updateMany({ where: { providerId: "chatgpt", modelId: fixture.modelId, generatedBy: fixture.prefix },
        data: { profileSource: "evaluated", modelStatus: "retired", retiredAt: new Date(), retiredReason: "Non-routable synthetic UI fixture" } });
      check(changed.count === 1, "Calibration fixture does not own exactly one profile");
      await tx.endpointTestRun.create({ data: { id: runId, runId, endpointId: "chatgpt", modelId: fixture.modelId,
        triggeredBy: fixture.prefix, status: "incomplete", avgScore: null, completedAt: new Date(),
        results: { dimensions: [], summary, friendlyName: "Synthetic partial measurement history" } } });
      await tx.discoveredModel.create({ data: { id: modelRecordId, providerId: "chatgpt", modelId: fixture.modelId, rawMetadata: { fixture: fixture.prefix } } });
    });
    created = true;
    for (const layout of ["desktop", "mobile"] as const) for (const mode of ["operator", "worker"] as const)
      for (const theme of ["light", "dark"] as const) {
        const context = await browser.newContext({ storageState, colorScheme: theme,
          viewport: layout === "mobile" ? { width: 320, height: 900 } : { width: 1440, height: 1000 } });
        let blockedWrites = 0;
        try {
          await context.addCookies([{ name: NAV_MODE_COOKIE, value: mode, url: runtime.origin }]);
          // Reading history and opening client disclosures must not issue a server action.
          await context.route("**/*", async route => {
            if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) { blockedWrites++; await route.abort("blockedbyclient"); }
            else await route.continue();
          });
          const page = await context.newPage();
          await page.goto(runtime.origin + "/platform/ai/providers/chatgpt", { waitUntil: "domcontentloaded", timeout: 60_000 });
          await waitForRouteDomToSettle(page);
          const diagnostics = page.locator("details").filter({ has: page.locator(":scope > summary").filter({ hasText: /^Diagnostics/ }) });
          check(await diagnostics.count() === 1, "Provider diagnostics disclosure is missing or ambiguous");
          await diagnostics.locator(":scope > summary").click();
          await diagnostics.getByRole("button", { name: /^Test Runs(?:\s*\(\d+\))?$/ }).click();
          const history = diagnostics.locator("div.p-3.rounded-lg").filter({ has: page.getByText(runId, { exact: true }) });
          await history.waitFor({ state: "visible" });
          const text = await history.innerText();
          check(text.includes(summary) && text.includes("incomplete"), "Partial measurement history lost its truthful summary or state");
          check(!/Avg score:|Probes:|Scenarios:/.test(text), "Partial history invented an average or zero-count success");
          const slug = `${layout}-${mode}-${theme}`;
          const historyBytes = await history.screenshot({ path: resolve(directory, slug + "-history.png") });
          await page.getByRole("button", { name: "Models and execution", exact: true }).click();
          const search = page.getByPlaceholder("Search models...", { exact: true });
          await search.fill(fixture.modelId);
          const scores = page.getByRole("button", { name: /Routing Scores/ });
          check(await scores.count() === 1, "Synthetic model routing disclosure is missing or ambiguous");
          await scores.click();
          const label = page.getByText("Source: Measurements", { exact: true });
          await label.waitFor({ state: "visible" });
          const model = scores.locator("..").locator("..");
          check((await model.innerText()).includes(fixture.modelId), "Measurements label is not bound to the synthetic model");
          check(await model.getByRole("button", { name: /Run Eval/ }).count() === 0, "Retired fixture offers inference");
          const modelBytes = await model.screenshot({ path: resolve(directory, slug + "-model.png") });
          check(blockedWrites === 0 && requestCount() === before, "Read-only calibration inspection attempted a write or inference");
          const capture = { layout, mode, theme, sourceSha: runtime.sourceSha, status: "passed", text,
            history: { path: slug + "-history.png", sha256: createHash("sha256").update(historyBytes).digest("hex") },
            model: { path: slug + "-model.png", sha256: createHash("sha256").update(modelBytes).digest("hex"), ariaSnapshot: await model.ariaSnapshot() },
            checks: { partialSummary: true, noInventedAverage: true, noZeroCountSuccess: true, measurementsLabel: true, retiredNonRoutable: true, blockedWrites, providerRequests: requestCount() - before } };
          captures.push(capture); write(slug + ".json", capture);
        } finally { await context.close(); }
      }
  } catch (error) {
    write("execution.json", { status: "failed", ...runtime, completedCaptures: captures.length, synthetic: true, realQualityMeasurement: "unrun" });
    throw error;
  } finally {
    if (created) {
      const removed = await db.$transaction([
        db.endpointTestRun.deleteMany({ where: { id: runId, runId, triggeredBy: fixture.prefix } }),
        db.discoveredModel.deleteMany({ where: { id: modelRecordId, providerId: "chatgpt", modelId: fixture.modelId } }),
      ]);
      check(removed.every(value => value.count === 1), "Calibration fixture cleanup did not remove its exact owned rows");
    }
  }
  const completed = { status: "passed", ...runtime, captures, cleanup: "completed", synthetic: true, realQualityMeasurement: "unrun", providerRequests: requestCount() - before };
  write("execution.json", completed);
  return completed;
}
