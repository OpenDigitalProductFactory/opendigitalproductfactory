import { describe, expect, it, vi } from "vitest";
import type { InboundEcosystemItem } from "./inbound-issue-triage";
import {
  SECURITY_LIFECYCLE_ACTUATOR,
  reconcileSecurityLifecycle,
  type LifecycleItem,
  type SecurityLifecycleStore,
} from "./security-finding-lifecycle";

const marker = (kind: string, key: string) => `body\n\n[origin:ecosystem-${kind}:acme/widgets#${key}]`;
const row = (over: Partial<LifecycleItem> & Pick<LifecycleItem, "itemId">): LifecycleItem => ({
  id: `row-${over.itemId}`, status: "open", priority: null, activeBuildId: null, lastStatusActuator: null,
  body: marker("dependabot-package", "npm/undici"), ...over,
});
const group = (key: string, priority = 2, kind: InboundEcosystemItem["sourceKind"] = "dependabot-package"): InboundEcosystemItem => ({
  sourceKind: kind, sourceId: key, repository: "acme/widgets", state: "open", title: key, summary: key, priority,
  securityGroup: { alertNumbers: [1], highestSeverity: "high" },
});

function store(items: LifecycleItem[]): SecurityLifecycleStore & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = { evidence: [], transition: [], priority: [] };
  return {
    calls,
    findItems: vi.fn(async () => items),
    recordEvidence: vi.fn(async (...args: unknown[]) => { calls.evidence.push(args); }),
    transition: vi.fn(async (...args: unknown[]) => { calls.transition.push(args); return true; }),
    raisePriority: vi.fn(async (...args: unknown[]) => { calls.priority.push(args); }),
  };
}
const now = new Date("2026-11-13T18:00:00Z");

describe("security finding lifecycle (AC-4)", () => {
  it("records resolution evidence and hands a resolved group to the acceptance sweep", async () => {
    const s = store([row({ itemId: "BI-1", body: marker("dependabot-package", "npm/hono") })]);
    const result = await reconcileSecurityLifecycle({ completeKinds: ["dependabot-package"], groups: [group("npm/undici")], store: s, now });
    expect(result.resolved).toEqual(["BI-1"]);
    expect(s.calls.evidence[0][1]).toMatchObject({ summary: expect.stringContaining("no longer reports"), originId: "acme/widgets#npm/hono" });
    expect(s.calls.transition[0].slice(1, 3)).toEqual(["open", "awaiting-acceptance"]);
  });

  it("records evidence but does not move an item with an active build", async () => {
    const s = store([row({ itemId: "BI-2", activeBuildId: "fb", body: marker("dependabot-package", "npm/hono") })]);
    const result = await reconcileSecurityLifecycle({ completeKinds: ["dependabot-package"], groups: [], store: s, now });
    expect(result.resolved).toEqual([]);
    expect(result.heldByBuild).toEqual(["BI-2"]);
    expect(s.calls.evidence).toHaveLength(1);
    expect(s.calls.transition).toHaveLength(0);
  });

  it("returns an item this job moved to awaiting acceptance back to open when the alert reappears", async () => {
    const s = store([row({ itemId: "BI-3", status: "awaiting-acceptance", lastStatusActuator: SECURITY_LIFECYCLE_ACTUATOR })]);
    const result = await reconcileSecurityLifecycle({ completeKinds: ["dependabot-package"], groups: [group("npm/undici")], store: s, now });
    expect(result.reopened).toEqual(["BI-3"]);
    expect(s.calls.transition[0].slice(1, 3)).toEqual(["awaiting-acceptance", "open"]);
  });

  it("leaves an item a pull request moved to awaiting acceptance alone while its alert is still open", async () => {
    const s = store([row({ itemId: "BI-4", status: "awaiting-acceptance", lastStatusActuator: "pr-submit-awaiting-acceptance" })]);
    const result = await reconcileSecurityLifecycle({ completeKinds: ["dependabot-package"], groups: [group("npm/undici")], store: s, now });
    expect(result.reopened).toEqual([]);
    expect(s.calls.transition).toHaveLength(0);
  });

  it("reports a reappearance on a done item as a regression without writing a status", async () => {
    const s = store([row({ itemId: "BI-5", status: "done" })]);
    const result = await reconcileSecurityLifecycle({ completeKinds: ["dependabot-package"], groups: [group("npm/undici")], store: s, now });
    expect(result.regressions).toEqual(["BI-5"]);
    expect(s.calls.transition).toHaveLength(0);
  });
});

describe("priority (AC-3)", () => {
  it("raises an item's priority to its group's severity tier and never lowers it", async () => {
    const s = store([row({ itemId: "BI-6", priority: null }), row({ itemId: "BI-7", priority: 1, body: marker("code-scanning-rule", "js/x") })]);
    const result = await reconcileSecurityLifecycle({ completeKinds: ["dependabot-package", "code-scanning-rule"],
      groups: [group("npm/undici", 2), group("js/x", 3, "code-scanning-rule")], store: s, now });
    expect(result.reprioritized).toEqual(["BI-6"]);
    expect(s.calls.priority[0].slice(1, 3)).toEqual([null, 2]);
  });
});

describe("incomplete coverage moves nothing (AC-5)", () => {
  it("never resolves, reopens or reprioritises items of a surface that was not read completely", async () => {
    const s = store([row({ itemId: "BI-8", body: marker("secret-scanning-alert", "9") })]);
    const result = await reconcileSecurityLifecycle({ completeKinds: ["dependabot-package"], groups: [], store: s, now });
    expect(result.resolved).toEqual([]);
    expect(s.calls.evidence).toHaveLength(0);
    expect(s.calls.transition).toHaveLength(0);
  });

  it("does nothing at all when no surface was complete", async () => {
    const s = store([]);
    await reconcileSecurityLifecycle({ completeKinds: [], groups: [], store: s, now });
    expect(s.findItems).not.toHaveBeenCalled();
  });
});
