/** Focused served regression in the disposable quota-verification runtime only. */
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser } from "@playwright/test";
import type { PrismaClient } from "../../../packages/db/generated/client/client";
import { NAV_MODE_COOKIE } from "../lib/navigation/nav-mode";
import { waitForRouteDomToSettle } from "./ux-route-sweep";
import { assertProviderQuotaFixtureRuntime, resetProviderQuotaFixture, type ProviderQuotaFixture } from "./provider-quota-recovery-fixtures";
import { publicClientActionExport } from "./public-client-action-reference";

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

/** Resolve only a public client action proxy; never read server bundles/manifests. */
function publicActionReference(id: string | undefined) {
  if (!id || !/^[a-f0-9]{40,64}$/.test(id)) return null;
  const directory = resolve(dirname(fileURLToPath(import.meta.url)), "../.next/static/chunks");
  try {
    let bytes = 0;
    for (const file of readdirSync(directory, { recursive: true }).filter((entry): entry is string => typeof entry === "string" && entry.endsWith(".js")).slice(0, 2000)) {
      const path = resolve(directory, file), stat = lstatSync(path);
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024) continue;
      bytes += stat.size;
      if (bytes > 32 * 1024 * 1024) break;
      const content = readFileSync(path, "utf8"), index = content.indexOf(id);
      if (index < 0) continue;
      const tail = content.slice(index + id.length, index + id.length + 240);
      return { id, publicChunk: basename(file), publicProxyExportName: publicClientActionExport(content, id),
        candidateExportName: tail.match(/,\s*["']([A-Za-z_$][\w$]*)["']\s*\)/)?.[1] ?? null };
    }
  } catch { /* Missing public assets leave the diagnostic unknown, never permit a request. */ }
  return { id, publicChunk: null, publicProxyExportName: null, candidateExportName: null };
}

type BlockedRequest = { arrivalPhase: string; method: string; pathname: string; resourceType: string;
  action: ReturnType<typeof publicActionReference> };

/** A passing result is returned only after capture, context close and owned handlers settle. */
export async function finishCalibrationCapture<T>(input: {
  capture: () => Promise<T>; close: () => Promise<void>; settle: () => Promise<void>; verify: () => void;
}): Promise<T> {
  let capture: T;
  try { capture = await input.capture(); }
  finally { try { await input.close(); } finally { await input.settle(); } }
  input.verify();
  return capture;
}

export async function verifySubscriptionCalibrationHistory({ browser, db, fixture, out, storageState, requestCount }: {
  browser: Browser; db: PrismaClient; fixture: ProviderQuotaFixture; out: string; storageState: string; requestCount: () => number;
}) {
  const runtime = assertProviderQuotaFixtureRuntime(process.env);
  check(runtime.runKey === fixture.runKey && runtime.sourceSha === fixture.sourceSha, "Calibration fixture runtime differs");
  const runId = fixture.prefix + "partial-history", modelRecordId = fixture.prefix + "discovered-model";
  const summary = "Six dimensions measured; conversational quality remains unverified.";
  const directory = resolve(out, "calibration-history"), captures: unknown[] = [];
  const write = (name: string, value: unknown) => writeFileSync(resolve(directory, name), JSON.stringify(value, null, 2));
  const failedExecution = () => write("execution.json", { status: "failed", ...runtime,
    completedCaptures: captures.length, synthetic: true, realQualityMeasurement: "unrun" });
  mkdirSync(directory, { recursive: true });
  write("execution.json", { status: "running", ...runtime, synthetic: true, realQualityMeasurement: "unrun" });
  let created = false;
  const before = requestCount();
  try {
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
          let blockedWrites = 0, bootstrapBlockedWrites = 0, phase = "initial-render";
          let closing = false, contextClosed = false, guardFailed = false, caseFailed = false, interactionsStarted = false;
          let closeTask: Promise<void> | undefined;
          const pendingHandlers = new Set<Promise<void>>();
          const closeContext = () => closeTask ??= (async () => {
            phase = "context-close"; closing = true; await context.close(); contextClosed = true;
          })();
          const settleHandlers = async () => {
            phase = "handler-settlement";
            while (pendingHandlers.size) await Promise.all([...pendingHandlers]);
            check(!guardFailed, "Browser request guard did not settle cleanly; inspect request diagnostics");
          };
          let onBlockedRequest: (() => void) | undefined;
          const blockedRequests: BlockedRequest[] = [], slug = `${layout}-${mode}-${theme}`;
          const diagnostics = () => ({ layout, mode, theme, phase, sourceSha: runtime.sourceSha, blockedWrites,
            bootstrapBlockedWrites, interactionBlockedWrites: interactionsStarted ? blockedWrites - bootstrapBlockedWrites : null,
            contextClosed, pendingHandlers: pendingHandlers.size, guardFailed,
            blockedRequests, providerRequests: requestCount() - before, synthetic: true, realQualityMeasurement: "unrun" });
          try {
            await context.addCookies([{ name: NAV_MODE_COOKIE, value: mode, url: runtime.origin }]);
            // Abort every non-read request, including the global shell's thread bootstrap.
            await context.route("**/*", route => {
              const request = route.request();
              const nonRead = !["GET", "HEAD", "OPTIONS"].includes(request.method());
              let task: Promise<void>;
              task = (async () => {
              if (nonRead) {
                const identity = { arrivalPhase: phase, method: request.method(),
                  pathname: new URL(request.url()).pathname.slice(0, 240), resourceType: request.resourceType() };
                const actionId = request.headers()["next-action"];
                blockedWrites++;
                await route.abort("blockedbyclient");
                // No body, query, cookies or credential headers enter diagnostics.
                if (blockedRequests.length < 20) blockedRequests.push({ ...identity, action: publicActionReference(actionId) });
                onBlockedRequest?.();
              }
              else await route.continue();
              })().catch(() => { if (nonRead || !closing) guardFailed = true; })
                .finally(() => { pendingHandlers.delete(task); });
              pendingHandlers.add(task);
              return task;
            });
            const page = await context.newPage();
            await page.goto(runtime.origin + "/platform/ai/providers/chatgpt", { waitUntil: "domcontentloaded", timeout: 60_000 });
            await waitForRouteDomToSettle(page);
            // AgentCoworkerShell mounts this action and retries one aborted load after 2s.
            // Settle both blocked attempts before inspecting the unrelated provider controls.
            await new Promise<void>((resolveWait, reject) => {
              const timeout = setTimeout(() => reject(new Error("Blocked shell bootstrap did not settle; inspect request diagnostics")), 10_000);
              onBlockedRequest = () => { if (blockedRequests.length >= 2) { clearTimeout(timeout); resolveWait(); } };
              onBlockedRequest();
            }).finally(() => { onBlockedRequest = undefined; });
            check(blockedWrites === 2 && blockedRequests.length === 2 && blockedRequests.every(request =>
              request.arrivalPhase === "initial-render" && request.method === "POST" && request.resourceType === "fetch"
              && request.pathname === "/platform/ai/providers/chatgpt" && request.action?.publicChunk
              && request.action.publicProxyExportName === "getOrCreateThreadSnapshot"
              && request.action.id === blockedRequests[0]?.action?.id) && requestCount() === before,
            "Unexpected initial request or inference; inspect request diagnostics");
            bootstrapBlockedWrites = blockedWrites;
            check(await page.getByRole("dialog", { name: "AI coworker panel", exact: true }).count() === 0,
              "Coworker shell is open during provider inspection");
            interactionsStarted = true;
            phase = "history-disclosure";
            const disclosure = page.locator("details").filter({ has: page.locator(":scope > summary").filter({ hasText: /^Diagnostics/ }) });
            check(await disclosure.count() === 1, "Provider diagnostics disclosure is missing or ambiguous");
            await disclosure.locator(":scope > summary").waitFor({ state: "visible" });
            await disclosure.locator(":scope > summary").click();
            await disclosure.getByRole("button", { name: /^Test Runs(?:\s*\(\d+\))?$/ }).click();
            const history = disclosure.locator("div.p-3.rounded-lg").filter({ has: page.getByText(runId, { exact: true }) });
            await history.waitFor({ state: "visible" });
            const text = await history.innerText();
            check(text.includes(summary) && text.includes("incomplete"), "Partial measurement history lost its truthful summary or state");
            check(!/Avg score:|Probes:|Scenarios:/.test(text), "Partial history invented an average or zero-count success");
            const historyBytes = await history.screenshot({ path: resolve(directory, slug + "-history.png") });
            phase = "model-disclosure";
            await page.getByRole("button", { name: "Models and execution", exact: true }).click();
            const search = page.getByPlaceholder("Search models...", { exact: true });
            await search.fill(fixture.modelId);
            const scores = page.getByRole("button", { name: /Routing Scores/ });
            check(await scores.count() === 1, "Synthetic model routing disclosure is missing or ambiguous");
            const label = page.getByText("Source: Measurements", { exact: true });
            await label.waitFor({ state: "visible" });
            phase = "keyboard-close-open";
            await scores.focus(); await page.keyboard.press("Enter");
            await label.waitFor({ state: "hidden" });
            await page.keyboard.press("Enter");
            await label.waitFor({ state: "visible" });
            const model = scores.locator("..").locator("..");
            check((await model.innerText()).includes(fixture.modelId), "Measurements label is not bound to the synthetic model");
            check(await model.getByRole("button", { name: /Run Eval/ }).count() === 0, "Retired fixture offers inference");
            const modelBytes = await model.screenshot({ path: resolve(directory, slug + "-model.png") });
            check(await page.getByRole("dialog", { name: "AI coworker panel", exact: true }).count() === 0,
              "Provider interactions opened the coworker shell");
            const capture = await finishCalibrationCapture({ capture: async () => {
              phase = "final-snapshot";
              return { layout, mode, theme, sourceSha: runtime.sourceSha, status: "passed", text,
              history: { path: slug + "-history.png", sha256: createHash("sha256").update(historyBytes).digest("hex") },
              model: { path: slug + "-model.png", sha256: createHash("sha256").update(modelBytes).digest("hex"), ariaSnapshot: await model.ariaSnapshot() },
              checks: { partialSummary: true, noInventedAverage: true, noZeroCountSuccess: true, measurementsLabel: true,
                retiredNonRoutable: true, bootstrapBlockedWrites, blockedWrites: blockedWrites - bootstrapBlockedWrites, providerRequests: requestCount() - before } };
            }, close: closeContext, settle: settleHandlers, verify: () => {
              phase = "final-verification";
              check(contextClosed && pendingHandlers.size === 0 && blockedWrites === bootstrapBlockedWrites && requestCount() === before,
                `Read-only calibration interactions blocked ${blockedWrites - bootstrapBlockedWrites} additional writes; provider request delta ${requestCount() - before}; inspect request diagnostics`);
            } });
            phase = "complete";
            write(slug + "-requests.json", { status: "passed", ...diagnostics() });
            captures.push(capture); write(slug + ".json", capture);
          } catch (error) {
            caseFailed = true;
            throw error;
          } finally {
            try { if (!closeTask) { try { await closeContext(); } finally { await settleHandlers(); } } }
            catch (error) { caseFailed = true; throw error; }
            finally { if (caseFailed) write(slug + "-requests.json", { status: "failed", ...diagnostics() }); }
          }
        }
    } finally {
      if (created) {
        const removed = await db.$transaction([
          db.endpointTestRun.deleteMany({ where: { id: runId, runId, triggeredBy: fixture.prefix } }),
          db.discoveredModel.deleteMany({ where: { id: modelRecordId, providerId: "chatgpt", modelId: fixture.modelId } }),
        ]);
        check(removed.every(value => value.count === 1), "Calibration fixture cleanup did not remove its exact owned rows");
      }
    }
    check(requestCount() === before, "Calibration provider request count changed before final publication");
    const completed = { status: "passed", ...runtime, captures, cleanup: "completed", synthetic: true, realQualityMeasurement: "unrun", providerRequests: requestCount() - before };
    write("execution.json", completed);
    return completed;
  } catch (error) { failedExecution(); throw error; }
}
