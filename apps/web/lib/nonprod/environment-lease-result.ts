import type { prisma } from "@dpf/db";
import type { LocalCiEvidenceValidity } from "@/lib/gates/gate-run-identity";
import type { ResolvedLocalCiPoolPolicy } from "./local-ci-pool-policy";
import type { ResolvedHostResourcePoolPolicy } from "./environment-lease-pool-policy";

type LeaseModel = typeof prisma.nonProductionEnvironmentLease;
export type LeaseRow = NonNullable<Awaited<ReturnType<LeaseModel["findUnique"]>>>;

/** `supersededLeaseId`: this owner's obsolete queued wait, retired by this claim (BI-D35B85BF). */
export type ClaimNonprodEnvironmentLeaseResult = { supersededLeaseId?: string } & (
  | { status: "admitted"; lease: LeaseRow; slotKey: string; waitAgeMs: number; poolPolicy: ResolvedNonprodPoolPolicy }
  | { status: "queued"; lease: LeaseRow; queuePosition: number; waitAgeMs: number; poolPolicy: ResolvedNonprodPoolPolicy }
  | { status: "terminal"; lease: LeaseRow; reason: "released" | "expired" | "cancelled"; poolPolicy: ResolvedNonprodPoolPolicy }
  | { status: "subscribed"; lease: LeaseRow; executionStatus: "admitted" | "queued"; poolPolicy: ResolvedNonprodPoolPolicy }
  | { status: "reused"; lease: LeaseRow; evidenceRecordId: string; resultClass: "pass" | "fail"; evidenceValidity: LocalCiEvidenceValidity | null; poolPolicy: ResolvedNonprodPoolPolicy }
  | { status: "blocked"; lease: LeaseRow; reason: "missing-evidence" | "mismatched-evidence" | "expired-evidence"; poolPolicy: ResolvedNonprodPoolPolicy });

export type ResolvedNonprodPoolPolicy = ResolvedLocalCiPoolPolicy | ResolvedHostResourcePoolPolicy;

