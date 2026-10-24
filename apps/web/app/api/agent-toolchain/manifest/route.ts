// @exposure public — the signed agent-toolchain manifest. A client whose credential is stale must still be able to repair; it carries no secret.
// GET /api/agent-toolchain/manifest
//
// BI-52934B3E (design docs/superpowers/specs/2026-10-07-agent-toolchain-release-delivery-design.md §5.1).
// Pack version, delivered digest, archive hash, floor and per-client connector
// shape for the toolchain this image ships, signed by the installation identity.

import { NextResponse } from "next/server";

import { serveToolchain } from "@/lib/agent-toolchain/toolchain-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return serveToolchain(request, ({ manifest }) =>
    NextResponse.json(manifest, { status: 200, headers: { "Cache-Control": "no-cache" } }),
  );
}
