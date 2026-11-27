import { describe, expect, it, vi } from "vitest";

import type { StoredProtectedExecutionBinding } from "./protected-execution-binding";
import { createProtectedAttemptReattacher, decideProtectedObservationWrite, observeProtectedAttempt, type ObservationCursor, type ProtectedObservation,
  type ProtectedReadbackPort, type ProtectedReadbackReply } from "./protected-execution-readback.server";
import type { ConnectProtectedReceiver, ProtectedTransport } from "./protected-execution-transport.server";

vi.mock("@dpf/db", () => ({ prisma: {} }));

const stored: StoredProtectedExecutionBinding = { installationRef: "install-a", registrationRef: "registration-a", hostRef: "host-a", receiverRef: "receiver-a",
  roomRef: "WC-1", sessionRef: "session-a", stageAttemptRef: "stage-a", originRef: "origin-a", qualificationRef: "qual-a", qualificationEpoch: 4,
  routes: [{ kind: "loopback", endpointRef: "local-a" }],
  worktree: { worktreeRef: "worktree-a", repositoryFullName: "org/repo", sourceCommit: "a".repeat(40), sourceTree: "b".repeat(40) },
  launch: { phase: "possibly-started", projectionDigest: "d".repeat(64) } };
const key = { installationRef: "install-a", hostRef: "host-a", sessionRef: "session-a", stageAttemptRef: "stage-a", originRef: "origin-a" };
const final = { key, kind: "final-matching", state: "succeeded", receiptRef: "receipt-1", usage: { kind: "unknown" } } as const;
const prior: ObservationCursor = { storeEpoch: "epoch-a", sequence: "11", ref: "cursor-11" };

function fixture(...replies: ProtectedReadbackReply[]) {
  const signal = new AbortController().signal;
  const canReadExact = vi.fn(async () => true);
  const read = vi.fn<ProtectedReadbackPort["read"]>();
  for (const reply of replies) read.mockResolvedValueOnce(reply);
  const connect = vi.fn<ConnectProtectedReceiver<ProtectedReadbackPort>>(async endpoint => ({ kind: "authenticated", channel: { ...endpoint, port: { read } } }));
  const transport: ProtectedTransport<ProtectedReadbackPort> = { connect, resolveEndpoint: async (b, route) => ({
    ...route, registrationRef: b.registrationRef, installationRef: b.installationRef, hostRef: b.hostRef, receiverRef: b.receiverRef,
    url: "https://127.0.0.1:4005", network: "loopback", audienceRef: "protected-resource-a",
  }) };
  return { deps: { transport, signal, canReadExact }, read, connect, canReadExact };
}

