import { isRecord } from "../shared/coerce";
import { ok, type ActionResult } from "../shared/action-result";
import type { FundingScope } from "./investment-balance-policy";
import type { InvestmentClass } from "./investment-balance";

export const ROOM_INVESTMENT_FIELD = "investmentBalanceV1";
export type FundingRoom = { id: string; promotionPolicy: unknown; parentIds: string[] };
export type ItemInvestmentClassification = { value: InvestmentClass; reference: string };
export type RoomFunding = { scope: FundingScope; sourceRoomId: string; classification?: ItemInvestmentClassification };

export function parseFundingScope(value: unknown): FundingScope | null {
  if (!isRecord(value) || typeof value.principalId !== "string" || !value.principalId.trim()
    || typeof value.organizationId !== "string" || !value.organizationId.trim()
    || (value.purpose !== "shared-platform" && value.purpose !== "archetype")) return null;
  return { principalId: value.principalId, organizationId: value.organizationId, purpose: value.purpose };
}
function sameScope(a: FundingScope, b: FundingScope): boolean {
  return a.principalId === b.principalId && a.organizationId === b.organizationId && a.purpose === b.purpose;
}

export function readRoomFundingBinding(promotionPolicy: unknown, itemId: string, installationRef?: string): ActionResult<FundingScope | null> {
  if (!isRecord(promotionPolicy)) return { ok: false, error: "malformed-funding" };
  const envelope = promotionPolicy[ROOM_INVESTMENT_FIELD];
  if (envelope === undefined) return ok(null);
  if (!isRecord(envelope) || !isRecord(envelope.bindings)) return { ok: false, error: "malformed-funding" };
  const binding = Object.hasOwn(envelope.bindings, itemId) ? envelope.bindings[itemId] : envelope.bindings["*"];
  if (binding === undefined) return ok(null);
  if (installationRef && (!isRecord(binding) || binding.installationRef !== installationRef)) return { ok: false, error: "funding-installation-mismatch" };
  const scope = isRecord(binding) && binding.version === 1 ? parseFundingScope(binding.scope) : null;
  return scope ? ok(scope) : { ok: false, error: "malformed-funding" };
}

/** Nearest containment level wins. All peers at that level must agree. */
export async function resolveRoomFunding(roomId: string, itemId: string, readRoom: (id: string) => Promise<FundingRoom | null>, installationRef?: string): Promise<ActionResult<RoomFunding | null>> {
  let frontier = [{ id: roomId, ancestors: new Set<string>() }];
  const cache = new Map<string, FundingRoom>();
  let visited = 0;
  for (let depth = 0; frontier.length > 0; depth++) {
    if (depth > 8) return { ok: false, error: "funding-depth" };
    const found: RoomFunding[] = [];
    const next: typeof frontier = [];
    for (const node of frontier) {
      if (++visited > 64) return { ok: false, error: "funding-overflow" };
      if (node.ancestors.has(node.id)) return { ok: false, error: "funding-cycle" };
      const room = cache.get(node.id) ?? await readRoom(node.id);
      if (!room) return { ok: false, error: "unknown-funding-room" };
      cache.set(node.id, room);
      const binding = readRoomFundingBinding(room.promotionPolicy, itemId, installationRef);
      if (!binding.ok) return binding;
      if (binding.data) {
        const envelope = (room.promotionPolicy as Record<string, unknown>)[ROOM_INVESTMENT_FIELD] as { bindings: Record<string, unknown> };
        const itemBinding = envelope.bindings[itemId];
        let classification: ItemInvestmentClassification | undefined;
        if (isRecord(itemBinding) && itemBinding.classification !== undefined && itemBinding.classification !== null) {
          if ((itemBinding.classification !== "refactor" && itemBinding.classification !== "new") || typeof itemBinding.boundAt !== "string" || !Number.isFinite(Date.parse(itemBinding.boundAt))) return { ok: false, error: "malformed-classification" };
          classification = { value: itemBinding.classification, reference: JSON.stringify([room.id, itemId, itemBinding.boundAt]) };
        }
        found.push({ scope: binding.data, sourceRoomId: room.id, ...(classification ? { classification } : {}) });
      }
      const ancestors = new Set([...node.ancestors, node.id]);
      for (const parent of room.parentIds) next.push({ id: parent, ancestors });
    }
    if (found.length > 0) {
      if (found.some((entry) => !sameScope(entry.scope, found[0]!.scope) || entry.classification?.value !== found[0]!.classification?.value)) return { ok: false, error: "conflicting-funding" };
      return ok(found[0]!);
    }
    frontier = next;
  }
  return ok(null);
}
