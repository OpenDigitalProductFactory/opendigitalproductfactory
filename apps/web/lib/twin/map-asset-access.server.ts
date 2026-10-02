import "server-only";

// Who may read map packs and the map runtime (BI-3DAE2169): a signed-in web
// session, or the phone app's bearer access token. Packs are public OSM-derived
// data; the check keeps an install from being an open tile server. A map makes a
// request per tile, so the bearer path verifies the token's signature and expiry
// only, without a database lookup per tile.

import { verifyAccessToken } from "@/lib/api/jwt";
import { auth } from "@/lib/auth";

export async function hasMapAssetAccess(request: Request): Promise<boolean> {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) {
    try {
      const payload = await verifyAccessToken(header.slice(7));
      return payload.sub.length > 0;
    } catch {
      return false;
    }
  }
  const session = await auth();
  return Boolean(session?.user);
}
