import { describe, expect, it, vi } from "vitest";

import {
  AI_CAPACITY_ISSUE_TYPE,
  AI_CAPACITY_PLATFORM_KEY,
  aiCapacityProviderKey,
  assessAiCapacity,
  classifyFailureCause,
  runAiCapacityWatch,
  type AiCapacityWatchDb,
  type CapacityProvider,
  type CapacityTelemetryRow,
} from "./ai-capacity-watch";

const NOW = new Date("2026-10-27T12:00:00.000Z");

function rows(
  providerId: string,
  count: number,
  status: string,
  extra: Partial<CapacityTelemetryRow> = {},
): CapacityTelemetryRow[] {
  return Array.from({ length: count }, (_, i) => ({
    providerId,
    status,
    errorClass: null,
    httpStatus: null,
    refusalReason: null,
    startedAt: new Date(NOW.getTime() - (i + 1) * 60_000),
    ...extra,
  }));
}

const providers: CapacityProvider[] = [
  { providerId: "anthropic", name: "Anthropic API", status: "active", capacity: null },
  { providerId: "anthropic-sub", name: "Claude subscription", status: "active", capacity: null },
  { providerId: "codex", name: "Codex", status: "active", capacity: null },
  { providerId: "xai", name: "xAI", status: "active", capacity: null },
  { providerId: "local", name: "Local engine", status: "active", capacity: null },
];

const spendLimit = {
  errorClass: "provider_error",
  httpStatus: 400,
  refusalReason:
    '{"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits."}}',
};

describe("classifyFailureCause", () => {
  it("names each cause class the 10-27 incident produced", () => {
    expect(classifyFailureCause(rows("anthropic", 1, "error", spendLimit)[0])).toBe("spend-limit");
    expect(
      classifyFailureCause(
        rows("xai", 1, "error", {
          errorClass: "auth",
          httpStatus: 401,
          refusalReason: '{"code":"unauthenticated:no-credentials","error":"No credentials presented."}',
        })[0],
      ),
    ).toBe("no-credentials");
    expect(
      classifyFailureCause(
        rows("local", 1, "error", {
          errorClass: "unknown",
          refusalReason: "inference admission timeout on local engine after 120000ms (origin=interactive, provider=local)",
        })[0],
      ),
    ).toBe("local-saturated");
    expect(
      classifyFailureCause(
        rows("chatgpt", 1, "error", {
          errorClass: "rate_limit",
          httpStatus: 429,
          refusalReason: '{"error":{"type":"usage_limit_reached","message":"The usage limit has been reached"}}',
        })[0],
      ),
    ).toBe("usage-limit");
    expect(
      classifyFailureCause(
        rows("anthropic-sub", 1, "error", {
          errorClass: "auth",
          refusalReason: "Auth error on OAuth provider anthropic-sub; token refresh failed",
        })[0],
      ),
    ).toBe("sign-in");
    expect(
      classifyFailureCause(
        rows("codex", 1, "error", {
          errorClass: "unknown",
          refusalReason: "Native CLI execution on codex did not return a settled result.",
        })[0],
      ),
    ).toBe("calls-failing");
  });
});

