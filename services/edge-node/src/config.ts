// Edge Node configuration — env-var driven.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
//   § Edge Node lifecycle, § Token namespaces and lifecycle.
//
// Required:
//   DPF_AUTHORITY_URL    where to reach the Authority Core, e.g.
//                        http://host.docker.internal:3000
//
// Required at FIRST run only (subsequent runs read state from disk):
//   DPF_BOOTSTRAP_TOKEN  one-time enrollment token issued by an operator
//                        via Admin > Platform Development. Discarded
//                        from process memory immediately after enrollment.
//
// Optional:
//   DPF_EDGE_NODE_NAME   operator-friendly name for this node.
//                        Default: hostname.
//   DPF_EDGE_STATE_DIR   where to persist enrollment state. Default:
//                        /var/lib/dpf-edge-node (set in Dockerfile).
//   DPF_PLATFORM_OVERRIDE  override platform detection (mainly for tests).
//   DPF_INSTALL_MODE     native | container-host | container-vm.
//                        Default: container-host (Phase 0 deployment mode).
//   DPF_EDGE_NODE_VERSION  agent version string. Set at build time.
//
// The federation-candidate scan loop reads its own environment, the way the
// metrics loop reads SNMP_TARGET: see `resolveFederationScanSettings` in
// src/federation-scan.ts for DPF_FEDERATION_SCAN, _HOSTS, _ENDPOINTS,
// _INTERVAL_SEC and _MAX_TARGETS.

import { hostname } from "node:os";

import { z } from "zod";

const ConfigSchema = z.object({
  authorityUrl: z.string().url(),
  edgeNodeName: z.string().min(1).max(200),
  stateDir: z.string().min(1),
  platform: z.enum(["darwin", "win32", "linux"]),
  installMode: z.enum(["native", "container-host", "container-vm"]),
  version: z.string().min(1),
  // Bootstrap token is OPTIONAL because subsequent runs use the state
  // file's nodeToken. Only the first run needs the bootstrap token.
  bootstrapToken: z.string().optional(),
});

export type EdgeNodeConfig = z.infer<typeof ConfigSchema>;

const SUPPORTED_PLATFORMS = new Set(["darwin", "win32", "linux"]);

function detectPlatform(): "darwin" | "win32" | "linux" {
  const override = process.env.DPF_PLATFORM_OVERRIDE;
  if (override && SUPPORTED_PLATFORMS.has(override)) {
    return override as "darwin" | "win32" | "linux";
  }
  const p = process.platform;
  if (SUPPORTED_PLATFORMS.has(p)) {
    return p as "darwin" | "win32" | "linux";
  }
  // Phase 0 supports only the three above. The Edge Node refuses to
  // start on anything else rather than guessing.
  throw new Error(
    `Unsupported platform: ${process.platform}. ` +
      `Set DPF_PLATFORM_OVERRIDE if you know what you're doing.`,
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): EdgeNodeConfig {
  const parsed = ConfigSchema.safeParse({
    authorityUrl: env.DPF_AUTHORITY_URL,
    edgeNodeName: env.DPF_EDGE_NODE_NAME ?? hostname(),
    stateDir: env.DPF_EDGE_STATE_DIR ?? "/var/lib/dpf-edge-node",
    platform: env.DPF_PLATFORM_OVERRIDE ?? detectPlatform(),
    installMode: env.DPF_INSTALL_MODE ?? "container-host",
    version: env.DPF_EDGE_NODE_VERSION ?? "0.1.0",
    bootstrapToken: env.DPF_BOOTSTRAP_TOKEN,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Edge Node config invalid:\n${issues}`);
  }

  return parsed.data;
}
