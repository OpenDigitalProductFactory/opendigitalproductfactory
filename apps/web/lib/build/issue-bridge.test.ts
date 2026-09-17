import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB layer before importing anything that uses it.
vi.mock("@dpf/db", () => ({
  prisma: {
    platformDevConfig: { findUnique: vi.fn() },
    backlogItem: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    epic: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    platformIssueReport: { findUnique: vi.fn(), update: vi.fn() },
    credentialEntry: { findUnique: vi.fn() },
  },
}));

// Fix the pseudonym so tests are deterministic.
vi.mock("./identity-privacy", async () => {
  const actual = await vi.importActual<typeof import("./identity-privacy")>(
    "./identity-privacy",
  );
  return {
    ...actual,
    getPlatformIdentity: vi.fn(async () => ({
      authorName: "dpf-agent-a1b2c3d4",
      authorEmail: "agent-a1b2c3d4e5f67890@hive.dpf",
      clientId: "b8f3c1a2-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
      shortId: "a1b2c3d4",
      dcoSignoff:
        "Signed-off-by: dpf-agent-a1b2c3d4 <agent-a1b2c3d4e5f67890@hive.dpf>",
    })),
    resolveHiveToken: vi.fn(async () => "ghp_testtoken"),
  };
});

import { prisma } from "@dpf/db";
import {
  buildIssueBody,
  buildIssueTitle,
  parseGitHubRepo,
  escalateToUpstreamIssue,
  buildClosureComment,
  closeReasonForStatus,
  closeUpstreamIssueForTerminal,
  isUpstreamClosureCandidate,
  sweepUpstreamIssueClosures,
} from "./issue-bridge";

const mockBacklogFind = vi.mocked(prisma.backlogItem.findUnique);
const mockBacklogUpdate = vi.mocked(prisma.backlogItem.update);
const mockEpicFind = vi.mocked(prisma.epic.findUnique);
const mockIssueReportFind = vi.mocked(prisma.platformIssueReport.findUnique);
const mockConfigFind = vi.mocked(prisma.platformDevConfig.findUnique);

const PSEUDONYM = "dpf-agent-a1b2c3d4";

/** A successful fetch response carrying a JSON body — the one place the mock shape is spelled out. */
function jsonResponse(status: number, body: unknown) {
  return { ok: true, status, headers: { get: () => null }, json: async () => body };
}

function seededConfig(
  overrides: Partial<{ contributionMode: string; upstreamRemoteUrl: string | null }> = {},
) {
  return {
    contributionMode: "selective",
    upstreamRemoteUrl: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git",
    ...overrides,
  } as Awaited<ReturnType<typeof prisma.platformDevConfig.findUnique>>;
}

// ─── Pure helpers ───────────────────────────────────────────────────────────

