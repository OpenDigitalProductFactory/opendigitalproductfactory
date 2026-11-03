import { isRecord } from "@/lib/shared/coerce";
import { providerLedgerSettled } from "../inference/provider-settlement";

/** Native persisted node proof only; client summaries and failed status are not settlement. */
export function semanticNodeProviderSettled(node: {
  taskNodeId: string; requestContract?: unknown; outputSnapshot: unknown;
}, requestDigest: string): boolean {
  const contract = isRecord(node.requestContract) ? node.requestContract : {};
  const output = isRecord(node.outputSnapshot) ? node.outputSnapshot : {};
  if (!/^[a-f0-9]{64}$/.test(requestDigest) || contract.requestDigest !== requestDigest
    || output.requestDigest !== requestDigest || typeof contract.generation !== "string" || !contract.generation) return false;
  return providerLedgerSettled(output.providerSettlement, { taskNodeId: node.taskNodeId,
    requestDigest, generation: contract.generation });
}