describe("assessAiCapacity", () => {
  it("measures the served share per provider and in total over the window", () => {
    const result = assessAiCapacity({
      rows: [
        ...rows("anthropic-sub", 8, "success"),
        ...rows("anthropic-sub", 2, "error"),
        ...rows("local", 3, "refusal"),
        ...rows("local", 1, "cancelled"),
      ],
      providers,
      now: NOW,
      previouslyOpen: new Set(),
    });
    expect(result.total).toEqual({ attempts: 13, served: 11, share: 11 / 13 });
    expect(result.providers.find((p) => p.providerId === "anthropic-sub")).toMatchObject({ attempts: 10, served: 8 });
    // cancelled is not a capacity outcome, so it is not counted.
    expect(result.providers.find((p) => p.providerId === "local")).toMatchObject({ attempts: 3, served: 3 });
    expect(result.findings).toEqual([]);
  });

  it("ignores telemetry older than the window", () => {
    const old = rows("anthropic", 10, "error", spendLimit).map((r) => ({
      ...r,
      startedAt: new Date(NOW.getTime() - 2 * 60 * 60_000),
    }));
    const result = assessAiCapacity({ rows: old, providers, now: NOW, previouslyOpen: new Set() });
    expect(result.total.attempts).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it("raises exactly one item for a provider that fails every call, naming cause and page", () => {
    const result = assessAiCapacity({
      rows: [...rows("anthropic", 12, "error", spendLimit), ...rows("anthropic-sub", 30, "success")],
      providers,
      now: NOW,
      previouslyOpen: new Set(),
    });
    expect(result.findings).toHaveLength(1);
    const [finding] = result.findings;
    expect(finding).toMatchObject({
      kind: "provider",
      issueKey: aiCapacityProviderKey("anthropic"),
      providerId: "anthropic",
      cause: "spend-limit",
      href: "/platform/ai/providers/anthropic",
    });
    expect(finding.title).toBe("Anthropic API has reached its spending limit");
    expect(finding.explanation).toContain("12");
  });

  it("does not raise for a provider with too few calls to judge", () => {
    const result = assessAiCapacity({
      rows: [...rows("xai", 3, "error", { httpStatus: 401, errorClass: "auth" }), ...rows("local", 20, "success")],
      providers,
      now: NOW,
      previouslyOpen: new Set(),
    });
    expect(result.findings).toEqual([]);
  });

  it("uses the recorded quota reset time for a usage limit", () => {
    const result = assessAiCapacity({
      rows: [...rows("codex", 6, "error", { refusalReason: "did not return a settled result" }), ...rows("local", 20, "success")],
      providers: providers.map((p) =>
        p.providerId === "codex"
          ? { ...p, capacity: { state: "quota_resets_at", retryAt: new Date("2026-10-27T15:30:00.000Z") } }
          : p,
      ),
      now: NOW,
      previouslyOpen: new Set(),
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ cause: "usage-limit", retryAtIso: "2026-10-27T15:30:00.000Z" });
    expect(result.findings[0].explanation).toContain("2026-10-27 15:30 UTC");
  });

  it("raises one platform-level item when total usable capacity collapses", () => {
    const result = assessAiCapacity({
      rows: [
        ...rows("anthropic", 20, "error", spendLimit),
        ...rows("xai", 6, "error", { httpStatus: 401, errorClass: "auth", refusalReason: "No credentials presented." }),
        ...rows("anthropic-sub", 4, "success"),
        ...rows("anthropic-sub", 2, "error"),
      ],
      providers,
      now: NOW,
      previouslyOpen: new Set(),
    });
    const platform = result.findings.filter((f) => f.kind === "platform");
    expect(platform).toHaveLength(1);
    expect(platform[0]).toMatchObject({ issueKey: AI_CAPACITY_PLATFORM_KEY, href: "/platform/ai/providers" });
    expect(platform[0].title).toBe("Only 13% of AI requests are succeeding");
    expect(platform[0].explanation).toContain("Anthropic API");
    expect(platform[0].explanation).toContain("xAI");
    // Plus one item per provider failing every call.
    expect(result.findings.filter((f) => f.kind === "provider").map((f) => f.providerId).sort()).toEqual([
      "anthropic",
      "xai",
    ]);
  });

  it("holds an open item when the provider got no calls this window (routing may have stopped sending)", () => {
    const result = assessAiCapacity({
      rows: rows("local", 20, "success"),
      providers,
      now: NOW,
      previouslyOpen: new Set([aiCapacityProviderKey("anthropic")]),
    });
    expect(result.findings).toEqual([]);
    expect(result.held).toEqual([aiCapacityProviderKey("anthropic")]);
  });

  it("does not hold an item for a provider the operator turned off", () => {
    const result = assessAiCapacity({
      rows: [],
      providers: providers.map((p) => (p.providerId === "anthropic" ? { ...p, status: "inactive" } : p)),
      now: NOW,
      previouslyOpen: new Set([aiCapacityProviderKey("anthropic"), AI_CAPACITY_PLATFORM_KEY]),
    });
    // Platform item is held while there is too little traffic to call it recovered.
    expect(result.held).toEqual([AI_CAPACITY_PLATFORM_KEY]);
  });
});

type IssueRow = { issueKey: string; status: string; issueType: string; summary?: string; details?: unknown };

function fakeDb(telemetry: CapacityTelemetryRow[], existing: IssueRow[] = []) {
  const issues = new Map(existing.map((row) => [row.issueKey, { ...row }]));
  const db: AiCapacityWatchDb = {
    adapterRunTelemetry: { findMany: vi.fn(async () => telemetry) },
    modelProvider: {
      findMany: vi.fn(async () => providers.map(({ providerId, name, status }) => ({ providerId, name, status }))),
    },
    providerCapacityStatus: { findMany: vi.fn(async () => []) },
    portfolioQualityIssue: {
      findMany: vi.fn(async (args: { where: { issueType: string; status: string } }) =>
        [...issues.values()]
          .filter((row) => row.issueType === args.where.issueType && row.status === args.where.status)
          .map((row) => ({ issueKey: row.issueKey })),
      ),
      upsert: vi.fn(async (args: { where: { issueKey: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const prior = issues.get(args.where.issueKey);
        issues.set(
          args.where.issueKey,
          prior ? { ...prior, ...(args.update as object), issueKey: args.where.issueKey } as IssueRow : (args.create as IssueRow),
        );
        return {};
      }),
      updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const notIn = (args.where.issueKey as { notIn?: string[] } | undefined)?.notIn ?? [];
        let count = 0;
        for (const row of issues.values()) {
          if (row.issueType !== args.where.issueType || row.status !== "open") continue;
          if (notIn.includes(row.issueKey)) continue;
          row.status = String(args.data.status);
          count++;
        }
        return { count };
      }),
    },
  };
  return { db, issues };
}

describe("runAiCapacityWatch", () => {
  it("opens one attention row for a total-failure provider and notifies once", async () => {
    const notify = vi.fn(async () => undefined);
    const { db, issues } = fakeDb([...rows("anthropic", 12, "error", spendLimit), ...rows("local", 30, "success")]);

    const first = await runAiCapacityWatch(db, { now: NOW, notify });
    expect(first).toMatchObject({ opened: 1, resolved: 0 });
    const open = [...issues.values()].filter((r) => r.status === "open");
    expect(open.map((r) => r.issueKey)).toEqual([aiCapacityProviderKey("anthropic")]);
    expect(open[0].issueType).toBe(AI_CAPACITY_ISSUE_TYPE);
    expect(notify).toHaveBeenCalledTimes(1);

    // Next cycle, same condition: the row is refreshed, never duplicated, and no second push.
    const second = await runAiCapacityWatch(db, { now: NOW, notify });
    expect(second.opened).toBe(0);
    expect([...issues.values()].filter((r) => r.status === "open")).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("clears the item itself once the provider serves calls again", async () => {
    const notify = vi.fn(async () => undefined);
    const { db, issues } = fakeDb(
      [...rows("anthropic", 3, "success"), ...rows("anthropic", 2, "error", spendLimit), ...rows("local", 30, "success")],
      [{ issueKey: aiCapacityProviderKey("anthropic"), status: "open", issueType: AI_CAPACITY_ISSUE_TYPE }],
    );
    const result = await runAiCapacityWatch(db, { now: NOW, notify });
    expect(result.resolved).toBe(1);
    expect(issues.get(aiCapacityProviderKey("anthropic"))?.status).toBe("resolved");
    expect(notify).not.toHaveBeenCalled();
  });

  it("records when the provider-credential lane already shows the provider, so Needs-you shows one item", async () => {
    const { db, issues } = fakeDb([
      ...rows("anthropic-sub", 6, "error", { errorClass: "auth", refusalReason: "token refresh failed" }),
      ...rows("local", 30, "success"),
    ]);
    await runAiCapacityWatch(db, { now: NOW, coveredByCredentialLane: new Set(["anthropic-sub"]) });
    const row = issues.get(aiCapacityProviderKey("anthropic-sub"));
    expect(row?.details).toMatchObject({ cause: "sign-in", credentialLaneCovers: true });
  });

  it("opens a platform-level row when total capacity collapses", async () => {
    const notify = vi.fn(async () => undefined);
    const { db, issues } = fakeDb([
      ...rows("anthropic", 20, "error", spendLimit),
      ...rows("anthropic-sub", 2, "success"),
      ...rows("anthropic-sub", 2, "error"),
    ]);
    await runAiCapacityWatch(db, { now: NOW, notify });
    expect(issues.get(AI_CAPACITY_PLATFORM_KEY)?.status).toBe("open");
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ itemKey: AI_CAPACITY_PLATFORM_KEY, deepLink: "/platform/ai/providers", riskClass: "high-risk" }),
    );
  });
});
