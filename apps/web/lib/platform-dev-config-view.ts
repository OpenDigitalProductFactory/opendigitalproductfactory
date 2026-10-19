import type { Prisma } from "@dpf/db";
import type { PlatformDevPolicyState } from "@/lib/platform-dev-policy";

/** The relations `getPlatformDevConfig` loads with the singleton config row. */
export const PLATFORM_DEV_CONFIG_INCLUDE = {
  configuredBy: { select: { email: true } },
  dcoAcceptedBy: { select: { email: true } },
} satisfies Prisma.PlatformDevConfigInclude;

/**
 * What `getPlatformDevConfig` returns. Named so the action's declaration never
 * has to spell the generated `WipAdmissionMode` enum (TS2883).
 */
export type PlatformDevConfigView = Prisma.PlatformDevConfigGetPayload<{
  include: typeof PLATFORM_DEV_CONFIG_INCLUDE;
}> & { policyState: PlatformDevPolicyState };
