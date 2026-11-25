/** Authenticated served-route check, run only against the disposable UX CI seed. */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { readyToSwapBudgetMs } from "../lib/self-upgrade/ready-to-swap-window";

const route = "/ops/self-upgrade";
const origin = "http://localhost:3000";
const disclosure = "Refresh and review the new maintenance limit before installing.";

async function verify() {
  const runtime = process.env;
  if (runtime.GITHUB_ACTIONS !== "true" || runtime.DPF_UPGRADE_DEADLINE_SCENARIO_CI !== "1"
      || runtime.UX_SWEEP_BASE_URL !== origin
      || runtime.DATABASE_URL !== "postgresql://dpf:ci_test_password@localhost:5432/dpf"
      || !runtime.RUNNER_TEMP || !runtime.GITHUB_SHA) {
    throw new Error("This check requires the disposable authenticated UX CI seed.");
  }
  const checkout = resolve("../..");
  const git = (directory: string, ...args: string[]) =>
    execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" }).trim();
  if (git(checkout, "rev-parse", "HEAD") !== runtime.GITHUB_SHA) throw new Error("Wrong fixture source.");
  const host = join(runtime.RUNNER_TEMP, "dpf-ux-upgrade-deadline", "fixture-host");
  mkdirSync(host, { recursive: true });
  git(host, "init", "--initial-branch=main");
  git(host, "-c", "user.name=UX Fixture", "-c", "user.email=ux-fixture@example.invalid", "commit", "--allow-empty", "-m", "Synthetic upgrade target");
  git(host, "update-ref", "refs/remotes/origin/main", "HEAD");
  const { prisma } = await import("@dpf/db");
  const configKey = "self_upgrade", quiescenceKey = "portal.quiescence";
  const oldConfig = await prisma.platformConfig.findUnique({ where: { key: configKey } });
  const oldQuiescence = await prisma.platformConfig.findUnique({ where: { key: quiescenceKey } });
  const runId = "QR-ux-upgrade-deadline";
  const maximum = readyToSwapBudgetMs("paired-upgrade");
  const starts = await prisma.selfUpgradeRun.count();
  const browser = await chromium.launch();
  const context = await browser.newContext({
    storageState: join(checkout, "e2e/.auth/state.json"), viewport: { width: 390, height: 844 },
  });
  try {
    const updateConfig = async (key: string, value: Record<string, string | boolean>) =>
      prisma.platformConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
    await updateConfig(configKey, { enabled: true, hostSourceMountPath: host, repositoryRemote: "origin", repositoryBranch: "main", sourceMode: "local" });
    const page = await context.newPage();
    await page.goto(origin + route, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Install now" }).click();
    const confirm = page.getByRole("dialog", { name: "Install this platform update?" });
    await expect(confirm).toContainText(`up to ${maximum / 60_000} minutes`);
    await expect(confirm).toContainText("first waits for active work");

    // This served action intentionally receives only the stale value. Block
    // every other POST so this check cannot queue even a synthetic upgrade.
    let staleSent = false;
    await page.route("**/*", async (requestRoute) => {
      const request = requestRoute.request();
      if (request.method() !== "POST") return requestRoute.continue();
      const payload = request.postData() ?? "";
      const bound = `"confirmedReadyToSwapMaxMs":${maximum}`;
      if (new URL(request.url()).pathname !== route || !payload.includes(bound) || staleSent) return requestRoute.abort();
      staleSent = true;
      return requestRoute.continue({ postData: payload.replace(bound, `"confirmedReadyToSwapMaxMs":${maximum - 60_000}`) });
    });
    await confirm.getByRole("button", { name: "Install", exact: true }).click();
    await expect(page.getByText(disclosure)).toBeVisible();
    expect(staleSent).toBe(true);
    expect(await prisma.selfUpgradeRun.count()).toBe(starts);

    const now = new Date();
    const deadline = new Date(+now + maximum);
    await prisma.quiescenceRun.create({ data: {
      runId, trigger: "self-upgrade", triggerRefId: "SUR-not-a-real-upgrade", status: "ready-to-swap", budgetMs: 60 * 60_000,
      initialSnapshot: {}, enteredStateAt: { "ready-to-swap": now.toISOString() },
      readyToSwapBudgetMs: maximum, readyToSwapDeadlineAt: deadline,
    } });
    await updateConfig(quiescenceKey, { level: "draining", runId, enteredAt: now.toISOString() });
    const readDisplay = async () => {
      const response = await context.request.get(origin + "/api/internal/quiescence-state?display=1");
      return await response.json();
    };
    await expect.poll(readDisplay).toMatchObject({ runId, readyToSwapDeadlineAt: deadline.toISOString(), swapStarted: false });
    await page.reload({ waitUntil: "domcontentloaded" });
    const banner = page.locator("[data-overlay-banner]");
    await expect(banner).toContainText("Preparing recovery backups");
    await expect(banner.locator("time")).toHaveAttribute("datetime", deadline.toISOString());
    await prisma.quiescenceRun.update({ where: { runId }, data: { swapStartedAt: now } });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(banner).toContainText("Installing the platform update");
    await expect(banner.locator("time")).toHaveAttribute("datetime", deadline.toISOString());
    console.log("[upgrade-deadline] Confirmed maximum shown, stale admission refused, stored deadline and both phases rendered. No upgrade ran.");
  } finally {
    await browser.close();
    for (const [key, before] of [[configKey, oldConfig], [quiescenceKey, oldQuiescence]] as const) {
      if (before) await prisma.platformConfig.update({ where: { key }, data: { value: before.value as object } });
      else await prisma.platformConfig.deleteMany({ where: { key } });
    }
    await prisma.quiescenceRun.deleteMany({ where: { runId } });
    await prisma.$disconnect();
  }
}

void verify().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Upgrade deadline verification failed");
  process.exitCode = 1;
});
