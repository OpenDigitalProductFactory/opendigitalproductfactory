import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-05715F4C: the Workroom runtime supervisor. A fake adapter plays the CLI;
// the room, its log and the credential store are mocked.

const { db, recordActivity } = vi.hoisted(() => ({
  db: { workroom: { findUnique: vi.fn(), update: vi.fn() } },
  recordActivity: vi.fn(async (..._args: unknown[]) => ({ id: "act" })),
}));
vi.mock("@dpf/db", () => ({ prisma: db }));
vi.mock("@/lib/work-capsules/work-capsule-activity-store", () => ({ recordWorkCapsuleActivity: recordActivity }));

import { decideClaudeToolCall, decideCodexRequest } from "./runtime-request-policy";
import { createRuntimeSupervisor } from "./supervisor";
import { createCodexAdapter } from "./codex-app-server-adapter";
import { autoRespond, fakeProcess } from "./__fixtures__/fake-process";
import type { ExecutorAdapter, RuntimeEvent, RuntimeSession } from "./types";

const actor = { userId: "user-1", agentId: "agent-1", principalId: "prn-1" };
let room: { id: string; status: string; archivedAt: Date | null; workspaceState: Record<string, unknown>; taskRunId: string | null };

function harness() {
  let emit: (event: RuntimeEvent) => void = () => {};
  const session = {
    provider: "codex" as const,
    turn: null as string | null,
    threadId: () => "thr-1",
    activeTurnId: () => session.turn,
    ensureThread: vi.fn(async () => "thr-1"),
    startTurn: vi.fn(async () => { session.turn = "turn-1"; return { turnId: "turn-1" }; }),
    steerTurn: vi.fn(async () => true),
    interruptTurn: vi.fn(async () => {}),
    respondToRuntimeRequest: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const adapter: ExecutorAdapter = {
    provider: "codex", supportsSteer: true,
    openSession: vi.fn(async (_config, onEvent) => { emit = onEvent; return session as unknown as RuntimeSession; }),
  };
  const issueToken = vi.fn(async () => ({ tokenId: "tok-1", plaintext: "dpfroom_x" }));
  const revokeTokens = vi.fn(async () => 1);
  const runtime = createRuntimeSupervisor({ adapters: { codex: adapter, claude: adapter }, mcpUrl: "http://portal/api/mcp/v1", issueToken, revokeTokens });
  return { runtime, session, adapter, issueToken, revokeTokens, emit: (event: RuntimeEvent) => emit(event) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const kinds = () => recordActivity.mock.calls.map((call) => (call as unknown as [unknown, { kind: string }])[1].kind);

beforeEach(() => {
  vi.clearAllMocks();
  room = { id: "row-1", status: "working", archivedAt: null, workspaceState: {}, taskRunId: "TR-1" };
  db.workroom.findUnique.mockImplementation(async () => room);
  db.workroom.update.mockImplementation(async ({ data }: { data: { workspaceState: Record<string, unknown> } }) => { room.workspaceState = data.workspaceState; return room; });
});

describe("start", () => {
  it("issues the room's own credential, opens the session, stores its thread and runs the first turn", async () => {
    const h = harness();
    const result = await h.runtime.start({ capsuleId: "WC-1", provider: "codex", actor, prompt: "begin" });
    expect(result).toMatchObject({ success: true, data: { threadId: "thr-1" } });
    expect(h.issueToken).toHaveBeenCalledWith({ userId: "user-1", agentId: "agent-1", capsuleId: "WC-1", runRef: "TR-1" });
    expect(h.adapter.openSession).toHaveBeenCalledWith(expect.objectContaining({ mcp: { url: "http://portal/api/mcp/v1", bearerToken: "dpfroom_x" }, cwd: "/workspace" }), expect.any(Function));
    expect(room.workspaceState["runtimeSession"]).toMatchObject({ provider: "codex", threadId: "thr-1", tokenId: "tok-1", status: "open" });
    expect(h.session.startTurn).toHaveBeenCalledWith("begin");
    await expect(h.runtime.start({ capsuleId: "WC-1", provider: "codex", actor })).resolves.toMatchObject({ error: "already_running" });
  });

  it("refuses a room that ended", async () => {
    room.status = "complete";
    await expect(harness().runtime.start({ capsuleId: "WC-1", provider: "codex", actor })).resolves.toMatchObject({ error: "room_terminal" });
  });

  it("records a session lost with its process as cancelled, revokes its credential, and resumes its thread", async () => {
    room.workspaceState = { runtimeSession: { provider: "codex", threadId: "thr-old", tokenId: "tok-old", status: "open", openedAt: "x", cwd: "/workspace/app" } };
    const h = harness();
    await h.runtime.start({ capsuleId: "WC-1", provider: "codex", actor });
    expect(h.revokeTokens).toHaveBeenCalledWith({ capsuleId: "WC-1", reason: "cancelled_after_process_loss", tokenId: "tok-old" });
    expect(recordActivity.mock.calls[0]?.[1]).toMatchObject({ kind: "error", summary: expect.stringMatching(/^cancelled_after_process_loss/) });
    expect(h.adapter.openSession).toHaveBeenCalledWith(expect.objectContaining({ resumeThreadId: "thr-old", cwd: "/workspace/app" }), expect.any(Function));
  });

  it("revokes the credential when the runtime cannot start", async () => {
    const h = harness();
    vi.mocked(h.adapter.openSession).mockRejectedValueOnce(new Error("no codex"));
    await expect(h.runtime.start({ capsuleId: "WC-1", provider: "codex", actor })).resolves.toMatchObject({ error: "runtime_unavailable" });
    expect(h.revokeTokens).toHaveBeenCalledWith(expect.objectContaining({ tokenId: "tok-1" }));
  });
});

describe("a live session", () => {
  it("queues input while a turn runs, steers when asked, and starts the queued turn when the turn ends", async () => {
    const h = harness();
    await h.runtime.start({ capsuleId: "WC-1", provider: "codex", actor, prompt: "first" });
    await expect(h.runtime.turn({ capsuleId: "WC-1", prompt: "next" })).resolves.toMatchObject({ data: { outcome: "queued" } });
    await expect(h.runtime.turn({ capsuleId: "WC-1", prompt: "also", steer: true })).resolves.toMatchObject({ data: { outcome: "steered" } });
    h.session.turn = null;
    h.emit({ type: "turn-completed", turnId: "turn-1", status: "completed" });
    await flush();
    expect(h.session.startTurn).toHaveBeenLastCalledWith("next");
  });

  it("accepts a workspace command, holds an outward one for the room, and answers it when decided", async () => {
    const h = harness();
    await h.runtime.start({ capsuleId: "WC-1", provider: "codex", actor });
    h.emit({ type: "runtime-request", request: { requestId: "r-local", kind: "command", turnId: "t", summary: "pnpm test", detail: {} } });
    h.emit({ type: "runtime-request", request: { requestId: "r-push", kind: "command", turnId: "t", summary: "git push origin main", detail: {} } });
    await flush();
    expect(h.session.respondToRuntimeRequest).toHaveBeenCalledWith("r-local", "accept");
    expect(h.session.respondToRuntimeRequest).not.toHaveBeenCalledWith("r-push", expect.anything());
    expect(h.runtime.status("WC-1")).toMatchObject({ held: [{ requestId: "r-push" }] });
    expect(kinds()).toContain("question");
    await h.runtime.decide({ capsuleId: "WC-1", requestId: "r-push", decision: "decline", reason: "not this branch", actor });
    expect(h.session.respondToRuntimeRequest).toHaveBeenCalledWith("r-push", "decline");
  });

  it("answers Claude's permission tool by policy, and allows a held call once the room accepts it", async () => {
    const h = harness();
    await h.runtime.start({ capsuleId: "WC-1", provider: "claude", actor });
    await expect(h.runtime.claudePermission({ capsuleId: "WC-1", toolName: "Edit", toolInput: { file_path: "/workspace/a.ts" } }))
      .resolves.toEqual({ behavior: "allow", updatedInput: { file_path: "/workspace/a.ts" } });
    const held = await h.runtime.claudePermission({ capsuleId: "WC-1", toolName: "WebFetch", toolInput: { url: "https://x" } });
    expect(held).toMatchObject({ behavior: "deny" });
    const [{ requestId }] = (h.runtime.status("WC-1") as { held: Array<{ requestId: string }> }).held;
    await h.runtime.decide({ capsuleId: "WC-1", requestId: requestId!, decision: "accept", reason: "docs fetch is fine", actor });
    await expect(h.runtime.claudePermission({ capsuleId: "WC-1", toolName: "WebFetch", toolInput: { url: "https://x" } }))
      .resolves.toMatchObject({ behavior: "allow" });
    await expect(h.runtime.claudePermission({ capsuleId: "WC-2", toolName: "Edit", toolInput: {} })).resolves.toMatchObject({ behavior: "deny" });
  });

  it("revokes the credential and closes the stored session when the CLI exits or is stopped", async () => {
    const h = harness();
    await h.runtime.start({ capsuleId: "WC-1", provider: "codex", actor });
    h.emit({ type: "session-exited", code: 1, reason: "the runtime exited with 1" });
    await flush();
    expect(h.revokeTokens).toHaveBeenCalledWith(expect.objectContaining({ capsuleId: "WC-1", tokenId: "tok-1" }));
    expect(room.workspaceState["runtimeSession"]).toMatchObject({ status: "closed" });
    expect(h.runtime.status("WC-1")).toEqual({ live: false });
    await h.runtime.start({ capsuleId: "WC-1", provider: "codex", actor });
    await h.runtime.stop({ capsuleId: "WC-1", reason: "done", actor });
    expect(h.session.close).toHaveBeenCalled();
    await expect(h.runtime.turn({ capsuleId: "WC-1", prompt: "x" })).resolves.toMatchObject({ error: "no_session" });
  });
});

describe("runtime request policy", () => {
  it("accepts work inside the sandbox and escalates what reaches past it", () => {
    expect(decideCodexRequest({ kind: "command", summary: "pnpm vitest run", detail: {} }).verdict).toBe("accept");
    for (const command of ["git push origin x", "curl https://evil", "npm publish", "gh pr merge 1", "docker ps", "ssh host"]) {
      expect(decideCodexRequest({ kind: "command", summary: command, detail: {} }).verdict).toBe("escalate");
    }
    expect(decideCodexRequest({ kind: "permission", summary: "", detail: {} }).verdict).toBe("escalate");
    expect(decideCodexRequest({ kind: "file-change", summary: "", detail: {} }).verdict).toBe("accept");
    const claude = (toolName: string, input: Record<string, unknown>) => decideClaudeToolCall({ toolName, input, cwd: "/workspace" }).verdict;
    expect(claude("Read", { file_path: "/workspace/x" })).toBe("accept");
    expect(claude("Write", { file_path: "/etc/passwd" })).toBe("escalate");
    expect(claude("Edit", { file_path: "/workspace/../etc/x" })).toBe("escalate");
    expect(claude("Bash", { command: "ls -la" })).toBe("accept");
    expect(claude("Bash", { command: "git push" })).toBe("escalate");
    expect(claude("mcp__dpf__get_workroom", {})).toBe("accept");
    expect(claude("mcp__other__thing", {})).toBe("escalate");
    expect(claude("SomethingNew", {})).toBe("escalate");
  });
});

it("advances queued room input only after the real adapter settles its root turn", async () => {
  const proc = fakeProcess();
  autoRespond(proc, { initialize: {}, "account/login/start": {}, "thread/start": { thread: { id: "thr-root" } } });
  const write = proc.write.bind(proc);
  let starts = 0;
  proc.write = (line) => {
    write(line);
    const frame = JSON.parse(line) as { id?: number; method?: string };
    if (frame.method === "turn/start") {
      const turnId = `root-${++starts}`;
      queueMicrotask(() => proc.emit({ id: frame.id, result: { turn: { id: turnId } } }));
    }
  };
  const runtime = createRuntimeSupervisor({
    adapters: { codex: createCodexAdapter({ launch: () => proc, login: async () => ({ type: "apiKey", apiKey: "sk" }) }) },
    mcpUrl: "http://portal/api/mcp/v1",
    issueToken: async () => ({ tokenId: "tok-root", plaintext: "dpfroom_test" }),
    revokeTokens: async () => 1,
  });
  try {
    await runtime.start({ capsuleId: "WC-1", provider: "codex", actor, prompt: "first" });
    await runtime.turn({ capsuleId: "WC-1", prompt: "second" });
    await runtime.turn({ capsuleId: "WC-1", prompt: "third" });
    proc.emit({ method: "turn/started", params: { threadId: "thr-child", turn: { id: "child-1" } } });
    proc.emit({ method: "turn/completed", params: { threadId: "thr-child", turn: { id: "child-1", status: "completed" } } });
    await flush();
    expect(starts).toBe(1);
    proc.emit({ method: "turn/completed", params: { threadId: "thr-root", turn: { id: "root-1", status: "completed" } } });
    await flush();
    expect(starts).toBe(2);
    proc.emit({ method: "turn/completed", params: { threadId: "thr-root", turn: { id: "root-1", status: "completed" } } });
    await flush();
    expect(starts).toBe(2);
    proc.emit({ method: "turn/completed", params: { threadId: "thr-root", turn: { id: "root-2", status: "completed" } } });
    await flush();
    expect(starts).toBe(3);
    proc.emit({ method: "turn/completed", params: { threadId: "thr-root", turn: { id: "root-3", status: "completed" } } });
    await flush();
    expect(starts).toBe(3);
  } finally {
    await runtime.stop({ capsuleId: "WC-1", reason: "test finished", actor });
  }
});