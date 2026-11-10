import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CLIENT_CAPABILITY_PROFILE } from "@dpf/integration-shared/client-capability-profile";

import {
  emptyVerificationState,
  newestCliVersions,
  readVerificationState,
  runClientCapabilityReverification,
  staleClientsFromTaskConfig,
  type ReverifyDeps,
  type SourceFetch,
} from "./client-capability-reverify";
import { err, ok } from "@/lib/shared/action-result";

import { extractPassages, fieldsMentioned } from "./client-capability-sources";

// BI-64795FD0 (AC-CAPABILITY-DRIFT): the weekly re-verification reads only the
// declared sources, files at most one proposal per client, never edits the
// profile, and makes a failing source visible.

const now = new Date("2026-10-13T04:17:00Z");
const PAGE = "<html><head><script>var x = 'OAuth everywhere';</script></head><body><h2>Release 0.2.87</h2><p>Improved the terminal renderer for long outputs.</p></body></html>";
const ALL_SOURCES = Object.values(CLIENT_CAPABILITY_PROFILE.clients).flatMap((row) => row.sources);

function deps(over: Partial<ReverifyDeps> = {}, pages: Record<string, string> = {}): ReverifyDeps & {
  fetchSource: ReturnType<typeof vi.fn>;
  fileItem: ReturnType<typeof vi.fn>;
  recordOnOpenItem: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
  resolveNotifications: ReturnType<typeof vi.fn>;
} {
  const fetchSource = vi.fn<SourceFetch>(async (url) => ok(pages[url] ?? PAGE));
  return {
    profile: CLIENT_CAPABILITY_PROFILE,
    reportedCliVersions: {},
    state: emptyVerificationState(),
    now,
    fetchSource,
    fileItem: vi.fn(async (proposal) => ({ itemId: `BI-${proposal.clientKind}`, created: true })),
    recordOnOpenItem: vi.fn(async () => null),
    notify: vi.fn(async () => {}),
    resolveNotifications: vi.fn(async () => {}),
    ...over,
  } as never;
}

describe("source passages", () => {
  it("reads visible text only, one passage per block", () => {
    expect(extractPassages(PAGE)).toEqual(["Release 0.2.87", "Improved the terminal renderer for long outputs."]);
  });

  it("names the profile fields a passage talks about", () => {
    expect(fieldsMentioned("MCP servers can now sign in with OAuth on localhost.")).toEqual(["oauthLoopbackHttp"]);
    expect(fieldsMentioned("PreToolUse hooks now receive the permission mode.")).toEqual(["hookPlane"]);
    expect(fieldsMentioned("Plugins can be installed at project scope.")).toEqual(["pluginScopes"]);
    expect(fieldsMentioned("Improved the terminal renderer.")).toEqual([]);
  });
});

