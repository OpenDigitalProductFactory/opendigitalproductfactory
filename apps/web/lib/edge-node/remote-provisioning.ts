// Easy remote Edge Node provisioning — command renderer (pure).
//
// Turns an issued bootstrap token + a reachable Authority URL into a
// ready-to-run install command for a host on *separate hardware*, so the
// operator never clones the repo or hand-edits a `.env` (BI-D18DD7A9 /
// edge-topology design §8). This module is intentionally pure (no DB, no
// `next/*`, no env reads) so it is exhaustively unit-testable; the server
// action in `lib/actions/edge-nodes.ts` resolves the URL + issues the token
// and calls this.
//
// What works TODAY: the container path — fetch the single standalone compose
// file by URL and `docker compose up` with the Authority URL + token passed
// inline as environment. The signed, downloadable native Go binary (Mode 4,
// the full-LAN-fidelity path on Windows/macOS) is not published for download
// yet; it is surfaced as a note, not a runnable command, so we never hand the
// operator a command that 404s.
//
// Spec: docs/superpowers/specs/2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md §8

export type EdgeHostOs = "linux" | "macos" | "windows";

export const EDGE_HOST_OSES: readonly EdgeHostOs[] = ["linux", "macos", "windows"];

/** Why the resolved Authority URL is unsuitable for a remote host. */
export type AuthorityUrlIssue =
  | "missing" // no URL could be resolved
  | "loopback" // localhost / 127.* / ::1 / 0.0.0.0 / host.docker.internal — unreachable from another machine
  | "insecure-http"; // plain HTTP — tokens are sniffable on a shared LAN (advisory, not fatal)

export const DEFAULT_REPO_SLUG = "OpenDigitalProductFactory/opendigitalproductfactory";
export const DEFAULT_COMPOSE_REF = "main";
const STANDALONE_COMPOSE_FILE = "docker-compose.edge-standalone.yml";

export interface RenderedInstallCommand {
  /** Stable id for UI keys / telemetry. */
  id: string;
  /** Human label, e.g. "Linux — Docker (real LAN)". */
  label: string;
  kind: "container" | "native";
  /** Whether this command runs end-to-end today (false = build-from-source / not yet downloadable). */
  worksToday: boolean;
  shell: "bash" | "powershell";
  /** The ready-to-run command with the Authority URL + token already substituted. */
  command: string;
  /** Caveats the operator must see (e.g. degraded discovery on Docker Desktop). */
  note?: string;
}

export interface RemoteProvisioningPlan {
  /** The Authority URL baked into the commands (best-resolved; may still carry issues). */
  authorityUrl: string;
  /** Empty = good to go. Non-empty = surface a warning; commands are still rendered. */
  authorityUrlIssues: AuthorityUrlIssue[];
  os: EdgeHostOs;
  commands: RenderedInstallCommand[];
  /** One-line reminder that a remote node lands `pending` and needs Approve. */
  approveHint: string;
  /** Why the full-fidelity native binary isn't a one-click download yet. */
  nativeBinaryNote: string;
}

const LOOPBACK_HOSTS = new Set([
  "localhost",
  "0.0.0.0",
  "host.docker.internal",
  "::1",
  "[::1]",
]);

/**
 * True when `url`'s host is not reachable from a *different* machine — the
 * single most common remote-provisioning footgun (the multi-host runbook
 * warns about exactly this). Covers localhost, the 127/8 loopback block,
 * IPv6 ::1, 0.0.0.0, and Docker Desktop's host.docker.internal alias.
 * Private LAN ranges (10/8, 172.16/12, 192.168/16) and mDNS `*.local` are
 * NOT loopback — they are the intended remote targets.
 */
export function isLoopbackAuthorityUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false; // unparseable — let assessAuthorityUrl flag "missing" instead
  }
  if (LOOPBACK_HOSTS.has(host)) return true;
  if (host.startsWith("127.")) return true;
  return false;
}

/**
 * Assess a resolved base URL for remote use. Returns the URL to bake in
 * (trailing slash stripped) plus any issues. A loopback or missing URL is
 * flagged but NOT thrown — the operator may still want the rendered command
 * with the right host swapped in, and the UI can prompt for a reachable URL.
 */
export function assessAuthorityUrl(resolved: string | null | undefined): {
  url: string;
  issues: AuthorityUrlIssue[];
} {
  const issues: AuthorityUrlIssue[] = [];
  const trimmed = resolved?.trim().replace(/\/+$/, "") ?? "";
  if (!trimmed) {
    return { url: "", issues: ["missing"] };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { url: "", issues: ["missing"] };
  }
  if (isLoopbackAuthorityUrl(trimmed)) issues.push("loopback");
  if (parsed.protocol === "http:") issues.push("insecure-http");
  return { url: trimmed, issues };
}

/** Single-quote a value for safe interpolation into a POSIX `sh` command. */
function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Quote a value for a PowerShell single-quoted string literal. */
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function rawComposeUrl(repoSlug: string, composeRef: string): string {
  return `https://raw.githubusercontent.com/${repoSlug}/${composeRef}/${STANDALONE_COMPOSE_FILE}`;
}

/**
 * Render the install command(s) for one host OS. The container path is the
 * works-today, no-clone path for every OS; on macOS/Windows it enrolls and
 * proves the path but Docker Desktop can't see the real LAN (the native
 * binary closes that gap — see `nativeBinaryNote`).
 */
