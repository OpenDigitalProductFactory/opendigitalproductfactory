// @exposure private-mesh — governed Contributor preview and its current platform approver only.
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { envelopeInboxRoute } from "@/lib/coworker/envelope-routes";
import type { ReceiptDb } from "@/lib/work-capsules/command-receipts";
import { S5_REHEARSAL_READ_PATH, previewIdentity } from "@/lib/workroom-runtime/s5-rehearsal-owner.server";
import { createS5RehearsalApprovalProducer, s5RehearsalPreviewOwnerPorts } from "@/lib/workroom-runtime/s5-rehearsal-approval-producer.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const response = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const held = () => response({ kind: "held" }, 404);

export async function POST(request: Request): Promise<Response> {
  try {
    const preview = previewIdentity(process.env);
    if (!preview || request.method !== "POST" || request.url.length > 2_048) return held();
    const url = new URL(request.url);
    if (url.pathname !== `${S5_REHEARSAL_READ_PATH}/request-approval`
      || !["http://localhost:3001", "http://127.0.0.1:3001"].includes(url.origin)
      || request.headers.get("origin") !== url.origin) return held();
    const params = [...url.searchParams];
    if (params.length !== 5 || new Set(params.map(([key]) => key)).size !== params.length) return held();
    const owner = (await auth())?.user?.id;
    if (!owner) return held();
    // The callback receives the actual Prisma transaction; ReceiptDb selects
    // only the reflected Workroom command read, locks, and result receipt.
    const db = prisma as unknown as Pick<typeof prisma, "workroom"> & ReceiptDb;
    const propose = createS5RehearsalApprovalProducer({ ...s5RehearsalPreviewOwnerPorts(db), preview: { ...preview, origin: url.origin } });
    const result = await propose(owner, Object.fromEntries(params));
    return result.kind === "proposed" ? response({ ...result, inboxHref: envelopeInboxRoute(result.envelopeId) }, 200) : held();
  } catch {
    return held();
  }
}