describe("parseGitHubRepo", () => {
  it("parses https URLs", () => {
    expect(parseGitHubRepo("https://github.com/owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses SSH URLs", () => {
    expect(parseGitHubRepo("git@github.com:owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("returns null for non-GitHub URLs", () => {
    expect(parseGitHubRepo("https://example.com/owner/repo.git")).toBeNull();
    expect(parseGitHubRepo("gibberish")).toBeNull();
  });
});

describe("buildIssueTitle", () => {
  it("prefixes the pseudonym", () => {
    expect(buildIssueTitle(PSEUDONYM, "Button has wrong color")).toBe(
      `[${PSEUDONYM}] Button has wrong color`,
    );
  });

  it("truncates overly long titles to fit the GitHub 256-char limit", () => {
    const longTitle = "x".repeat(500);
    const result = buildIssueTitle(PSEUDONYM, longTitle);
    expect(result.length).toBeLessThanOrEqual(256);
    expect(result).toMatch(/\.\.\.$/);
    expect(result.startsWith(`[${PSEUDONYM}] `)).toBe(true);
  });

  it("redacts hostnames in the title", () => {
    expect(buildIssueTitle(PSEUDONYM, "crash on DESKTOP-ABC123")).toContain(
      "[redacted]",
    );
  });
});

describe("buildIssueBody", () => {
  const baseSource = {
    title: "Button misaligned",
    body: "The submit button shifts 3px on hover",
    severity: null,
    routeContext: null,
    errorStack: null,
    userAgent: null,
    humanId: "BL-001",
    upstreamIssueNumber: null,
  };

  it("includes the pseudonym in the reported-by block", () => {
    const body = buildIssueBody({
      kind: "backlog",
      pseudonym: PSEUDONYM,
      source: baseSource,
    });
    expect(body).toContain(`Install: \`${PSEUDONYM}\``);
  });

  it("includes the local humanId for operator back-reference", () => {
    const body = buildIssueBody({
      kind: "backlog",
      pseudonym: PSEUDONYM,
      source: baseSource,
    });
    expect(body).toContain("BL-001");
  });

  it("includes the details section when body is present", () => {
    const body = buildIssueBody({
      kind: "backlog",
      pseudonym: PSEUDONYM,
      source: baseSource,
    });
    expect(body).toMatch(/## Details\n.*submit button shifts/);
  });

  it("omits the details section when body is null", () => {
    const body = buildIssueBody({
      kind: "backlog",
      pseudonym: PSEUDONYM,
      source: { ...baseSource, body: null },
    });
    expect(body).not.toContain("## Details");
  });

  it("includes the error-context block only for issue-report kind", () => {
    const withStack = {
      ...baseSource,
      severity: "high",
      errorStack: "TypeError: cannot read property x of undefined\n  at handler",
      userAgent: "Mozilla/5.0",
    };

    const reportBody = buildIssueBody({
      kind: "issue-report",
      pseudonym: PSEUDONYM,
      source: withStack,
    });
    expect(reportBody).toContain("## Error context");
    expect(reportBody).toContain("TypeError");
    expect(reportBody).toContain("User agent: `Mozilla/5.0`");

    const backlogBody = buildIssueBody({
      kind: "backlog",
      pseudonym: PSEUDONYM,
      source: withStack,
    });
    expect(backlogBody).not.toContain("## Error context");
  });

  it("redacts hostnames from body and errorStack", () => {
    const body = buildIssueBody({
      kind: "issue-report",
      pseudonym: PSEUDONYM,
      source: {
        ...baseSource,
        severity: "critical",
        body: "error on LAPTOP-XYZ99",
        errorStack: "Error thrown from DESKTOP-ABC123",
      },
    });
    expect(body).not.toContain("LAPTOP-XYZ99");
    expect(body).not.toContain("DESKTOP-ABC123");
    expect(body).toContain("[redacted]");
  });

  it("encodes severity and routeContext in the Type line", () => {
    const body = buildIssueBody({
      kind: "issue-report",
      pseudonym: PSEUDONYM,
      source: {
        ...baseSource,
        severity: "high",
        routeContext: "/admin/backlog",
      },
    });
    expect(body).toMatch(/severity: high/);
    expect(body).toMatch(/route: \/admin\/backlog/);
  });
});

// ─── escalateToUpstreamIssue orchestrator ────────────────────────────────────

describe("escalateToUpstreamIssue", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("skips cleanly in fork_only mode without calling GitHub", async () => {
    mockBacklogFind.mockResolvedValue({
      itemId: "BL-1",
      title: "t",
      body: null,
      upstreamIssueNumber: null,
    } as never);
    mockConfigFind.mockResolvedValue(
      seededConfig({ contributionMode: "fork_only" }),
    );

    const result = await escalateToUpstreamIssue({ kind: "backlog", id: "cuid1" });

    expect(result).toEqual({
      status: "skipped",
      reason: expect.stringContaining("private"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips if the item is already escalated", async () => {
    mockBacklogFind.mockResolvedValue({
      itemId: "BL-1",
      title: "t",
      body: null,
      upstreamIssueNumber: 42,
    } as never);

    const result = await escalateToUpstreamIssue({ kind: "backlog", id: "cuid1" });

    expect(result).toEqual({
      status: "skipped",
      reason: expect.stringContaining("already escalated"),
    });
    // Should short-circuit before reading config.
    expect(mockConfigFind).not.toHaveBeenCalled();
  });

  it("returns failed when source row is not found", async () => {
    mockEpicFind.mockResolvedValue(null);
    const result = await escalateToUpstreamIssue({ kind: "epic", id: "missing" });
    expect(result).toEqual({
      status: "failed",
      error: expect.stringMatching(/not found/),
    });
  });

  it("skips if upstreamRemoteUrl is missing", async () => {
    mockBacklogFind.mockResolvedValue({
      itemId: "BL-1",
      title: "t",
      body: null,
      upstreamIssueNumber: null,
    } as never);
    mockConfigFind.mockResolvedValue(
      seededConfig({ upstreamRemoteUrl: null }),
    );

    const result = await escalateToUpstreamIssue({ kind: "backlog", id: "cuid1" });

    expect(result).toEqual({
      status: "skipped",
      reason: expect.stringContaining("upstreamRemoteUrl"),
    });
  });

  it("creates an issue and persists the link on success", async () => {
    mockBacklogFind.mockResolvedValue({
      itemId: "BL-42",
      title: "Add dark mode toggle",
      body: "Users asked for a dark mode",
      upstreamIssueNumber: null,
    } as never);
    mockConfigFind.mockResolvedValue(seededConfig());
    mockBacklogUpdate.mockResolvedValue({} as never);

    fetchMock.mockResolvedValue(jsonResponse(201, {
      number: 123,
      html_url: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues/123",
    }));

    const result = await escalateToUpstreamIssue({ kind: "backlog", id: "cuid-42" });

    expect(result).toEqual({
      status: "created",
      issueNumber: 123,
      url: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues/123",
    });

    // Verify GitHub API call shape.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://api.github.com/repos/OpenDigitalProductFactory/opendigitalproductfactory/issues",
    );
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer ghp_testtoken");
    const sentBody = JSON.parse(init.body);
    expect(sentBody.title).toContain(PSEUDONYM);
    expect(sentBody.labels).toContain("hive:submitted");
    expect(sentBody.labels).toContain("hive:backlog-item");

    // Verify persistence — row linked to issue #123.
    expect(mockBacklogUpdate).toHaveBeenCalledWith({
      where: { id: "cuid-42" },
      data: expect.objectContaining({
        upstreamIssueNumber: 123,
        upstreamIssueUrl: expect.stringContaining("/issues/123"),
        upstreamSyncedAt: expect.any(Date),
      }),
    });
  });

  it("returns failed on GitHub API error without persisting a link", async () => {
    mockBacklogFind.mockResolvedValue({
      itemId: "BL-1",
      title: "t",
      body: null,
      upstreamIssueNumber: null,
    } as never);
    mockConfigFind.mockResolvedValue(seededConfig());

    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: "Bad credentials" }),
    });

    const result = await escalateToUpstreamIssue({ kind: "backlog", id: "cuid1" });

    expect(result).toEqual({
      status: "failed",
      error: expect.stringContaining("Bad credentials"),
    });
    expect(mockBacklogUpdate).not.toHaveBeenCalled();
  });

  it("returns failed when fetch throws (network error)", async () => {
    mockBacklogFind.mockResolvedValue({
      itemId: "BL-1",
      title: "t",
      body: null,
      upstreamIssueNumber: null,
    } as never);
    mockConfigFind.mockResolvedValue(seededConfig());

    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await escalateToUpstreamIssue({ kind: "backlog", id: "cuid1" });

    expect(result).toEqual({
      status: "failed",
      error: expect.stringContaining("Network error"),
    });
  });

  it("escalates an issue-report with error-stack context", async () => {
    mockIssueReportFind.mockResolvedValue({
      reportId: "IR-9",
      title: "500 on save",
      description: "Clicking save returns 500",
      severity: "critical",
      routeContext: "/api/save",
      errorStack: "Error: unhandled at handler()",
      userAgent: "Mozilla/5.0",
      upstreamIssueNumber: null,
    } as never);
    mockConfigFind.mockResolvedValue(seededConfig());
    vi.mocked(prisma.platformIssueReport.update).mockResolvedValue({} as never);

    fetchMock.mockResolvedValue(jsonResponse(201, {
      number: 501,
      html_url: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues/501",
    }));

    const result = await escalateToUpstreamIssue({
      kind: "issue-report",
      id: "cuid-ir-9",
    });

    expect(result.status).toBe("created");
    const sentBody = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(sentBody.body).toContain("## Error context");
    expect(sentBody.body).toContain("Error: unhandled");
    expect(sentBody.labels).toContain("severity:critical");
  });
});


// ─── Terminal closure (BI-AE9FCB4C) ─────────────────────────────────────────

const T0 = new Date("2026-09-01T00:00:00Z");
const T1 = new Date("2026-09-10T00:00:00Z");

function terminalRow(overrides: Partial<Parameters<typeof isUpstreamClosureCandidate>[0]> = {}) {
  return {
    id: "cuid-9",
    humanId: "BI-0996913C",
    status: "retired",
    triageOutcome: "discard",
    resolution: "Delivered on main by PRs #4571 and #4603.",
    completedAt: T1,
    upstreamIssueNumber: 4496,
    upstreamSyncedAt: T0,
    ...overrides,
  };
}

describe("isUpstreamClosureCandidate", () => {
  it("selects a terminal row whose mirror was last synced before it completed", () => {
    expect(isUpstreamClosureCandidate(terminalRow())).toBe(true);
    expect(isUpstreamClosureCandidate(terminalRow({ status: "done" }))).toBe(true);
    expect(isUpstreamClosureCandidate(terminalRow({ upstreamSyncedAt: null }))).toBe(true);
  });

  it("ignores rows that are open, deferred, unmirrored, unanchored, or already synced", () => {
    expect(isUpstreamClosureCandidate(terminalRow({ status: "deferred" }))).toBe(false);
    expect(isUpstreamClosureCandidate(terminalRow({ status: "open" }))).toBe(false);
    expect(isUpstreamClosureCandidate(terminalRow({ upstreamIssueNumber: null }))).toBe(false);
    expect(isUpstreamClosureCandidate(terminalRow({ completedAt: null }))).toBe(false);
    expect(isUpstreamClosureCandidate(terminalRow({ upstreamSyncedAt: new Date("2026-09-11T00:00:00Z") }))).toBe(false);
  });
});

describe("closeReasonForStatus / buildClosureComment", () => {
  it("maps done to completed and retired to not_planned", () => {
    expect(closeReasonForStatus("done")).toBe("completed");
    expect(closeReasonForStatus("retired")).toBe("not_planned");
  });

  it("quotes the redacted resolution and names the local reference", () => {
    const text = buildClosureComment(terminalRow({ resolution: "Fixed on DESKTOP-AB12CD by hand." }));
    expect(text).toContain("`BI-0996913C` was retired (discard)");
    expect(text).toContain("> Fixed on");
    expect(text).not.toContain("DESKTOP-AB12CD");
  });

  it("omits the resolution block when there is none", () => {
    const text = buildClosureComment(terminalRow({ status: "done", resolution: null }));
    expect(text).toContain("was completed on the filing install");
    expect(text).not.toContain("Resolution recorded");
  });
});

describe("closeUpstreamIssueForTerminal", () => {
  const fetchMock = vi.fn();
  const issueJson = (state: string) => ({ number: 4496, html_url: "https://github.com/o/r/issues/4496", state });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("comments with the resolution, closes with the status reason, and stamps the sync time", async () => {
    mockBacklogFind.mockResolvedValue({ ...terminalRow(), itemId: "BI-0996913C" } as never);
    mockConfigFind.mockResolvedValue(seededConfig());
    mockBacklogUpdate.mockResolvedValue({} as never);
    fetchMock.mockImplementation(async (_url: string, init: { method?: string }) =>
      init.method === "POST" ? jsonResponse(201, { id: 1 }) : jsonResponse(200, issueJson(init.method === "PATCH" ? "closed" : "open")),
    );

    const result = await closeUpstreamIssueForTerminal({ kind: "backlog", id: "cuid-9" });

    expect(result).toEqual({ status: "closed", issueNumber: 4496, outcome: "closed" });
    const methods = fetchMock.mock.calls.map(([, init]) => init.method);
    expect(methods).toEqual(["GET", "POST", "PATCH"]);
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).body).toContain("Delivered on main by PRs #4571");
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body)).toEqual({ state: "closed", state_reason: "not_planned" });
    expect(mockBacklogUpdate).toHaveBeenCalledWith({
      where: { id: "cuid-9" },
      data: { upstreamSyncedAt: expect.any(Date) },
    });
  });

  it("skips a row that is not a candidate without touching GitHub", async () => {
    mockBacklogFind.mockResolvedValue({ ...terminalRow({ status: "deferred" }), itemId: "BI-0996913C" } as never);
    const result = await closeUpstreamIssueForTerminal({ kind: "backlog", id: "cuid-9" });
    expect(result.status).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockBacklogUpdate).not.toHaveBeenCalled();
  });

  it("skips on a private install", async () => {
    mockBacklogFind.mockResolvedValue({ ...terminalRow(), itemId: "BI-0996913C" } as never);
    mockConfigFind.mockResolvedValue(seededConfig({ contributionMode: "fork_only" }));
    const result = await closeUpstreamIssueForTerminal({ kind: "backlog", id: "cuid-9" });
    expect(result).toMatchObject({ status: "skipped", reason: expect.stringContaining("private") });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves the row unsynced when GitHub fails, so the sweep retries it", async () => {
    mockBacklogFind.mockResolvedValue({ ...terminalRow(), itemId: "BI-0996913C" } as never);
    mockConfigFind.mockResolvedValue(seededConfig());
    fetchMock.mockResolvedValue({ ok: false, status: 502, headers: { get: () => null }, json: async () => ({ message: "Bad gateway" }) });
    const result = await closeUpstreamIssueForTerminal({ kind: "backlog", id: "cuid-9" });
    expect(result).toMatchObject({ status: "failed", error: expect.stringContaining("Bad gateway") });
    expect(mockBacklogUpdate).not.toHaveBeenCalled();
  });

  it("closes an epic mirror with the completed reason", async () => {
    mockEpicFind.mockResolvedValue({
      id: "epic-1", epicId: "EP-5102F494", status: "done", completedAt: T1, upstreamIssueNumber: 4549, upstreamSyncedAt: T0,
    } as never);
    mockConfigFind.mockResolvedValue(seededConfig());
    vi.mocked(prisma.epic.update).mockResolvedValue({} as never);
    fetchMock.mockImplementation(async (_url: string, init: { method?: string }) =>
      jsonResponse(200, { number: 4549, html_url: "https://github.com/o/r/issues/4549", state: init.method === "PATCH" ? "closed" : "open" }),
    );
    const result = await closeUpstreamIssueForTerminal({ kind: "epic", id: "epic-1" });
    expect(result).toMatchObject({ status: "closed", issueNumber: 4549 });
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body)).toEqual({ state: "closed", state_reason: "completed" });
    expect(prisma.epic.update).toHaveBeenCalledWith({ where: { id: "epic-1" }, data: { upstreamSyncedAt: expect.any(Date) } });
  });
});