export function renderEdgeInstallCommands(input: {
  authorityUrl: string;
  bootstrapToken: string;
  os: EdgeHostOs;
  nodeName?: string;
  repoSlug?: string;
  composeRef?: string;
}): RenderedInstallCommand[] {
  const { authorityUrl, bootstrapToken, os } = input;
  const repoSlug = input.repoSlug?.trim() || DEFAULT_REPO_SLUG;
  const composeRef = input.composeRef?.trim() || DEFAULT_COMPOSE_REF;
  const nodeName = input.nodeName?.trim();
  const composeUrl = rawComposeUrl(repoSlug, composeRef);

  if (os === "windows") {
    // PowerShell: download the compose file, set env for this process, bring it up.
    const lines = [
      `Invoke-WebRequest -UseBasicParsing ${psQuote(composeUrl)} -OutFile ${psQuote(STANDALONE_COMPOSE_FILE)}`,
      `$env:DPF_AUTHORITY_URL = ${psQuote(authorityUrl)}`,
      `$env:DPF_BOOTSTRAP_TOKEN = ${psQuote(bootstrapToken)}`,
      ...(nodeName ? [`$env:DPF_EDGE_NODE_NAME = ${psQuote(nodeName)}`] : []),
      `docker compose -f ${STANDALONE_COMPOSE_FILE} up -d`,
    ];
    return [
      {
        id: "windows-container",
        label: "Windows — Docker Desktop (enrollment proof)",
        kind: "container",
        worksToday: true,
        shell: "powershell",
        command: lines.join("\n"),
        note:
          "Docker Desktop runs the node inside its Linux VM, so it enrolls and proves the path but cannot see the host's real LAN. The native Windows service (Mode 4) is the full-LAN path — see below.",
      },
    ];
  }

  // Linux + macOS: a single POSIX one-liner. No repo clone, no .env edit —
  // the Authority URL + token are passed inline as environment to compose.
  const envInline = [
    `DPF_AUTHORITY_URL=${shQuote(authorityUrl)}`,
    `DPF_BOOTSTRAP_TOKEN=${shQuote(bootstrapToken)}`,
    ...(nodeName ? [`DPF_EDGE_NODE_NAME=${shQuote(nodeName)}`] : []),
  ].join(" ");
  const command =
    `curl -fsSL ${shQuote(composeUrl)} -o ${STANDALONE_COMPOSE_FILE} && \\\n` +
    `${envInline} \\\n` +
    `docker compose -f ${STANDALONE_COMPOSE_FILE} up -d`;

  if (os === "macos") {
    return [
      {
        id: "macos-container",
        label: "macOS — Docker Desktop (enrollment proof)",
        kind: "container",
        worksToday: true,
        shell: "bash",
        command,
        note:
          "Docker Desktop runs the node inside its Linux VM, so it enrolls and proves the path but cannot see the Mac's real LAN. The native macOS LaunchDaemon (Mode 4) is the full-LAN path — see below.",
      },
    ];
  }

  return [
    {
      id: "linux-container",
      label: "Linux — Docker (real LAN)",
      kind: "container",
      worksToday: true,
      shell: "bash",
      command,
      note:
        "Native Docker Engine on Linux (not Docker Desktop) sees the host's real NICs via the compose file's host-network mode — full discovery fidelity.",
    },
  ];
}

const NATIVE_BINARY_NOTE =
  "Full-fidelity LAN discovery on Windows/macOS needs the native Mode 4 binary (services/edge-node-go), which sees the host's real NICs. A signed, one-click download is not published yet — until it ships, build it with `make build` from services/edge-node-go, or use the container command above to prove enrollment. Tracked under EP-EDGE-TOPOLOGY.";

/**
 * Compose a full remote-provisioning plan: assess the URL, render the
 * command(s) for the chosen OS, and attach the operator reminders. The
 * caller (server action) supplies an already-issued token and a resolved
 * Authority URL.
 */
export function buildRemoteProvisioningPlan(input: {
  resolvedAuthorityUrl: string | null | undefined;
  bootstrapToken: string;
  os: EdgeHostOs;
  nodeName?: string;
  repoSlug?: string;
  composeRef?: string;
}): RemoteProvisioningPlan {
  const { url, issues } = assessAuthorityUrl(input.resolvedAuthorityUrl);
  // Render against the resolved URL when we have one; otherwise a clearly
  // bogus placeholder so the command shows the shape and the UI's "set a
  // reachable URL" warning (from `issues`) tells the operator what to fix.
  const authorityUrl = url || "https://<your-portal-host>:3000";
  const commands = renderEdgeInstallCommands({
    authorityUrl,
    bootstrapToken: input.bootstrapToken,
    os: input.os,
    ...(input.nodeName ? { nodeName: input.nodeName } : {}),
    ...(input.repoSlug ? { repoSlug: input.repoSlug } : {}),
    ...(input.composeRef ? { composeRef: input.composeRef } : {}),
  });
  return {
    authorityUrl,
    authorityUrlIssues: issues,
    os: input.os,
    commands,
    approveHint:
      "The node enrolls as pending. Approve it here on this Edge Nodes page; it submits its first discovery run within one sweep interval (~5 min).",
    nativeBinaryNote: NATIVE_BINARY_NOTE,
  };
}
