import { describe, expect, it, vi } from "vitest";
import {
  describeDoctoolsReconcileOutcome,
  loadRunningReleaseContext,
  startDoctoolsReleaseImageReconciler,
  type DoctoolsReconcileOutcome,
} from "./doctools-release-image";

// BI-903D22D0: the pin must name the new release at boot, not 20 minutes later.
//
// promote.sh commits install-state.json (release-identity-commit) only AFTER the
// recreated portal is healthy and identity-verified. So the new portal's boot
// reconcile reads the PREVIOUS release's imageTag from install-state, finds it
// equal to the stored pin, and returns "unchanged" without a log line. The
// container's own DPF_IMAGE_TAG is the tag compose started it from.

const OLD_TAG = "v2026.09.26-office-engine.1";
const NEW_TAG = "v2026.09.26-pdf-text-rendition.1";

const installState = (imageTag: string) =>
  JSON.stringify({ installMode: "consumer", imageTag, installPath: "/workspace", composeFiles: ["docker-compose.yml", "docker-compose.release.yml"] });

const readText = (state: string) => async (path: string) => {
  if (path === "/dpf-state/install-state.json") return state;
  throw new Error(`ENOENT ${path}`);
};

describe("loadRunningReleaseContext (BI-903D22D0)", () => {
  it("names the RUNNING release while install-state still records the previous one", async () => {
    const context = await loadRunningReleaseContext({
      hostSourcePath: "/host-dpf",
      env: { DPF_IMAGE_TAG: NEW_TAG, GHCR_OWNER: "opendigitalproductfactory" },
      readText: readText(installState(OLD_TAG)),
    });
    expect(context?.imageTag).toBe(NEW_TAG);
  });

  it("keeps install-state's tag when the container carries no immutable tag", async () => {
    for (const DPF_IMAGE_TAG of [undefined, "", "latest"]) {
      const context = await loadRunningReleaseContext({
        hostSourcePath: "/host-dpf",
        env: { DPF_IMAGE_TAG, GHCR_OWNER: "opendigitalproductfactory" },
        readText: readText(installState(OLD_TAG)),
      });
      expect(context?.imageTag).toBe(OLD_TAG);
    }
  });

  it("is still null on an install that is not a release install", async () => {
    const context = await loadRunningReleaseContext({
      hostSourcePath: "/host-dpf",
      env: { DPF_IMAGE_TAG: NEW_TAG, GHCR_OWNER: "opendigitalproductfactory" },
      readText: async () => {
        throw new Error("ENOENT");
      },
    });
    expect(context).toBeNull();
  });
});

describe("startDoctoolsReleaseImageReconciler (BI-903D22D0)", () => {
  const resolved: DoctoolsReconcileOutcome = { outcome: "resolved", image: "ghcr.io/o/dpf-doctools@sha256:" + "a".repeat(64), pulled: false };

  it("runs at boot, logs the boot outcome even when nothing changed, and reports each outcome with its trigger", async () => {
    const outcomes: DoctoolsReconcileOutcome[] = [{ outcome: "unchanged", image: resolved.image, pulled: false }, resolved];
    const run = vi.fn(async () => outcomes.shift()!);
    const logger = { log: vi.fn(), warn: vi.fn() };
    const onOutcome = vi.fn();
    let tick: (() => void) | undefined;
    const setTimer = vi.fn((fn: () => void) => {
      tick = fn;
      return { unref() {} };
    });

    await startDoctoolsReleaseImageReconciler({ run, logger, onOutcome, setInterval: setTimer as never, env: {} });
    expect(run).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith(expect.stringMatching(/^\[doctools-image\] boot: pin unchanged/));
    expect(onOutcome).toHaveBeenCalledWith(expect.objectContaining({ outcome: "unchanged" }), "boot");

    tick!();
    await vi.waitFor(() => expect(onOutcome).toHaveBeenCalledWith(resolved, "timer"));
  });

  it("does nothing in the edge runtime", async () => {
    const run = vi.fn();
    await startDoctoolsReleaseImageReconciler({ run, env: { NEXT_RUNTIME: "edge" } });
    expect(run).not.toHaveBeenCalled();
  });

  it("describes every outcome in one line", () => {
    expect(describeDoctoolsReconcileOutcome({ outcome: "not-release-install" })).toMatch(/not a release install/);
    expect(describeDoctoolsReconcileOutcome(resolved)).toContain(resolved.image);
    expect(describeDoctoolsReconcileOutcome({ outcome: "error", detail: "db down" })).toContain("db down");
  });
});
