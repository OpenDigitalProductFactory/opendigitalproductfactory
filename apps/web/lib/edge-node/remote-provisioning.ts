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
// Two paths are rendered:
//
//   - the CONTAINER path — fetch the standalone compose file by URL and
//     `docker compose up`. Full discovery fidelity on Linux via host networking;
//     on Docker Desktop it enrols and proves the path but cannot see the host's
//     real LAN.
//   - the NATIVE path — download the signed Go binary for the host, verify it
//     against the release's published SHA-256 manifest, then run it. This is the
//     full-LAN-fidelity path on Windows and macOS.
//
// The native path is rendered ONLY for assets the caller proves are present on
// the release (`nativeRelease.assetNames`). This module used to gate it on a
// hardcoded "not published yet" comment, which went stale the day
// publish-release.yml began attaching the binaries — the portal then withheld a
// download that had existed for weeks, and on Windows/macOS offered only the
// Docker path that cannot see the LAN. Deriving availability from the release
// itself is what stops that recurring (BI-BB919901).
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

/** The SHA-256 manifest published alongside the native binaries. */
export const NATIVE_CHECKSUMS_ASSET = "dpf-edge-node-checksums.sha256";

/**
 * Native build targets and the release asset each is published as.
 *
 * services/edge-node-go/Makefile cross-compiles all six. WHICH of them a given
 * release actually carries is deliberately not encoded here — it is read off the
 * release, because a second hardcoded list is exactly what went stale before.
 */
export const NATIVE_ASSET_BY_TARGET = {
  "linux-amd64": "dpf-edge-node-linux-amd64",
  "linux-arm64": "dpf-edge-node-linux-arm64",
  "darwin-amd64": "dpf-edge-node-darwin-amd64",
  "darwin-arm64": "dpf-edge-node-darwin-arm64",
  "windows-amd64": "dpf-edge-node-windows-amd64.exe",
  "windows-arm64": "dpf-edge-node-windows-arm64.exe",
} as const;

export type EdgeNativeTarget = keyof typeof NATIVE_ASSET_BY_TARGET;

/** Preference order per OS; the first target whose asset exists is offered. */
const NATIVE_TARGETS_BY_OS: Record<EdgeHostOs, readonly EdgeNativeTarget[]> = {
  linux: ["linux-amd64", "linux-arm64"],
  macos: ["darwin-arm64", "darwin-amd64"],
  windows: ["windows-amd64", "windows-arm64"],
};

/**
 * What the caller knows about the release the binary would come from.
 *
 * `assetNames` is the literal list of files attached to that release. An empty
 * list — or an omitted `nativeRelease` — renders NO native command, which is the
 * correct degraded state for an air-gapped install or an unreachable GitHub. The
 * rule is never to hand an operator a command that 404s, and reading the release
 * is how that rule is kept without freezing a belief in a comment.
 */
export interface NativeReleaseAssets {
  tag: string;
  assetNames: readonly string[];
  repoSlug?: string;
}

/** The native target to offer for this OS, or null when none is published. */
export function resolveNativeTarget(
  os: EdgeHostOs,
  assetNames: readonly string[],
): EdgeNativeTarget | null {
  const available = new Set(assetNames);
  for (const target of NATIVE_TARGETS_BY_OS[os]) {
    if (available.has(NATIVE_ASSET_BY_TARGET[target])) return target;
  }
  return null;
}

/** True when the release also publishes the checksum manifest. */
export function hasChecksumManifest(assetNames: readonly string[]): boolean {
  return assetNames.includes(NATIVE_CHECKSUMS_ASSET);
}

function releaseAssetUrl(repoSlug: string, tag: string, asset: string): string {
  return `https://github.com/${repoSlug}/releases/download/${encodeURIComponent(tag)}/${asset}`;
}

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
 * Render the native download-verify-run command for one target.
 *
 * Three properties this deliberately keeps:
 *
 *  - the download is CHECKSUM-VERIFIED against the release's own manifest
 *    before anything executes. A one-line installer that pipes an unverified
 *    binary into a shell is the supply-chain shape every published guidance
 *    warns about; the manifest is already produced by publish-release.yml, so
 *    verifying costs one extra fetch.
 *  - the asset keeps its published FILENAME, because the checksum manifest is
 *    keyed on it. Renaming to a friendly name breaks `-c` verification.
 *  - the bootstrap token is passed as an ENVIRONMENT VARIABLE rather than an
 *    argv flag, following Tailscale's auth-key guidance. The token is single-use
 *    so the exposure is bounded either way, but argv is visible to every other
 *    process on the host while it runs, and env assignment is not.
 */
