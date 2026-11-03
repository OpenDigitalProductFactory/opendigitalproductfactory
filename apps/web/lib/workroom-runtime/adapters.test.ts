import { describe, expect, it, vi } from "vitest";

// BI-05715F4C: the Codex app-server and Claude stream-json adapters, against a
// fake CLI that plays the provider's side (frames as recorded by T3 Code).

import { CLAUDE_SESSION_SCRIPT, claudeSessionFlags, createClaudeAdapter } from "./claude-stream-adapter";
import { CODEX_SESSION_SCRIPT, codexApprovalResponse, createCodexAdapter } from "./codex-app-server-adapter";
import { createJsonRpcPeer } from "./json-rpc-peer";
import { autoRespond, fakeProcess } from "./__fixtures__/fake-process";
import type { RuntimeEvent } from "./types";

const CONFIG = { capsuleId: "WC-1", mcp: { url: "http://portal:3000/api/mcp/v1", bearerToken: "dpfroom_secret" }, cwd: "/workspace" };

describe("json-rpc peer", () => {
  it("matches responses to requests, rejects errors, and fails what is pending when the process exits", async () => {
    const proc = fakeProcess();
    const notes: string[] = [];
    const peer = createJsonRpcPeer(proc, { onNotification: (m) => notes.push(m), onServerRequest: () => {}, onClose: () => {} });
    const ok = peer.request("a");
    const bad = peer.request("b");
    const lost = peer.request("c");
    proc.emit({ method: "note/x", params: {} });
    proc.emit({ id: 1, result: { fine: true } });
    proc.emit({ id: 2, error: { code: -1, message: "nope" } });
    await expect(ok).resolves.toEqual({ fine: true });
    await expect(bad).rejects.toThrow(/b: nope/);
    proc.exit(1);
    await expect(lost).rejects.toThrow(/exited/);
    expect(notes).toEqual(["note/x"]);
  });
});