describe("sweepUpstreamIssueClosures", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("closes every unsynced terminal mirror and reports the counts", async () => {
    vi.mocked(prisma.backlogItem.findMany).mockResolvedValue([
      { id: "a", itemId: "BI-A", status: "done", completedAt: T1, upstreamIssueNumber: 1, upstreamSyncedAt: T0 },
      { id: "b", itemId: "BI-B", status: "retired", completedAt: T1, upstreamIssueNumber: 2, upstreamSyncedAt: new Date("2026-09-12T00:00:00Z") },
    ] as never);
    vi.mocked(prisma.epic.findMany).mockResolvedValue([] as never);
    mockBacklogFind.mockImplementation((async (args: { where: { id?: string } }) => {
      const id = args.where.id ?? "";
      return { id, itemId: `BI-${id.toUpperCase()}`, status: "done", triageOutcome: null, resolution: null, completedAt: T1, upstreamIssueNumber: 1, upstreamSyncedAt: T0 };
    }) as never);
    mockConfigFind.mockResolvedValue(seededConfig());
    mockBacklogUpdate.mockResolvedValue({} as never);
    fetchMock.mockResolvedValue(jsonResponse(200, { number: 1, html_url: "https://github.com/o/r/issues/1", state: "closed" }));

    const summary = await sweepUpstreamIssueClosures();

    expect(summary).toEqual({ candidates: 1, closed: 1, failed: 0, skipped: 0 });
    expect(mockBacklogFind).toHaveBeenCalledTimes(1);
  });

  it("stops after the first skip when the install cannot reach upstream at all", async () => {
    vi.mocked(prisma.backlogItem.findMany).mockResolvedValue([
      { id: "a", itemId: "BI-A", status: "done", completedAt: T1, upstreamIssueNumber: 1, upstreamSyncedAt: null },
      { id: "b", itemId: "BI-B", status: "done", completedAt: T1, upstreamIssueNumber: 2, upstreamSyncedAt: null },
    ] as never);
    vi.mocked(prisma.epic.findMany).mockResolvedValue([] as never);
    mockBacklogFind.mockResolvedValue({ ...terminalRow({ upstreamSyncedAt: null }), itemId: "BI-A" } as never);
    mockConfigFind.mockResolvedValue(seededConfig({ contributionMode: "fork_only" }));

    const summary = await sweepUpstreamIssueClosures();

    expect(summary).toEqual({ candidates: 2, closed: 0, failed: 0, skipped: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