describe("protected attempt readback", () => {
  it("reads the exact original pinned attempt and returns only its authenticated receipt", async () => {
    const f = fixture(final);
    await expect(observeProtectedAttempt(stored, f.deps)).resolves.toEqual({ outcome: "observed", reachable: true,
      observation: { kind: "final-matching", state: "succeeded", receiptRef: "receipt-1", usage: { kind: "unknown" } } });
    expect(f.read).toHaveBeenCalledWith({ key, cursor: null, signal: f.deps.signal });
  });

  it("holds unknown, wrong identity, wrong attempt, lost transport, and malformed usage rather than settling", async () => {
    const variants: ProtectedReadbackReply[] = [{ key, kind: "unknown-attempt" }, { key, kind: "uncertain" }, { key, kind: "refused" },
      { ...final, key: { ...key, originRef: "another-origin" } }, { ...final, key: { ...key, stageAttemptRef: "stage-other" } },
      { ...final, usage: 0 } as unknown as ProtectedReadbackReply];
    for (const reply of variants) {
      const f = fixture(reply);
      await expect(observeProtectedAttempt(stored, f.deps)).resolves.toEqual({ outcome: "held", reachable: true });
    }
    const lost = fixture();
    lost.read.mockRejectedValue(new Error("partition"));
    await expect(observeProtectedAttempt(stored, lost.deps)).resolves.toEqual({ outcome: "held", reachable: true });
  });

  it("a cursor reset reads exact status once on the same authenticated channel, without copying an old cursor to another store", async () => {
    const f = fixture({ key, kind: "cursor-reset" }, final);
    const withCursor = { ...f.deps, cursor: prior };
    await expect(observeProtectedAttempt(stored, withCursor)).resolves.toMatchObject({ outcome: "observed" });
    expect(f.connect).toHaveBeenCalledTimes(1);
    expect(f.read.mock.calls.map(([input]) => input.cursor)).toEqual([prior, null]);
    const late = fixture({ key, kind: "nonterminal", state: "resumable", receiptRef: "receipt-2", usage: { kind: "unknown" },
      cursor: { ...prior, sequence: "10", ref: "cursor-10" } });
    await expect(observeProtectedAttempt(stored, { ...late.deps, cursor: prior })).resolves.toEqual({ outcome: "held", reachable: true });
  });

  it("does not connect without exact read authorization or if the send boundary was never crossed", async () => {
    const f = fixture(final);
    f.canReadExact.mockResolvedValue(false);
    await expect(observeProtectedAttempt(stored, f.deps)).resolves.toEqual({ outcome: "held", reachable: false });
    await expect(observeProtectedAttempt({ ...stored, launch: { phase: "queued" } }, f.deps)).resolves.toEqual({ outcome: "held", reachable: false });
    expect(f.connect).not.toHaveBeenCalled();
  });

  it("replays an exact terminal receipt once and holds a competing or late observation", () => {
    const { key: _key, ...terminal } = final;
    const nonterminal: ProtectedObservation = { kind: "nonterminal", state: "resumable", receiptRef: "observed", cursor: prior, usage: { kind: "unknown" } };
    const previous = { ...stored, observation: nonterminal };
    const completed = { ...stored, observation: terminal };
    expect(decideProtectedObservationWrite(previous, previous, terminal)).toBe("apply");
    expect(decideProtectedObservationWrite(previous, completed, terminal)).toBe("unchanged");
    expect(decideProtectedObservationWrite(previous, completed, { ...terminal, receiptRef: "changed" })).toBe("hold");
    expect(decideProtectedObservationWrite(stored, previous, terminal)).toBe("hold");
    expect(decideProtectedObservationWrite(stored, { ...stored, originRef: "another" }, terminal)).toBe("hold");
  });

  it("reattaches after a new portal process, writes one final receipt and leaves sibling bindings untouched", async () => {
    const sibling = { ...stored, stageAttemptRef: "stage-other" };
    let workspace = { protectedExecution: { version: 1, bindings: [stored, sibling] } };
    const receipts = new Map<string, { kind: string; payload: unknown }>();
    let writes = 0;
    const port = {
      workroom: { findUnique: async () => ({ id: "row-a", workspaceState: workspace }) },
      workroomActivity: {
        findFirst: async (args: unknown) => receipts.get((args as { where: { commandKey: string } }).where.commandKey) ?? null,
        create: async (args: unknown) => {
          const row = (args as { data: { commandKey: string; kind: string; payload: unknown } }).data;
          receipts.set(row.commandKey, row);
          return row;
        },
      },
      $queryRaw: async () => [{ id: "row-a" }],
      $executeRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
        if (parts.join("?").includes("{protectedExecution}")) {
          workspace = { protectedExecution: JSON.parse(String(values[0])) };
          writes++;
        }
        return 1;
      },
    };
    const db = { ...port, $transaction: async <T>(run: (tx: typeof port) => Promise<T>) => run(port) };
    const probe = fixture();
    probe.read.mockRejectedValueOnce(new Error("lost response"));
    const selector = { roomRef: stored.roomRef, sessionRef: stored.sessionRef, stageAttemptRef: stored.stageAttemptRef, signal: probe.deps.signal };
    const canRecordExact = async () => true;
    await expect(createProtectedAttemptReattacher({ ...probe.deps, db, canRecordExact })(selector)).resolves.toMatchObject({ outcome: "held" });
    const recovered = fixture(final, final);
    const fromRestart = createProtectedAttemptReattacher({ ...recovered.deps, db, canRecordExact });
    await expect(fromRestart(selector)).resolves.toMatchObject({ outcome: "observed" });
    await expect(fromRestart(selector)).resolves.toMatchObject({ outcome: "observed" });
    expect(writes).toBe(1);
    expect(workspace.protectedExecution.bindings[0]?.observation).toMatchObject({ kind: "final-matching", receiptRef: "receipt-1" });
    expect(workspace.protectedExecution.bindings[1]).toEqual(sibling);
  });
});