describe("codex app-server adapter", () => {
  async function open(resumeThreadId: string | null = null) {
    const proc = fakeProcess();
    autoRespond(proc, {
      initialize: {}, "account/login/start": { type: "apiKey" },
      "thread/start": { thread: { id: "thr-1" } }, "thread/resume": { thread: { id: "thr-old" } },
      "turn/start": { turn: { id: "turn-1" } }, "turn/steer": {}, "turn/interrupt": {},
    });
    const events: RuntimeEvent[] = [];
    const adapter = createCodexAdapter({ launch: (launch) => { proc.launch = launch; return proc; }, login: async () => ({ type: "apiKey", apiKey: "sk" }) });
    const session = await adapter.openSession({ ...CONFIG, resumeThreadId }, (event) => events.push(event));
    return { proc, events, session };
  }

  it("keeps the room credential out of argv and asks Codex to request approval", async () => {
    const { proc, session } = await open();
    expect(proc.launch?.script).toBe(CODEX_SESSION_SCRIPT);
    expect(proc.launch?.script).not.toContain("dpfroom_secret");
    expect(proc.launch?.env).toMatchObject({ DPF_MCP_TOKEN: "dpfroom_secret", DPF_MCP_URL: CONFIG.mcp.url });
    expect(proc.written.map((frame) => frame["method"])).toEqual(["initialize", "initialized", "account/login/start"]);
    await expect(session.ensureThread()).resolves.toBe("thr-1");
    await expect(session.startTurn("do it")).resolves.toEqual({ turnId: "turn-1" });
    expect(proc.written.at(-1)).toMatchObject({ method: "turn/start", params: {
      threadId: "thr-1", input: [{ type: "text", text: "do it" }], approvalPolicy: "on-request", sandboxPolicy: { type: "workspaceWrite" } } });
  });

  it("keeps child and foreign activity from changing or completing the root turn", async () => {
    const { proc, events, session } = await open();
    await session.ensureThread();
    await session.startTurn("root work");
    proc.emit({ method: "turn/started", params: { threadId: "thr-child", turn: { id: "turn-child" } } });
    proc.emit({ method: "item/completed", params: { threadId: "thr-child", turnId: "turn-child", item: { type: "agentMessage", text: "child result" } } });
    proc.emit({ method: "turn/completed", params: { threadId: "thr-child", turn: { id: "turn-child", status: "completed" } } });
    proc.emit({ method: "turn/completed", params: { threadId: "thr-foreign", turn: { id: "turn-1", status: "completed" } } });
    expect(session.activeTurnId()).toBe("turn-1");
    expect(events).toEqual([]);
    proc.emit({ id: 8, method: "item/commandExecution/requestApproval", params: { threadId: "thr-child", turnId: "turn-child", itemId: "exec-child", command: "git push" } });
    expect(events).toEqual([expect.objectContaining({ type: "runtime-request", request: expect.objectContaining({ requestId: "exec-child" }) })]);
    await session.respondToRuntimeRequest("exec-child", "decline");
    expect(proc.written.at(-1)).toEqual({ id: 8, result: { decision: "decline" } });
    proc.emit({ method: "turn/completed", params: { threadId: "thr-1", turn: { id: "turn-1", status: "completed" } } });
    expect(session.activeTurnId()).toBeNull();
    expect(events.filter((event) => event.type === "turn-completed")).toEqual([
      { type: "turn-completed", turnId: "turn-1", status: "completed", error: null },
    ]);
  });

  it.each(["completed", "failed", "interrupted"] as const)("settles a matching %s root once and ignores stale or malformed terminals", async (status) => {
    const { proc, events, session } = await open();
    await session.ensureThread();
    await session.startTurn("root work");
    for (const params of [
      { threadId: "thr-1", turn: { status } },
      { turn: { id: "turn-1", status } },
      { threadId: "thr-1", turn: { id: "turn-1", status: "inProgress" } },
      { threadId: "thr-1", turn: { id: "turn-old", status } },
    ]) proc.emit({ method: "turn/completed", params });
    expect(session.activeTurnId()).toBe("turn-1");
    expect(events).toEqual([]);
    const terminal = { method: "turn/completed", params: { threadId: "thr-1", turn: { id: "turn-1", status, error: status === "failed" ? { message: "provider failure" } : null } } };
    proc.emit(terminal);
    proc.emit(terminal);
    expect(session.activeTurnId()).toBeNull();
    expect(events).toEqual([{ type: "turn-completed", turnId: "turn-1", status, error: status === "failed" ? "provider failure" : null }]);
  });
  it("ignores late root activity while a newer root turn runs", async () => {
    const { proc, events, session } = await open();
    await session.ensureThread();
    await session.startTurn("first");
    proc.emit({ method: "turn/completed", params: { threadId: "thr-1", turn: { id: "turn-1", status: "completed" } } });
    proc.emit({ method: "turn/started", params: { threadId: "thr-1", turn: { id: "turn-2" } } });
    const count = events.length;
    proc.emit({ method: "turn/started", params: { threadId: "thr-1", turn: { id: "turn-1" } } });
    proc.emit({ method: "item/completed", params: { threadId: "thr-1", turnId: "turn-1", item: { type: "agentMessage", text: "late" } } });
    proc.emit({ method: "turn/completed", params: { threadId: "thr-1", turn: { id: "turn-1", status: "completed" } } });
    expect(session.activeTurnId()).toBe("turn-2");
    expect(events).toHaveLength(count);
    proc.emit({ method: "turn/completed", params: { threadId: "thr-1", turn: { id: "turn-2", status: "completed" } } });
    expect(events.filter((event) => event.type === "turn-completed").map((event) => event.turnId)).toEqual(["turn-1", "turn-2"]);
  });

  it("does not reopen a root that completed before its start acknowledgement", async () => {
    const proc = fakeProcess();
    autoRespond(proc, { initialize: {}, "account/login/start": {}, "thread/start": { thread: { id: "thr-fast" } } });
    const originalWrite = proc.write.bind(proc);
    proc.write = (line) => {
      originalWrite(line);
      const frame = JSON.parse(line) as { id?: number; method?: string };
      if (frame.method === "turn/start") queueMicrotask(() => {
        proc.emit({ method: "turn/started", params: { threadId: "thr-fast", turn: { id: "turn-fast" } } });
        proc.emit({ method: "turn/completed", params: { threadId: "thr-fast", turn: { id: "turn-fast", status: "completed" } } });
        proc.emit({ id: frame.id, result: { turn: { id: "turn-fast" } } });
      });
    };
    const events: RuntimeEvent[] = [];
    const session = await createCodexAdapter({ launch: () => proc, login: async () => ({ type: "apiKey", apiKey: "sk" }) })
      .openSession(CONFIG, (event) => events.push(event));
    await session.ensureThread();
    await session.startTurn("fast");
    expect(session.activeTurnId()).toBeNull();
    expect(events.filter((event) => event.type === "turn-completed")).toHaveLength(1);
    proc.emit({ method: "turn/started", params: { threadId: "thr-fast", turn: { id: "turn-fast" } } });
    expect(session.activeTurnId()).toBeNull();
  });
  it("keeps older settled roots retired after later turns finish", async () => {
    const proc = fakeProcess();
    autoRespond(proc, { initialize: {}, "account/login/start": {}, "thread/start": { thread: { id: "thr-fast" } } });
    const originalWrite = proc.write.bind(proc);
    const starts: number[] = [];
    proc.write = (line) => {
      originalWrite(line);
      const frame = JSON.parse(line) as { id?: number; method?: string };
      if (frame.method === "turn/start") starts.push(frame.id!);
    };
    const events: RuntimeEvent[] = [];
    const session = await createCodexAdapter({ launch: () => proc, login: async () => ({ type: "apiKey", apiKey: "sk" }) })
      .openSession(CONFIG, (event) => events.push(event));
    await session.ensureThread();
    const first = session.startTurn("first");
    proc.emit({ method: "turn/started", params: { threadId: "thr-fast", turn: { id: "turn-first" } } });
    proc.emit({ method: "turn/completed", params: { threadId: "thr-fast", turn: { id: "turn-first", status: "completed" } } });
    const second = session.startTurn("second");
    proc.emit({ method: "turn/started", params: { threadId: "thr-fast", turn: { id: "turn-second" } } });
    proc.emit({ method: "turn/completed", params: { threadId: "thr-fast", turn: { id: "turn-second", status: "completed" } } });
    proc.emit({ id: starts[1], result: { turn: { id: "turn-second" } } });
    await second;
    proc.emit({ id: starts[0], result: { turn: { id: "turn-first" } } });
    await first;
    expect(session.activeTurnId()).toBeNull();
    const count = events.length;
    proc.emit({ method: "turn/started", params: { threadId: "thr-fast", turn: { id: "turn-first" } } });
    proc.emit({ method: "turn/completed", params: { threadId: "thr-fast", turn: { id: "turn-first", status: "completed" } } });
    expect(session.activeTurnId()).toBeNull();
    expect(events).toHaveLength(count);
    await session.close();
  });
  it("resumes a stored thread instead of starting one", async () => {
    const { proc, session } = await open("thr-old");
    await expect(session.ensureThread()).resolves.toBe("thr-old");
    expect(proc.written.at(-1)).toMatchObject({ method: "thread/resume", params: { threadId: "thr-old", excludeTurns: true } });
  });

  it("reports turns and messages, turns approvals into runtime requests, and answers them in Codex's shape", async () => {
    const { proc, events, session } = await open();
    await session.ensureThread();
    proc.emit({ method: "turn/started", params: { threadId: "thr-1", turn: { id: "turn-1" } } });
    proc.emit({ id: 0, method: "item/commandExecution/requestApproval", params: { threadId: "thr-1", turnId: "turn-1", itemId: "exec-1", command: "git push" } });
    proc.emit({ method: "item/completed", params: { threadId: "thr-1", turnId: "turn-1", item: { type: "agentMessage", text: "done" } } });
    proc.emit({ method: "turn/completed", params: { threadId: "thr-1", turn: { id: "turn-1", status: "completed" } } });
    expect(events).toEqual([
      { type: "turn-started", turnId: "turn-1" },
      expect.objectContaining({ type: "runtime-request", request: expect.objectContaining({ requestId: "exec-1", kind: "command", summary: "git push" }) }),
      { type: "message", turnId: "turn-1", text: "done" },
      { type: "turn-completed", turnId: "turn-1", status: "completed", error: null },
    ]);
    await session.respondToRuntimeRequest("exec-1", "decline");
    expect(proc.written.at(-1)).toEqual({ id: 0, result: { decision: "decline" } });
    expect(codexApprovalResponse("item/permissions/requestApproval", { permissions: { network: true } }, "accept"))
      .toEqual({ permissions: { network: true }, scope: "turn" });
  });

  it("steers and interrupts the turn in progress, and cancels open questions when it closes", async () => {
    const { proc, session } = await open();
    await session.ensureThread();
    await session.startTurn("go");
    await expect(session.steerTurn("also this")).resolves.toBe(true);
    expect(proc.written.at(-1)).toMatchObject({ method: "turn/steer", params: { threadId: "thr-1", expectedTurnId: "turn-1" } });
    await session.interruptTurn();
    expect(proc.written.at(-1)).toMatchObject({ method: "turn/interrupt", params: { threadId: "thr-1", turnId: "turn-1" } });
    proc.emit({ id: 7, method: "item/fileChange/requestApproval", params: { itemId: "fc-1", turnId: "turn-1" } });
    await session.close();
    expect(proc.written).toContainEqual({ id: 7, result: { decision: "cancel" } });
    expect(proc.killed).toBe(true);
  });

  it("refuses a server request it does not answer", async () => {
    const { proc } = await open();
    proc.emit({ id: 9, method: "account/chatgptAuthTokens/refresh", params: {} });
    expect(proc.written.at(-1)).toMatchObject({ id: 9, error: { code: -32601 } });
  });
});

