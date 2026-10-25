// @exposure authenticated
import { EffectiveAuthContextError } from "@/lib/identity/load-effective-auth-context";
import { auth } from "@/lib/auth";
import { loadAuthorizedWorkroomProcess } from "@/lib/work-management/workspace-case-detail.server";
import { normalizeProcessCaseKey } from "@/lib/work-management/workroom-process-snapshot";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const reply = (body: unknown, status: number) => Response.json(body, { status, headers });

/** Explicit reads never redirect the inspected document or mutate the room. */
export async function GET(request: Request, context: { params: Promise<{ caseKey: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return reply({ error: "session-required" }, 401);
    const { caseKey } = await context.params;
    const query = new URL(request.url).searchParams;
    // Omission expects a case-only projection; it never follows a new capsule.
    const rows = query.getAll("workroomRowId"), rooms = query.getAll("workroom");
    if (!normalizeProcessCaseKey(caseKey) || rows.length > 1 || (rows.length === 1 && (!rows[0]?.trim() || rows[0].length > 256)) ||
        rooms.length > 1 || (rooms.length === 1 && (!rooms[0]?.trim() || rooms[0].length > 256)))
      return reply({ error: "invalid-target" }, 400);
    const result = await loadAuthorizedWorkroomProcess({ caseKey, workroomRowId: rows[0] ?? null, selectedWorkroomId: rooms[0], user: session.user });
    if (result.status === "not-found") return reply({ error: "unavailable" }, 404);
    if (result.status === "changed") return reply({ error: "selection-changed" }, 409);
    return reply(result.snapshot, 200);
  } catch (error) {
    if (error instanceof EffectiveAuthContextError) return reply({ error: "session-required" }, 401);
    return reply({ error: "read-unavailable" }, 500);
  }
}