export function renderNativeInstallCommand(input: {
  authorityUrl: string;
  bootstrapToken: string;
  os: EdgeHostOs;
  target: EdgeNativeTarget;
  release: NativeReleaseAssets;
  nodeName?: string;
}): RenderedInstallCommand {
  const repoSlug = input.release.repoSlug?.trim() || DEFAULT_REPO_SLUG;
  const asset = NATIVE_ASSET_BY_TARGET[input.target];
  const binaryUrl = releaseAssetUrl(repoSlug, input.release.tag, asset);
  const checksumUrl = releaseAssetUrl(repoSlug, input.release.tag, NATIVE_CHECKSUMS_ASSET);
  const verifiable = hasChecksumManifest(input.release.assetNames);
  const nodeName = input.nodeName?.trim();

  if (input.os === "windows") {
    const lines = [
      `Invoke-WebRequest -UseBasicParsing ${psQuote(binaryUrl)} -OutFile ${psQuote(asset)}`,
      ...(verifiable
        ? [
            `Invoke-WebRequest -UseBasicParsing ${psQuote(checksumUrl)} -OutFile ${psQuote(NATIVE_CHECKSUMS_ASSET)}`,
            `$expected = ((Select-String -Path ${psQuote(NATIVE_CHECKSUMS_ASSET)} -SimpleMatch ${psQuote(asset)}).Line -split '\s+')[0]`,
            `$actual = (Get-FileHash ${psQuote(asset)} -Algorithm SHA256).Hash.ToLower()`,
            `if ($actual -ne $expected) { throw "Checksum mismatch - do not run this file." }`,
          ]
        : []),
      `$env:DPF_AUTHORITY_URL = ${psQuote(input.authorityUrl)}`,
      `$env:DPF_BOOTSTRAP_TOKEN = ${psQuote(input.bootstrapToken)}`,
      ...(nodeName ? [`$env:DPF_EDGE_NODE_NAME = ${psQuote(nodeName)}`] : []),
      `.\\${asset} --preflight`,
      `.\\${asset}`,
    ];
    return {
      id: `windows-native-${input.target}`,
      label: "Windows — native agent (real LAN)",
      kind: "native",
      worksToday: true,
      shell: "powershell",
      command: lines.join("\n"),
      note: verifiable
        ? "Sees the host's real NICs, unlike the Docker Desktop path. The download is checked against the release's published SHA-256 before it runs, and --preflight reports a named cause if it cannot reach the Authority."
        : "Sees the host's real NICs, unlike the Docker Desktop path. This release published no checksum manifest, so the download is NOT verified — prefer a release that carries one.",
    };
  }

  const envInline = [
    `DPF_AUTHORITY_URL=${shQuote(input.authorityUrl)}`,
    `DPF_BOOTSTRAP_TOKEN=${shQuote(input.bootstrapToken)}`,
    ...(nodeName ? [`DPF_EDGE_NODE_NAME=${shQuote(nodeName)}`] : []),
  ].join(" ");
  const shaTool = input.os === "macos" ? "shasum -a 256" : "sha256sum";
  const lines = [
    `curl -fsSL -o ${shQuote(asset)} ${shQuote(binaryUrl)}`,
    ...(verifiable
      ? [
          `curl -fsSL -o ${shQuote(NATIVE_CHECKSUMS_ASSET)} ${shQuote(checksumUrl)}`,
          `${shaTool} --ignore-missing -c ${shQuote(NATIVE_CHECKSUMS_ASSET)}`,
        ]
      : []),
    `chmod +x ${shQuote(asset)}`,
    `${envInline} ./${asset} --preflight`,
    `${envInline} ./${asset}`,
  ];
  return {
    id: `${input.os}-native-${input.target}`,
    label: input.os === "macos" ? "macOS — native agent (real LAN)" : "Linux — native agent",
    kind: "native",
    worksToday: true,
    shell: "bash",
    command: lines.join(" && \\\n"),
    note: verifiable
      ? "Sees the host's real NICs, unlike the Docker Desktop path. The download is checked against the release's published SHA-256 before it runs, and --preflight reports a named cause if it cannot reach the Authority."
      : "Sees the host's real NICs. This release published no checksum manifest, so the download is NOT verified — prefer a release that carries one.",
  };
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
  /** Present = offer the native path first, for targets this release publishes. */
  nativeRelease?: NativeReleaseAssets;
}): RenderedInstallCommand[] {
  const { authorityUrl, bootstrapToken, os } = input;
  const repoSlug = input.repoSlug?.trim() || DEFAULT_REPO_SLUG;
  const composeRef = input.composeRef?.trim() || DEFAULT_COMPOSE_REF;
  const nodeName = input.nodeName?.trim();
  const composeUrl = rawComposeUrl(repoSlug, composeRef);

  // The native command leads when the release publishes an asset for this host:
  // on Windows and macOS it is the only path that sees the real LAN, so burying
  // it under the container command is what made the good path invisible.
  const nativeTarget = input.nativeRelease
    ? resolveNativeTarget(os, input.nativeRelease.assetNames)
    : null;
  const native: RenderedInstallCommand[] =
    nativeTarget && input.nativeRelease
      ? [
          renderNativeInstallCommand({
            authorityUrl,
            bootstrapToken,
            os,
            target: nativeTarget,
            release: input.nativeRelease,
            ...(nodeName ? { nodeName } : {}),
          }),
        ]
      : [];

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
      ...native,
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
      ...native,
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
    ...native,
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

/** Shown when this release publishes no native asset for the chosen host. */
const NATIVE_BINARY_UNAVAILABLE_NOTE =
  "No native agent is published for this system, so only the container command is offered. On Docker Desktop that enrols the node but cannot see the real LAN.";

/** Shown when the native path IS offered. */
const NATIVE_BINARY_AVAILABLE_NOTE =
  "The native agent sees the real network, which a Docker Desktop container cannot. Its download is checksum-verified, and `--preflight` names any connection problem.";

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
  /** Release assets resolved by the caller. Omit for air-gapped / offline. */
  nativeRelease?: NativeReleaseAssets;
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
    ...(input.nativeRelease ? { nativeRelease: input.nativeRelease } : {}),
  });
  const offeredNative = commands.some((command) => command.kind === "native");
  return {
    authorityUrl,
    authorityUrlIssues: issues,
    os: input.os,
    commands,
    approveHint:
      "The node enrolls as pending. Approve it here on this Edge Nodes page; it submits its first discovery run within one sweep interval (~5 min).",
    nativeBinaryNote: offeredNative
      ? NATIVE_BINARY_AVAILABLE_NOTE
      : NATIVE_BINARY_UNAVAILABLE_NOTE,
  };
}