describe("claude stream-json adapter", () => {
  async function open() {
    const proc = fakeProcess();
    const events: RuntimeEvent[] = [];
    const adapter = createClaudeAdapter({ launch: (launch) => { proc.launch = launch; return proc; }, auth: async () => ({ mode: "oauth", token: "oat" }) });
    const session = await adapter.openSession(CONFIG, (event) => events.push(event));
    return { proc, events, session };
  }

  it("mounts the room's MCP server and permission tool with no secret on argv", async () => {
    const { proc } = await open();
    expect(proc.launch?.script).toBe(CLAUDE_SESSION_SCRIPT);
    expect(CLAUDE_SESSION_SCRIPT).toContain("--permission-prompt-tool mcp__dpf__approve_runtime_permission");
    expect(CLAUDE_SESSION_SCRIPT).not.toMatch(/dangerously/);
    expect(JSON.parse(proc.launch!.env["DPF_MCP_CONFIG"]!)).toEqual({ mcpServers: { dpf: { type: "http", url: CONFIG.mcp.url, headers: { Authorization: "Bearer dpfroom_secret" } } } });
    expect(proc.launch?.env).toMatchObject({ CLAUDE_CODE_OAUTH_TOKEN: "oat" });
    expect(claudeSessionFlags({ ...CONFIG, resumeThreadId: "abc12345-0000", model: "sonnet" }, "x")).toBe("--resume abc12345-0000 --model sonnet");
    expect(claudeSessionFlags({ ...CONFIG, model: "bad; rm -rf /" }, "11111111-2222")).toBe("--session-id 11111111-2222");
  });

  it("runs a turn as a user message and reports its reply and its end", async () => {
    const { proc, events, session } = await open();
    proc.emit({ type: "system", subtype: "init", session_id: "sess-9" });
    await session.startTurn("hello");
    expect(proc.written.at(-1)).toEqual({ type: "user", message: { role: "user", content: [{ type: "text", text: "hello" }] } });
    proc.emit({ type: "assistant", message: { content: [{ type: "text", text: "hi" }, { type: "tool_use", name: "Bash" }] } });
    proc.emit({ type: "result", subtype: "success", is_error: false, result: "hi" });
    expect(session.threadId()).toBe("sess-9");
    expect(events).toEqual([
      { type: "turn-started", turnId: "turn-1" },
      { type: "message", turnId: "turn-1", text: "hi" },
      { type: "turn-completed", turnId: "turn-1", status: "completed", error: null },
    ]);
  });

  it("interrupts through the control protocol and cannot steer", async () => {
    const { proc, session } = await open();
    await session.startTurn("long job");
    await session.interruptTurn();
    expect(proc.written.at(-1)).toMatchObject({ type: "control_request", request: { subtype: "interrupt" } });
    await expect(session.steerTurn("more")).resolves.toBe(false);
    const exited = vi.fn();
    proc.onClose(exited);
    proc.exit(0);
    expect(exited).toHaveBeenCalledWith(0);
  });
});
