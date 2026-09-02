// EP-ZERO-CONFIG-FEDERATION §5.7 — one health line for backlog sync.
//
// Nobody saw "Waiting for first copy" for five days because it lived on a
// panel a person has to open. This module turns the raw facts about the
// same-organization connections into exactly one of three sentences, the same
// sentence wherever it is shown (cockpit, MCP briefing, Delivery Flow):
//   In step …            — every connection pulled successfully within the cadence
//   Behind by …          — a connection has pulled before but not lately
//   Broken because …     — the last pull was refused, or nothing ever arrived,
//                          and the sentence says why and what happens next
// Pure and total: no I/O, no clock reads; callers pass `now`.

export const WORK_SYNC_CADENCE_MS = 5 * 60 * 1000;
/** Behind = no successful pull for more than this many cadences. */
export const WORK_SYNC_BEHIND_AFTER_CYCLES = 2;

export const FEDERATION_HEALTH_STATES = ["no-peer", "in-step", "behind", "broken"] as const;
export type FederationHealthState = (typeof FEDERATION_HEALTH_STATES)[number];

/** What the last pull over one connection reported (persisted by the runner). */
export type WorkSyncPullOutcome = "synced" | "fetch-failed" | "invalid-page" | "identity-mismatch" | "no-token";

export interface FederationLinkHealthInput {
  linkId: string;
  peerLabel: string;
  /** Rows mirrored here from this peer. */
  mirroredItems: number;
  /** Newest successful pull, or null when nothing has ever arrived. */
  lastPullAt: Date | null;
  lastOutcome: WorkSyncPullOutcome | null;
  lastDetail: string | null;
  conflicts: number;
}

export interface FederationHealth {
  state: FederationHealthState;
  /** The one sentence. */
  line: string;
  /** Per-connection detail for surfaces that list connections. */
  links: Array<{ linkId: string; peerLabel: string; state: FederationHealthState; line: string }>;
}

function minutes(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return "under a minute ago";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return `${Math.round(h / 24)} days ago`;
}

function plural(n: number, noun: string): string {
  return `${n.toLocaleString("en-US")} ${noun}${n === 1 ? "" : "s"}`;
}

/** Plain-language cause for a failed pull; the platform's next move is stated, never a human instruction. */
export function describePullFailure(outcome: WorkSyncPullOutcome | null, detail: string | null): string {
  switch (outcome) {
    case "fetch-failed":
      if (detail && /404|does not serve work sync/i.test(detail)) {
        return "the other installation is on a version that predates backlog sync; it upgrades on its own in its next quiet period and this retries every five minutes";
      }
      return `the other installation could not be reached (${detail ?? "no response"}); this retries every five minutes`;
    case "invalid-page":
      return `the other installation sent a page this version cannot read (${detail ?? "unknown field"}); the newer of the two upgrades the other on its next quiet period`;
    case "identity-mismatch":
      return "the other installation now presents a different identity than this connection recorded; the connection is superseded on the next tick";
    case "no-token":
      return "this connection holds no token for the other installation; it re-pairs on the next tick";
    default:
      return detail ? detail : "nothing has arrived yet";
  }
}

export function resolveFederationHealth(input: { links: readonly FederationLinkHealthInput[]; now: Date }): FederationHealth {
  if (input.links.length === 0) {
    return { state: "no-peer", line: "No other installation in the organization is connected.", links: [] };
  }
  const links = input.links.map((link) => {
    const sinceMs = link.lastPullAt ? input.now.getTime() - link.lastPullAt.getTime() : null;
    const conflictNote = link.conflicts > 0 ? ` (${plural(link.conflicts, "id")} left alone because local work uses ${link.conflicts === 1 ? "it" : "them"})` : "";
    if (link.lastOutcome && link.lastOutcome !== "synced") {
      return {
        linkId: link.linkId, peerLabel: link.peerLabel, state: "broken" as const,
        line: `Broken because ${describePullFailure(link.lastOutcome, link.lastDetail)}.`,
      };
    }
    if (sinceMs === null) {
      return {
        linkId: link.linkId, peerLabel: link.peerLabel, state: "broken" as const,
        line: `Broken because nothing has arrived from ${link.peerLabel} yet; this retries every five minutes.`,
      };
    }
    if (sinceMs > WORK_SYNC_CADENCE_MS * WORK_SYNC_BEHIND_AFTER_CYCLES) {
      return {
        linkId: link.linkId, peerLabel: link.peerLabel, state: "behind" as const,
        line: `Behind by ${minutes(sinceMs).replace(" ago", "")}: the last copy from ${link.peerLabel} landed ${minutes(sinceMs)}${conflictNote}.`,
      };
    }
    return {
      linkId: link.linkId, peerLabel: link.peerLabel, state: "in-step" as const,
      line: `In step with ${link.peerLabel}: ${plural(link.mirroredItems, "item")} mirrored here, last copy ${minutes(sinceMs)}${conflictNote}.`,
    };
  });
  const worst = (["broken", "behind", "in-step"] as const).find((s) => links.some((l) => l.state === s)) ?? "in-step";
  const first = links.find((l) => l.state === worst)!;
  const others = links.filter((l) => l.state !== worst).length;
  const totalMirrored = input.links.reduce((n, l) => n + l.mirroredItems, 0);
  let line: string;
  if (links.length === 1) {
    line = first.line;
  } else if (worst === "in-step") {
    line = `In step with ${links.length} installations: ${plural(totalMirrored, "item")} mirrored here.`;
  } else if (others > 0) {
    line = `${first.line} (${others} other connection${others === 1 ? "" : "s"} in step)`;
  } else {
    line = first.line;
  }
  return { state: worst, line, links };
}