describe("runClientCapabilityReverification", () => {
  it("reads only the declared sources and only baselines on the first run", async () => {
    const d = deps();
    const result = await runClientCapabilityReverification(d);
    expect(d.fetchSource.mock.calls.map(([url]) => url).sort()).toEqual([...ALL_SOURCES].sort());
    expect(result.proposals).toEqual([]);
    expect(d.fileItem).not.toHaveBeenCalled();
    expect(Object.keys(result.state.clients.grok!.passages)).toEqual(CLIENT_CAPABILITY_PROFILE.clients.grok!.sources);
  });

  it("files one proposal per client, quoting the new passage and the field it affects", async () => {
    const first = await runClientCapabilityReverification(deps());
    const changed = `${PAGE}<p>Grok now completes MCP OAuth sign-in for remote servers over https.</p><p>Hooks: PreToolUse now fires for plugin-bundled hooks.</p>`;
    const grokSource = CLIENT_CAPABILITY_PROFILE.clients.grok!.sources[0]!;
    const d = deps({ state: first.state }, { [grokSource]: changed });
    const result = await runClientCapabilityReverification(d);
    expect(d.fileItem).toHaveBeenCalledTimes(1);
    const [proposal] = result.proposals;
    expect(proposal).toMatchObject({ clientKind: "grok", clientVersion: "0.2.87", intakeKey: "client-capability:grok@0.2.87" });
    expect(proposal!.findings.map((finding) => finding.field).sort()).toEqual(["hookPlane", "oauthHttps"]);
    expect(proposal!.findings[0]!.passage).toMatch(/OAuth sign-in|PreToolUse/);
    expect(proposal!.findings.find((f) => f.field === "oauthHttps")!.proposedValue).toContain("re-verify");
    expect(proposal!.findings.find((f) => f.field === "oauthHttps")!.currentValue).toBe("false (unproven)");
  });

  it("files for a reported CLI version newer than verified, keyed on that version", async () => {
    const first = await runClientCapabilityReverification(deps());
    const d = deps({ state: first.state, reportedCliVersions: { codex: "0.160.0", "claude-code": "2.1.295" } });
    const result = await runClientCapabilityReverification(d);
    expect(result.proposals.map((p) => p.intakeKey)).toEqual(["client-capability:codex@0.160.0"]);
  });

  it("marks a failing source's client verificationStale and never edits the profile", async () => {
    const before = structuredClone(CLIENT_CAPABILITY_PROFILE);
    const grokSource = CLIENT_CAPABILITY_PROFILE.clients.grok!.sources[1]!;
    const d = deps();
    d.fetchSource.mockImplementation(async (url: string) => (url === grokSource ? err("HTTP 503") : ok(PAGE)));
    d.recordOnOpenItem.mockResolvedValue("BI-OPEN");
    const result = await runClientCapabilityReverification(d);
    expect(result.state.clients.grok!.verificationStale).toEqual({ reason: `${grokSource}: HTTP 503`, at: now.toISOString() });
    expect(result.state.clients.codex!.verificationStale).toBeNull();
    expect(d.recordOnOpenItem).toHaveBeenCalledWith("grok", expect.objectContaining({ failures: [`${grokSource}: HTTP 503`] }));
    expect(result.state.consecutiveFailedRuns).toBe(1);
    expect(d.notify).not.toHaveBeenCalled();
    expect(CLIENT_CAPABILITY_PROFILE).toEqual(before);
    expect(staleClientsFromTaskConfig({ clientCapability: result.state })).toEqual([
      { clientKind: "grok", label: "capabilities unverified", reason: `${grokSource}: HTTP 503`, at: now.toISOString() },
    ]);
  });

  it("treats a page with nothing parseable as a failure", async () => {
    const d = deps({}, Object.fromEntries(ALL_SOURCES.map((url) => [url, "<html><script>x</script></html>"])));
    const result = await runClientCapabilityReverification(d);
    expect(result.failures.length).toBe(ALL_SOURCES.length);
    expect(result.failures[0]).toMatch(/nothing parseable/);
  });

  it("raises one notification on the second failed run in a row, and clears it on recovery", async () => {
    const failing = () => {
      const d = deps();
      d.fetchSource.mockResolvedValue(err("timeout"));
      return d;
    };
    let state = emptyVerificationState();
    const runs = [];
    for (let i = 0; i < 3; i += 1) {
      const d = failing();
      d.state = state;
      const result = await runClientCapabilityReverification(d);
      runs.push(d);
      state = result.state;
    }
    expect(runs.map((d) => d.notify.mock.calls.length)).toEqual([0, 1, 0]);
    expect(state.consecutiveFailedRuns).toBe(3);

    const ok = deps({ state });
    const recovered = await runClientCapabilityReverification(ok);
    expect(recovered.state.consecutiveFailedRuns).toBe(0);
    expect(recovered.state.notified).toBe(false);
    expect(ok.resolveNotifications).toHaveBeenCalledOnce();
    expect(Object.values(recovered.state.clients).every((client) => client.verificationStale === null)).toBe(true);
  });
});

describe("newestCliVersions", () => {
  it("reads the updater's clientVersions map and the surface's own line, newest first", () => {
    expect(newestCliVersions([
      { clientKind: "codex", detail: { cliVersion: "codex-cli 0.150.0", clientVersions: { grok: "grok 0.2.90", "claude-code": null } } },
      { clientKind: "claude-code", detail: { clientVersions: { codex: "codex-cli 0.160.0", "claude-code": "2.1.300 (Claude Code)" } } },
      { clientKind: "grok", detail: null },
    ])).toEqual({ codex: "0.160.0", grok: "0.2.90", "claude-code": "2.1.300" });
  });
});

describe("readVerificationState", () => {
  it("starts empty and refuses a malformed state", () => {
    expect(readVerificationState(null)).toEqual(emptyVerificationState());
    expect(readVerificationState({ other: 1 })).toEqual(emptyVerificationState());
    expect(readVerificationState({ clientCapability: { schemaVersion: 2 } })).toEqual(emptyVerificationState());
  });
});
