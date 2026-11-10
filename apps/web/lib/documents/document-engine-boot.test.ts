import { describe, expect, it, vi } from "vitest";
import type { DoctoolsReconcilerOptions } from "@/lib/self-upgrade/doctools-release-image";
import { startDocumentEngineOnBoot } from "./document-engine-boot";

// BI-153EC72C + BI-903D22D0: at portal start the pin is reconciled and the
// rendition backfill is requested, and a later pin change asks again.
describe("startDocumentEngineOnBoot", () => {
  const image = `ghcr.io/o/dpf-doctools@sha256:${"a".repeat(64)}`;

  it("requests a backfill at portal start even when the converter was already available", async () => {
    const requestBackfill = vi.fn();
    const startReconciler = vi.fn(async (options: DoctoolsReconcilerOptions) => {
      options.onOutcome?.({ outcome: "unchanged", image, pulled: false }, "boot");
    });
    await startDocumentEngineOnBoot({ startReconciler, requestBackfill });
    expect(requestBackfill.mock.calls).toEqual([["portal-start"]]);
  });

  it("requests another backfill whenever the pin changes, at boot or on the timer", async () => {
    const requestBackfill = vi.fn();
    const startReconciler = vi.fn(async (options: DoctoolsReconcilerOptions) => {
      options.onOutcome?.({ outcome: "resolved", image, pulled: false }, "boot");
      options.onOutcome?.({ outcome: "built-locally", image }, "timer");
      options.onOutcome?.({ outcome: "unavailable", detail: "offline" }, "timer");
    });
    await startDocumentEngineOnBoot({ startReconciler, requestBackfill });
    expect(requestBackfill.mock.calls).toEqual([["portal-start"], ["release-change"], ["release-change"]]);
  });
});
