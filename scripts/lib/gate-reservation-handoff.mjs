// BI-EB864226: only the reservation pin advances. The source and actor do not.
// This is a child-controller handoff, never authority to release a lease:
// the server still validates ownership and performs queued supersession.

function lastOption(argv, name) {
  let result;
  const end = argv.indexOf("--");
  for (let i = 1; i < (end < 0 ? argv.length : end); i++) {
    if (argv[i] === name) result = { index: i + 1, value: argv[i + 1], equals: false };
    else if (argv[i].startsWith(`${name}=`)) result = { index: i, value: argv[i].slice(name.length + 1), equals: true };
  }
  return result;
}

/** Inspect only canonical queued output from this pinned local-CI invocation. */
export function advanceGateReservationPin(argv, outputTail) {
  const pin = lastOption(argv, "--resume-lease-id");
  if (!/(?:^|[/\\])gate-worktree\.mjs$/.test(argv[0] ?? "") || !pin) return { required: false };
  const sha = lastOption(argv, "--sha")?.value;
  const owner = lastOption(argv, "--owner-session-id")?.value;
  const refuse = (reason) => ({ required: true, valid: false, reason });
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
  next[pin.index] = pin.equals ? `--resume-lease-id=${leaseId}` : leaseId;
  return { required: true, valid: true, argv: next, priorLeaseId: pin.value, leaseId };
}
