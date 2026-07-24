// GET /api/critique-media/:id — stream a UX-critique screenshot, session-gated.
//
// Unlike /api/media/:id (which serves storefront imagery to anyone with the
// capability URL), critique screenshots capture internal product surfaces
// (/admin, live workspace data) and must never be servable without a session.
// So this route requires an authenticated user, scopes to the caller's org, and
// only releases assets that are actually anchored to a critique entry (a
// WikiPage attachment with the critique-screenshot role). Storage/serve
// decision: kernel DI-D80467D6B45B (option authenticated-serve).

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { getMediaStorageDriver } from "@/lib/media";
import { CRITIQUE_SCREENSHOT_ROLE } from "@/lib/ux-critique/critique-entry";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) {
    return new Response("Not found", { status: 404 });
  }

  const { id } = await context.params;

  // Resolve through the attachment so an unanchored MediaAsset — or one owned by
  // another owner type entirely — is never released by this route. Same-org and
  // critique-screenshot-role are both enforced here.
  const attachment = await prisma.mediaAttachment.findFirst({
    where: {
      mediaAssetId: id,
      organizationId: org.id,
      ownerType: "WikiPage",
      role: CRITIQUE_SCREENSHOT_ROLE,
    },
    select: {
      asset: {
        select: {
          storageKey: true,
          storageDriver: true,
          mimeType: true,
          status: true,
          kind: true,
        },
      },
    },
  });

  const asset = attachment?.asset;
  if (!asset || asset.status !== "ready" || asset.kind !== "image") {
    return new Response("Not found", { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await getMediaStorageDriver(asset.storageDriver).get(asset.storageKey);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Length": String(bytes.byteLength),
      // Content-addressed bytes are immutable, but this is authenticated
      // content — keep it out of shared caches.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
