// BI-E7974C18 — the plain-words view of the agent clients connected to this
// install (design 2026-10-07-agent-toolchain-release-delivery §5.2c). One
// source for the release notification and the /ops/self-upgrade section, so
// both name clients and verdicts the same way.

import {
  DEFAULT_SURFACE_STALE_AFTER_MS,
  getToolchainCopies,
  type ToolchainCopyRollup,
} from "./fleet-readiness";
import type { PublishedToolchain } from "./toolchain-verdict";

export type ClientStanding = ToolchainCopyRollup["verdict"];

const CLIENT_NAMES: Readonly<Record<string, string>> = Object.freeze({
  "claude-code": "Claude Code",
  codex: "Codex",
  grok: "Grok",
  antigravity: "Antigravity",
});

export type ConnectedClientRow = {
  credentialRef: string;
  /** Product name (Claude Code, Codex…), or null when unidentified. */
  product: string | null;
  /** True when the product name comes only from a User-Agent hint. */
  probable: boolean;
  authMode: ToolchainCopyRollup["copies"][number]["authMode"];
  standing: ClientStanding;
  /** The pack version its newest connection loaded, or null when it did not say. */
  loadedVersion: string | null;
  /** Short fingerprint of the exact files loaded, or null when it did not say. */
  loadedFingerprint: string | null;
  lastSeen: Date;
  /** True when a copy it uses is not the released pack (any copy seen this week, else its newest). */
  behind: boolean;
  /** Why it is behind, in plain words (BI-81AB897A E2); empty when current. */
  reasons: string[];
  /** How the host's convergence agent last fared, or null when the connection did not say (BI-3E66F76F). */
  hostAgent: ToolchainCopyRollup["copies"][number]["hostAgent"];
};

export type ConnectedClientsView = {
  release: { packVersion: string; fingerprint: string } | null;
  clients: ConnectedClientRow[];
  truncated: boolean;
};

/** Product name for a credential; a User-Agent hint only labels, never decides. */
export function clientProduct(rollup: Pick<ToolchainCopyRollup, "clientKind" | "probableClient">): { product: string | null; probable: boolean } {
  const declared = CLIENT_NAMES[rollup.clientKind];
  if (declared) return { product: declared, probable: false };
  const hinted = rollup.probableClient ? CLIENT_NAMES[rollup.probableClient] ?? rollup.probableClient : null;
  return { product: hinted, probable: hinted !== null };
}

/** English name for stored notification text (the page localizes its own). */
export function clientDisplayName(row: Pick<ConnectedClientRow, "product" | "probable">): string {
  if (!row.product) return "Unidentified client";
  return row.probable ? `${row.product} (probably)` : row.product;
}

/** Pure: one row per credential, newest connection first. */
export function toConnectedClientRows(rollups: ToolchainCopyRollup[]): ConnectedClientRow[] {
  const rows = rollups.map((rollup) => {
    const newest = rollup.copies.reduce((a, b) => (b.lastObservedAt > a.lastObservedAt ? b : a));
    const declared = newest.loadedDigest !== "undeclared";
    const recent = rollup.copies.filter((copy) => !copy.silent);
    const considered = recent.length > 0 ? recent : [newest];
    const behind = considered.some((copy) => copy.verdict !== "current");
    const reasons = [...new Set(considered.flatMap((copy) => copy.reasons))];
    return {
      credentialRef: rollup.credentialRef,
      ...clientProduct(rollup),
      authMode: newest.authMode,
      standing: rollup.verdict,
      loadedVersion: declared ? newest.loadedPackVersion : null,
      loadedFingerprint: declared ? newest.loadedDigest.slice(0, 12) : null,
      lastSeen: newest.lastObservedAt,
      behind,
      reasons,
      hostAgent: newest.hostAgent,
    };
  });
  return rows.sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
}

/** The MCP endpoint this install names when no request is in hand (boot, page render). */
export function configuredMcpEndpoint(): string {
  const origin = (process.env.NEXT_PUBLIC_BASE_URL || process.env.PUBLIC_URL || "https://localhost").replace(/\/+$/, "");
  return `${origin}/api/mcp/v1`;
}

type ObservationDb = Parameters<typeof getToolchainCopies>[0];

/** Read one page of connected clients against the released pack. */
export async function buildConnectedClientsView(
  db: ObservationDb,
  input: { published: PublishedToolchain | null; mcpEndpoint: string; now: Date },
): Promise<ConnectedClientsView> {
  if (!input.published) return { release: null, clients: [], truncated: false };
  const { credentials, truncated } = await getToolchainCopies(db, {
    published: input.published,
    mcpEndpoint: input.mcpEndpoint,
    now: input.now,
    staleAfterMs: DEFAULT_SURFACE_STALE_AFTER_MS,
  });
  return {
    release: { packVersion: input.published.packVersion, fingerprint: input.published.packDigest.slice(0, 12) },
    clients: toConnectedClientRows(credentials),
    truncated,
  };
}

/** Page loader for /ops/self-upgrade. The caller treats a throw as "unavailable". */
export async function loadConnectedAgentClients(now: Date = new Date()): Promise<ConnectedClientsView> {
  const [{ prisma }, { getPublishedToolchain }] = await Promise.all([import("@dpf/db"), import("./served-toolchain")]);
  return buildConnectedClientsView(prisma as never, { published: getPublishedToolchain(), mcpEndpoint: configuredMcpEndpoint(), now });
}

/** Same current human view authority as the operations page; never a write grant. */
export async function canViewConnectedClients(userId: string): Promise<boolean> {
  const [{ currentUserContext }, { can }] = await Promise.all([
    import("@/lib/govern/current-user-context"), import("@/lib/permissions"),
  ]);
  const user = await currentUserContext(userId);
  return !!user && can(user, "view_operations");
}

/** Explicit allowlist for model context. Never serialize credential or host identities. */
export function connectedClientsPromptFacts(view: ConnectedClientsView | null) {
  if (!view?.release) return {
    status: "unavailable",
    reason: view ? "No published agent tool pack is available." : "Connected-client health could not be read.",
    nextRoute: "/ops/self-upgrade",
  };
  return {
    status: "available",
    release: { packVersion: view.release.packVersion, fingerprint: view.release.fingerprint },
    current: view.clients.filter((row) => row.standing === "current").length,
    total: view.clients.length,
    truncated: view.truncated,
    scope: "One bounded page of observed clients; silent or undeclared clients are not confirmed current.",
    clients: view.clients.map((row) => ({
      name: clientDisplayName(row), standing: row.standing,
      loadedVersion: row.loadedVersion, loadedFingerprint: row.loadedFingerprint,
      lastSeen: row.lastSeen.toISOString(), authMode: row.authMode,
      behind: row.behind, reasons: row.reasons,
      hostAgentStatus: row.hostAgent?.status ?? null,
      hostAgentSince: row.hostAgent?.since?.toISOString() ?? null,
    })),
    meaning: "Behind compares the loaded tool pack with the released version and fingerprint. It does not by itself establish an LLM provider, background-job, or security failure.",
    nextRoute: "/ops/self-upgrade",
  };
}
