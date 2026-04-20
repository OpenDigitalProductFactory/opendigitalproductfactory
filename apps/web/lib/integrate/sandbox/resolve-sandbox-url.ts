// apps/web/lib/integrate/sandbox/resolve-sandbox-url.ts
//
// Single source of truth for resolving sandbox container URLs. Previously
// inlined in apps/web/app/api/sandbox/preview/route.ts and reimplemented
// piecemeal in mcp-tools.ts (`http://localhost:${port}`). Both the browser-
// use MCP client (inside the compose network) and the UI preview card (on
// the host) need this.
//
// Two distinct URLs exist for every sandbox:
//  - `internal` — reachable from other containers on the compose network
//    (e.g. `http://sandbox:3000`). Used by the portal server, the
//    browser-use container, and the Inngest verification worker.
//  - `host` — reachable from the user's real browser on the host machine
//    (e.g. `http://localhost:3035`). Used by the PreviewUrlCard when we
//    tell the user "open this URL in a new tab".
//
// Selection: if SANDBOX_PREVIEW_URL is set in the environment, we are
// running inside the compose network and internal routing is available.
// In local `pnpm dev`, the portal runs on the host and both URLs collapse
// to `http://localhost:<hostPort>`.

const CONTAINER_TO_SERVICE: Record<string, string> = {
  "dpf-sandbox-1": "sandbox",
  "dpf-sandbox-2-1": "sandbox-2",
  "dpf-sandbox-3-1": "sandbox-3",
};

const CONTAINER_TO_HOST_PORT: Record<string, number> = {
  "dpf-sandbox-1": 3035,
  "dpf-sandbox-2-1": 3037,
  "dpf-sandbox-3-1": 3038,
};

const SANDBOX_INTERNAL_PORT = 3000;

export type ResolvedSandboxUrl = {
  /** URL reachable from other containers on the docker compose network. */
  internal: string;
  /** URL reachable from the user's browser on the host machine. */
  host: string;
};

/**
 * Resolves the internal and host-facing URLs for a sandbox container.
 *
 * @param sandboxId — Docker container ID (e.g. "dpf-sandbox-1")
 * @param hostPort — host-mapped port from `FeatureBuild.sandboxPort`; used
 *                  as a fallback when the container ID isn't in the known
 *                  pool map.
 */
export function resolveSandboxUrl(
  sandboxId: string,
  hostPort: number,
): ResolvedSandboxUrl {
  const isInsideCompose = !!process.env.SANDBOX_PREVIEW_URL;

  const service = CONTAINER_TO_SERVICE[sandboxId] ?? sandboxId;
  const mappedHostPort = CONTAINER_TO_HOST_PORT[sandboxId] ?? hostPort;

  return {
    internal: isInsideCompose
      ? `http://${service}:${SANDBOX_INTERNAL_PORT}`
      : `http://localhost:${mappedHostPort}`,
    host: `http://localhost:${mappedHostPort}`,
  };
}
