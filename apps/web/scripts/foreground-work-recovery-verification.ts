/** Actual portal/auth/queue/coworker/persistence; only the provider is synthetic. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Browser, type BrowserContext } from "@playwright/test";
import { isRecord } from "../lib/shared/coerce";
import { TERMINAL_TASK_STATE_LIST } from "../lib/tak/task-states";
import { FOREGROUND_WORK_EVENT } from "../lib/agent/foreground-work-contract";
import { assertForegroundFixtureRuntime, prepareForegroundFixtures, cleanupForegroundFixtures,
  assertForegroundBackgroundQuiet, hasSuccessfulForegroundReconciliation, waitForForegroundDelivery, startForegroundFixtureTransport, type ForegroundFixture } from "./foreground-work-recovery-fixtures";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = resolve(ROOT, "apps/web/test-results/foreground-work-recovery");
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const safeError = (error: unknown) => (error instanceof Error ? error.message : String(error))
  .replace(/postgres(?:ql)?:\/\/\S+/g, "[PRIVATE_DATABASE_URL]").replace(/https?:\/\/\S+/g, "[PRIVATE_URL]").slice(0, 1600);
const pause = (ms: number) => new Promise(resolveWait => setTimeout(resolveWait, ms));

export async function verifyForegroundRecovery() {
  const runtime = assertForegroundFixtureRuntime(process.env);
  check(execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() === runtime.sourceSha,
    "Declared source does not match the exact runtime checkout");
  mkdirSync(OUT, { recursive: true });
  const { prisma } = await import("@dpf/db");
  const modelId = runtime.runKey + "-model", answer = `Synthetic result ${runtime.runKey}: example checklist retained.`;
  const prompt = `Synthetic fixture ${runtime.runKey}. Return exactly: ${answer} Do not use tools, send mail, change settings or spend money.`;
  const transport = await startForegroundFixtureTransport({ modelId, marker: runtime.runKey, answer });
  let browser: Browser | undefined, context: BrowserContext | undefined;
  let fixture: ForegroundFixture | undefined, taskRunId: string | undefined;
  let unresolvedClientSubmissions = 0;
  let completed = false, failure: string | undefined, cleanup = "not-started";
  const evidence: Record<string, unknown> = { ...runtime, syntheticProvider: true, realProviderCapacity: "unrun", businessAcceptance: "unrun" };
  const snapshots: Array<Record<string, unknown>> = [];
  const write = () => writeFileSync(resolve(OUT, "execution.json"), JSON.stringify({ ...evidence,
    status: completed && !failure && cleanup === "completed" ? "passed" : failure ? "failed" : "running", failure, cleanup, snapshots,
    providerRequests: transport.counts() }, null, 2));
  try {
    write();
    const admission: unknown = JSON.parse(readFileSync(resolve(OUT, "target-admission.json"), "utf8"));
    check(isRecord(admission) && admission.sourceSha === runtime.sourceSha && admission.runKey === runtime.runKey
      && typeof admission.admittedAt === "string" && Number.isFinite(Date.parse(admission.admittedAt)), "Normal runtime has no matching isolation admission");
    const admittedAt = new Date(admission.admittedAt);
    evidence.targetAdmission = admission;
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ storageState: resolve(ROOT, "e2e/.auth/state.json"), viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const versionResponse = await context.request.get(runtime.origin + "/api/platform/version");
    check(versionResponse.ok(), "The served runtime version is unavailable");
    const version: unknown = await versionResponse.json();
    check(isRecord(version), "The served version is not a version record");
    check(version.gitSha === runtime.sourceSha, "Served source is absent or does not match this verification build");
    evidence.servedVersion = version;
    evidence.productionBuild = {
      buildId: readFileSync(resolve(ROOT, "apps/web/.next/BUILD_ID"), "utf8").trim(),
      sendRouteSha256: createHash("sha256").update(readFileSync(resolve(ROOT, "apps/web/.next/server/app/api/agent/send/route.js"))).digest("hex"),
      sourceBinding: "reported CI deployment source plus canonical production build, compiled route hash and observed matching served static bytes; no live-install or baked-image claim",
    };
    fixture = await prepareForegroundFixtures(prisma, transport.baseUrl);
    await page.goto(runtime.origin + "/workspace", { waitUntil: "domcontentloaded", timeout: 60_000 });
    const scriptPath = await page.locator('script[src^="/_next/static/"]').first().getAttribute("src");
    check(scriptPath, "The served page has no production static asset");
    const asset = new URL(scriptPath, runtime.origin), staticRoot = resolve(ROOT, "apps/web/.next/static");
    const assetFile = resolve(staticRoot, decodeURIComponent(asset.pathname.slice("/_next/static/".length)));
    check(asset.origin === runtime.origin && assetFile.startsWith(staticRoot + sep), "The served asset is outside this runtime build");
    const fetchedAsset = await context.request.get(asset.href);
    check(fetchedAsset.ok(), "The served production asset cannot be read");
    const assetHash = createHash("sha256").update(await fetchedAsset.body()).digest("hex");
    check(assetHash === createHash("sha256").update(readFileSync(assetFile)).digest("hex"), "Served static bytes differ from the declared build");
    evidence.servedAsset = { path: asset.pathname, sha256: assetHash };
    const open = page.getByRole("button", { name: "Open AI Coworker", exact: true });
    if (await open.isVisible()) await open.click();
    const panel = page.getByRole("complementary", { name: "AI coworker panel", exact: true });
    // Workspace can own an inline main-room panel rather than the docked shell.
    const composer = page.locator("textarea:visible").last();
    await composer.fill(prompt, { timeout: 45_000 });
    const acceptedResponse = page.waitForResponse(response => response.url().endsWith("/api/agent/send") && response.request().method() === "POST", { timeout: 45_000 });
    unresolvedClientSubmissions++;
    await page.getByRole("button", { name: "Send", exact: true }).last().click();
    const accepted = await acceptedResponse;
    check(await accepted.finished() === null, "The initial submission response did not settle");
    unresolvedClientSubmissions--;
    check(accepted.ok(), "The actual authenticated send route did not accept the fixture request");
    const receipt: unknown = await accepted.json(), requestData: unknown = accepted.request().postDataJSON();
    check(isRecord(receipt) && typeof receipt.taskRunId === "string" && typeof receipt.userMessageId === "string"
      && isRecord(requestData) && typeof requestData.threadId === "string" && typeof requestData.requestKey === "string", "Acceptance has no durable request/job identity");
    taskRunId = receipt.taskRunId;
    const eventIds = async () => (await prisma.jobEvent.findMany({ where: { name: FOREGROUND_WORK_EVENT,
      data: { path: ["taskRunId"], equals: taskRunId } }, select: { id: true } })).map(event => event.id);
    const duplicateSubmission = async () => {
      const beforeEventIds = await eventIds();
      unresolvedClientSubmissions++;
      const response = await context!.request.post(runtime.origin + "/api/agent/send", { data: requestData });
      unresolvedClientSubmissions--;
      check(response.ok(), "The authenticated duplicate request was refused unexpectedly");
      const repeated: unknown = await response.json();
      check(isRecord(repeated) && repeated.taskRunId === taskRunId && repeated.userMessageId === receipt.userMessageId,
        "Duplicate submission did not return the original saved identities");
      return waitForForegroundDelivery(prisma, { taskRunId: taskRunId!, beforeEventIds });
    };
    evidence.acceptance = { taskRunId, userMessageId: receipt.userMessageId, threadId: requestData.threadId, requestKey: requestData.requestKey,
      coworkerMode: requestData.coworkerMode ?? "advise" };
    const read = async () => {
      const row = await prisma.taskRun.findUniqueOrThrow({ where: { taskRunId: taskRunId! } });
      const progress = isRecord(row.progressPayload) ? row.progressPayload : {};
      const snapshot = { status: row.status, outcome: progress.foregroundOutcome ?? null, resultMessageId: progress.resultMessageId ?? null,
        resourceWait: progress.resourceWait ?? null };
      if (JSON.stringify(snapshots.at(-1)) !== JSON.stringify(snapshot)) { snapshots.push(snapshot); write(); }
      return { row, progress };
    };
    const until = async (predicate: (value: Awaited<ReturnType<typeof read>>) => boolean, timeoutMs: number) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const value = await read();
        if (predicate(value)) return value;
        if (["failed", "canceled", "cancelled"].includes(value.row.status)
          || value.progress.foregroundOutcome === "blocked" || value.progress.foregroundOutcome === "execution-uncertain")
          throw new Error(`Retained execution requires attention: ${String(value.progress.foregroundOutcome ?? value.row.status)} ${String(value.progress.summary ?? "")}`);
        await pause(1000);
      }
      throw new Error("The bounded retained-work verification window ended without its expected transition");
    };
    const waiting = await until(({ row, progress }) => row.status === "input-required" && isRecord(progress.resourceWait), 90_000);
    const originalMetadata = waiting.row.a2aMetadata;
    const savedRequest = await prisma.agentMessage.findUniqueOrThrow({ where: { id: receipt.userMessageId } });
    check(savedRequest.taskRunId === taskRunId && savedRequest.threadId === requestData.threadId && savedRequest.content === prompt,
      "The stored request is not associated with its acknowledged job");
    check(transport.counts().requests > 0, "No actual request reached the synthetic provider");
    evidence.waitingDuplicateDelivery = await duplicateSubmission();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText(prompt, { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    await page.screenshot({ path: resolve(OUT, "retained-capacity-wait.png"), fullPage: true });
    const reloaded = await read();
    check(reloaded.row.taskRunId === taskRunId && reloaded.row.status === "input-required", "Reload did not retain the same waiting job");
    const waitObservedAt = new Date();
    evidence.wait = { observedAt: waitObservedAt.toISOString(), progress: reloaded.progress, reloadRetained: true, duplicateRetained: true };
    transport.recover(); // No further client submission until the saved result exists.
    const result = await until(({ row, progress }) => row.status === "completed" && typeof progress.resultMessageId === "string", 7 * 60_000);
    check(JSON.stringify(result.row.a2aMetadata) === JSON.stringify(originalMetadata), "Recovery changed the original request authority or deadline");
    const message = await prisma.agentMessage.findUniqueOrThrow({ where: { id: String(result.progress.resultMessageId) } });
    const digest = createHash("sha256").update(message.content).digest("hex");
    check(message.role === "assistant" && message.taskRunId === taskRunId && message.threadId === savedRequest.threadId
      && message.providerId === fixture.providerId && message.modelId === fixture.modelId && message.content === answer,
      "The stored result does not match the original fixture request and provider");
    check(Boolean(message.responseAttemptId) && message.responseContentDigest === digest, "Stored response provenance is missing or does not match its bytes");
    check(await prisma.agentMessage.count({ where: { taskRunId, role: "user" } }) === 1
      && await prisma.agentMessage.count({ where: { taskRunId, role: "assistant" } }) === 1, "Recovery duplicated the user request or assistant result");
    const jobs = await prisma.jobRun.findMany({ where: { functionKey: "agent/foreground-work-run", event: { path: ["data", "taskRunId"], equals: taskRunId } },
      select: { id: true, status: true, createdAt: true, finishedAt: true, output: true } });
    const reconciliation = await prisma.jobRun.findMany({ where: { functionKey: "agent/task-dispatch", createdAt: { gte: waitObservedAt }, status: "completed" },
      select: { id: true, status: true, steps: { where: { stepKey: "reconcile-retained-foreground-work" }, select: { stepKey: true, output: true } } } });
    check(jobs.length >= 2 && jobs.some(job => job.status === "completed") && hasSuccessfulForegroundReconciliation(reconciliation),
      "The result has no actual owned-queue and recurring reconciliation evidence");
    const countBefore = transport.counts().requests;
    evidence.terminalDuplicateDelivery = await duplicateSubmission();
    check(transport.counts().requests === countBefore && await prisma.agentMessage.count({ where: { taskRunId, role: "assistant" } }) === 1,
      "Repeating a completed request executed inference or wrote another result");
    await assertForegroundBackgroundQuiet(prisma, [taskRunId]);
    check(await prisma.taskRun.count({ where: { createdAt: { gte: admittedAt }, taskRunId: { not: taskRunId } } }) === 0
      && await prisma.jobRun.count({ where: { createdAt: { gte: admittedAt }, functionKey: { notIn: ["agent/foreground-work-run", "agent/task-dispatch"] } } }) === 0
      && await prisma.jobEvent.count({ where: { name: FOREGROUND_WORK_EVENT, data: { path: ["taskRunId"], not: taskRunId } } }) === 0
      && transport.counts().rejected === 0, "Unrelated work was dispatched during the isolated scenario");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText(answer, { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    await page.screenshot({ path: resolve(OUT, "recovered-result.png"), fullPage: true });
    evidence.result = { taskRunId, messageId: message.id, contentDigest: digest, responseAttemptId: message.responseAttemptId,
      responseScope: message.responseScope, jobs, reconciliation, noResubmissionAfterCapacityReturn: true, duplicateResultStable: true };
    evidence.panelPresent = await panel.count();
    evidence.noUnrelatedDispatches = true;
    completed = true;
  } catch (error) { failure = safeError(error); throw error; }
  finally {
    try {
      if (fixture) {
        check(unresolvedClientSubmissions === 0, "Client submission outcome is unknown; preserve fixture state");
        const messages = await prisma.agentMessage.findMany({ where: { role: "user", content: prompt },
          select: { taskRunId: true, threadId: true }, take: 4 });
        check(messages.length <= 3, "Ambiguous fixture request ownership; preserve fixture state");
        const ownedIds = [...new Set([...(taskRunId ? [taskRunId] : []), ...messages.flatMap(message => message.taskRunId ? [message.taskRunId] : [])])];
        await assertForegroundBackgroundQuiet(prisma, ownedIds);
        const active = await prisma.taskRun.findMany({ where: { taskRunId: { in: ownedIds }, status: { notIn: [...TERMINAL_TASK_STATE_LIST] } },
          select: { threadId: true } });
        for (const threadId of new Set(active.flatMap(row => row.threadId ? [row.threadId] : []))) {
          check(context, "No authenticated owner context can cancel the unfinished fixture");
          const cancelled = await context.request.post(runtime.origin + "/api/agent/cancel", { data: { threadId } });
          check(cancelled.ok(), "The native owner cancellation did not succeed; preserve fixture state");
        }
        for (const id of ownedIds) await waitForForegroundDelivery(prisma, { taskRunId: id, requireSuccess: false });
        await cleanupForegroundFixtures(prisma, fixture, { taskRunIds: ownedIds, clientSubmissionsSettled: true });
      }
      cleanup = "completed";
    } catch (error) { cleanup = "unsettled-fixture-preserved"; failure = failure ?? safeError(error); }
    finally {
      const closed = await Promise.allSettled([context?.close(), browser?.close(), transport.close(), prisma.$disconnect()]);
      if (closed.some(value => value.status === "rejected")) { cleanup = "failed"; failure ??= "Fixture runtime resource cleanup failed"; }
      write();
    }
    if (failure) throw new Error(failure);
    if (cleanup !== "completed") throw new Error("Foreground fixture cleanup is incomplete");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyForegroundRecovery().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
}
