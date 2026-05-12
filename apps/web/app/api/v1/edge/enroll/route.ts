// POST /api/v1/edge/enroll
//
// First leg of the Edge Node enrollment ceremony per the spec. The Edge
// Node binary posts:
//   - bootstrap-token plaintext (in the JSON body, NOT Authorization)
//   - host metadata (platform, installMode, version, capabilities,
//     host fingerprint, display name)
//
// The Authority Core validates the bootstrap token, creates a
// Principal + PrincipalAlias + EdgeNode (per AGENTS.md §11 Principal
// convergence), consumes the bootstrap token (single-use), and issues
// a `dpfedge_*` node token.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
// (Enrollment ceremony section).

import { NextResponse, type NextRequest } from "next/server";

import { enrollEdgeNode } from "@/lib/edge-nodes/enroll";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const bootstrapTokenPlaintext = payload.bootstrapToken;
  if (typeof bootstrapTokenPlaintext !== "string") {
    return NextResponse.json(
      { ok: false, error: "missing_bootstrap_token" },
      { status: 400 },
    );
  }

  const result = await enrollEdgeNode({
    bootstrapTokenPlaintext,
    displayName: typeof payload.displayName === "string" ? payload.displayName : "",
    platform: payload.platform as "darwin" | "linux" | "win32",
    installMode: payload.installMode as "native" | "container-host" | "container-vm",
    version: typeof payload.version === "string" ? payload.version : "",
    capabilities: Array.isArray(payload.capabilities)
      ? (payload.capabilities as string[]).filter((c) => typeof c === "string")
      : [],
    metadata: (payload.metadata ?? null) as Record<string, unknown> | null,
    hostFingerprint:
      typeof payload.hostFingerprint === "string" ? payload.hostFingerprint : undefined,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      nodeId: result.nodeId,
      principalId: result.principalId,
      trustState: result.trustState,
      nodeToken: {
        // Plaintext returned exactly once. The Edge Node binary stores
        // this in OS-native secure storage (Keychain / Credential
        // Manager / libsecret) per the spec's security-review red lines.
        token: result.nodeToken.plaintext,
        prefix: result.nodeToken.prefix,
        expiresAt: result.nodeToken.expiresAt.toISOString(),
        scopes: result.nodeToken.scopes,
      },
    },
    { status: 201 },
  );
}
