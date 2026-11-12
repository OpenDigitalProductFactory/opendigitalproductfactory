// BI-30EDDB7F — how an item's home names a claim it holds for a peer.
//
// The home records a peer's claim as an ordinary Workroom whose executor is the
// requesting installation (spec 2026-10-27 §5.2 step 2). The executorRef says
// which installation and which of its Workrooms, so the home's work page can
// publish the holder and the requester can recognise its own claim.

const PREFIX = "federation:";

export interface FederatedPeerExecutor {
  installationId: string;
  workroomId: string;
}

export const federatedPeerExecutorRef = {
  format(value: FederatedPeerExecutor): string {
    return `${PREFIX}${value.installationId}:${value.workroomId}`;
  },
  parse(value: string | null | undefined): FederatedPeerExecutor | null {
    if (!value?.startsWith(PREFIX)) return null;
    const rest = value.slice(PREFIX.length);
    const split = rest.indexOf(":");
    if (split <= 0 || split === rest.length - 1) return null;
    return { installationId: rest.slice(0, split), workroomId: rest.slice(split + 1) };
  },
};

/** The worktree path a peer's claim records: the work happens on the peer. */
export function federatedPeerWorktreePath(value: FederatedPeerExecutor): string {
  return `federation://${value.installationId}/${value.workroomId}`;
}
