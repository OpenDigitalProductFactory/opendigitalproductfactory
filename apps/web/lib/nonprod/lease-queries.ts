import type { ToolResult } from "@/lib/mcp-tool-types";

export function toolSafeLease(lease: Record<string, unknown>): Record<string, unknown> {
  const { ownerProcessIdentity: _sensitiveProcessIdentity, ...visibleLease } = lease;
  return {
    ...visibleLease,
    expectedMemoryBytes: typeof lease.expectedMemoryBytes === "bigint"
      ? Number(lease.expectedMemoryBytes)
      : lease.expectedMemoryBytes,
  };
}

async function readExactLease(value: unknown): Promise<ToolResult> {
  const leaseId = typeof value === "string" ? value.trim() : "";
  if (!/^NPEL-[A-Za-z0-9-]{1,100}$/.test(leaseId)) {
    return { success: false, error: "invalid_lease_id", message: "Supply one exact lease ID for historical readback.", data: { retryable: false } };
  }
  try {
    const { prisma } = await import("@dpf/db");
    const lease = await prisma.nonProductionEnvironmentLease.findUnique({ where: { leaseId } });
    if (!lease) return { success: false, error: "not_found", message: "The exact reservation could not be found.", data: { retryable: false } };
    if (lease.leaseId !== leaseId) return { success: false, error: "lease_readback_mismatch", message: "The reservation identity could not be verified." };
    return { success: true, entityId: leaseId, message: "Read the persisted reservation. Its state does not prove command outcome or process cleanup.", data: { lease: toolSafeLease(lease as unknown as Record<string, unknown>) } };
  } catch {
    return { success: false, error: "lease_readback_unavailable", message: "The exact reservation is unavailable; its state remains unknown." };
  }
}

export async function listNonprodEnvironmentLeases(params: Record<string, unknown> = {}): Promise<ToolResult> {
  if (Object.prototype.hasOwnProperty.call(params, "leaseId")) return readExactLease(params.leaseId);
  const {
    listActiveNonprodEnvironmentLeases,
    listQueuedNonprodEnvironmentLeases,
  } = await import("@/lib/nonprod/environment-lease");
  const [leases, queued] = await Promise.all([
    listActiveNonprodEnvironmentLeases({}),
    listQueuedNonprodEnvironmentLeases({}),
  ]);
  return {
    success: true,
    message: `Found ${leases.length} admitted and ${queued.length} queued nonproduction environment lease(s).`,
    data: {
      leases: leases.map((lease) => toolSafeLease(lease as Record<string, unknown>)),
      queued: queued.map((lease) => toolSafeLease(lease as Record<string, unknown>)),
    },
  };
}

