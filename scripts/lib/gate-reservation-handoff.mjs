// BI-EB864226: only the reservation pin advances. The source and actor do not.
// This is a child-controller handoff, never authority to release a lease:
// the server still validates ownership and performs queued supersession.
import { parseArgs } from "node:util";
import { scriptArgv } from "./script-argv.mjs";

/** Inspect only canonical queued output from this pinned local-CI invocation. */
export function advanceGateReservationPin(argv, outputTail) {
  if (!/(?:^|[/\\])gate-worktree\.mjs$/.test(argv[0] ?? "")) return { required: false };
  const refuse = (reason) => ({ required: true, valid: false, reason });
  const args = scriptArgv(argv.slice(1));
  let parsed;
  try {
    parsed = parseArgs({ args: scriptArgv(argv.slice(1)), strict: false, allowPositionals: true, tokens: true,
      options: { sha: { type: "string" }, "owner-session-id": { type: "string" }, "resume-lease-id": { type: "string" } } });
  } catch { return refuse("invalid-source-pin"); }
  const pin = parsed.tokens.findLast((token) => token.kind === "option" && token.name === "resume-lease-id");
  if (!pin) return { required: false };
  const sha = parsed.values.sha;
  const owner = parsed.values["owner-session-id"];
  if (!/^[a-f0-9]{40}$/.test(sha ?? "") || !owner || !pin.value) return refuse("invalid-source-pin");
  const expected = `local-ci:${owner}:${sha}`;
  const leases = new Set();
  for (const line of outputTail.split(/\r?\n/)) {
    let packet;
    try { packet = JSON.parse(line); } catch { continue; }
    if (packet?.status !== "queued" || packet?.code !== "local_ci_durable_wait") continue;
    if (packet.resumeMode !== "durable-task" || typeof packet.claimKey !== "string" ||
        !(packet.claimKey === expected || packet.claimKey.startsWith(`${expected}:`)) ||
        typeof packet.leaseId !== "string" || !/^NPEL-[A-Z0-9-]{1,80}$/.test(packet.leaseId) ||
        typeof packet.taskRunId !== "string" || !/^TR-NONPROD-[A-Z0-9-]{1,100}$/.test(packet.taskRunId)) {
      return refuse("source-owner-or-reservation-mismatch");
    }
    leases.add(packet.leaseId);
  }
  if (leases.size !== 1) return refuse(leases.size ? "ambiguous-handoff" : "missing-handoff");
  const [leaseId] = leases;
  const next = [...argv];
  next[pin.index + argv.length - args.length + (pin.inlineValue ? 0 : 1)] = pin.inlineValue ? `--resume-lease-id=${leaseId}` : leaseId;
  return { required: true, valid: true, argv: next, priorLeaseId: pin.value, leaseId };
}
