// GET /api/health/sha — plaintext deployed identity for the self-upgrade
// promoter's sha-verify step (scripts/promote.sh curls ${HEALTH_URL}/sha).
//
// Returns the running portal's git SHA: DEPLOYED_SHA when the deploy pipeline
// set it, else the baked /app/.dpf-image-version. Plaintext (not JSON) so the
// promoter can compare it directly to PROMOTE_TARGET_SHA. Public — same trust
// profile as /api/health and /api/platform/image-version.

import { readImageVersion } from "@/lib/platform/image-version";

export const dynamic = "force-dynamic";

const NO_CACHE_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-cache, no-store, must-revalidate",
  Pragma: "no-cache",
};

export async function GET() {
  const envSha = process.env.DEPLOYED_SHA;
  let sha = envSha && envSha.length > 0 ? envSha : "";
  if (!sha) {
    const image = await readImageVersion();
    sha = image?.raw ?? "";
  }
  return new Response(sha, { headers: NO_CACHE_HEADERS });
}
