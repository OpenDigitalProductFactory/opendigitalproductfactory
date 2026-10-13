import type { Prisma } from "@dpf/db";
import type { ModelCard } from "@/lib/routing/model-card-types";
import { isRecord } from "@/lib/shared/coerce";

type OutputCapacityOwner = Prisma.ModelProfileGetPayload<{
  select: { profileSource: true; capabilityOverrides: true };
}>;

// The existing PostgreSQL Int column bounds storage, not a model's capacity.
const MAX_STORED_OUTPUT_TOKENS = 2_147_483_647;

/** Omission retains known capacity when discovery supplies no valid evidence. */
export function modelOutputCapacityFields(
  reported: ModelCard["maxOutputTokens"],
  owner?: OutputCapacityOwner | null,
): Pick<Prisma.ModelProfileUncheckedCreateInput, "maxOutputTokens"> {
  if (owner?.profileSource === "admin" && owner.capabilityOverrides == null) return {};
  if (isRecord(owner?.capabilityOverrides) && Object.hasOwn(owner.capabilityOverrides, "maxOutputTokens")) return {};
  if (typeof reported !== "number" || !Number.isSafeInteger(reported)
    || reported <= 0 || reported > MAX_STORED_OUTPUT_TOKENS) return {};
  return { maxOutputTokens: reported };
}
