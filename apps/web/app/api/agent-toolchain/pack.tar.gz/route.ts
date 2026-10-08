// @exposure public — the open-source dpf-platform pack this image ships, as a byte-stable archive. No secret.
// GET /api/agent-toolchain/pack.tar.gz
//
// BI-52934B3E (design docs/superpowers/specs/2026-10-07-agent-toolchain-release-delivery-design.md §5.1).
// sha256 of these bytes equals the signed manifest's archiveSha256.

import { serveToolchain } from "@/lib/agent-toolchain/toolchain-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return serveToolchain(
    request,
    ({ archive, manifest }) =>
      new Response(new Uint8Array(archive), {
        status: 200,
        headers: {
          "Content-Type": "application/gzip",
          "Content-Length": String(archive.length),
          "Cache-Control": "no-cache",
          ETag: `"${manifest.archiveSha256}"`,
        },
      }),
  );
}
