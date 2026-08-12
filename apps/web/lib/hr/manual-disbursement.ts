// Manual disbursement rail — prepare the bank artifact, then record the attested
// payment. For a customer whose bank has no payment API: the platform builds the
// NACHA file (lib/hr/nacha.ts) from a pay run's net-pay lines, the customer
// uploads it at their bank, then attests completion → each payslip is marked paid
// through the existing markPayslipDisbursed hook. Human-derived evidence: the
// attestation (who / when / bank reference) is the auditable record of payment.
//
// This module NEVER moves money — it produces a file (data) and records a human's
// attestation that the payment was made. Provenance = human-attestation; the
// formal ComplianceEvidence write is the caller's concern (epic
// EP-PAYROLL-DISBURSEMENT, BI-DR-03). Design: docs/superpowers/specs/
// 2026-08-11-payroll-disbursement-rails-epic-and-backlog.md.

import { buildNachaFile, type NachaBatchInput, type NachaOriginator } from "./nacha";
import { markPayslipDisbursed, type DisbursePayslipClient } from "./payroll-run";

export interface PayeeBankAccount {
  routingNumber: string;
  accountNumber: string;
  accountType: "checking" | "savings";
}

/** One net-pay line to disburse — a persisted payslip plus the payee's bank details. */
export interface ManualDisbursementLine {
  payslipId: string;
  employeeProfileId: string;
  receiverName: string;
  /** Net pay in dollars (Payslip.netPay). Converted to whole cents for NACHA. */
  netPay: number;
  bank: PayeeBankAccount;
}

export interface PrepareManualBatchInput {
  originator: NachaOriginator;
  effectiveDate: Date;
  fileCreated: Date;
  lines: ManualDisbursementLine[];
  fileIdModifier?: string;
}

export interface ManualBatchArtifact {
  /** The NACHA file the customer uploads to their bank. */
  nachaFile: string;
  payableCount: number;
  totalCents: number;
}

const toCents = (dollars: number): number => Math.round(dollars * 100);

/**
 * Build the NACHA artifact for a set of net-pay lines. Pure: no DB, no money
 * movement — just the file + a summary the operator sees before executing at
 * their bank. Lines with a non-positive amount are excluded (nothing to pay).
 */
export function prepareManualNachaBatch(input: PrepareManualBatchInput): ManualBatchArtifact {
  const payable = input.lines.filter((l) => toCents(l.netPay) > 0);
  const entries: NachaBatchInput["entries"] = payable.map((l) => ({
    receiverName: l.receiverName,
    routingNumber: l.bank.routingNumber,
    accountNumber: l.bank.accountNumber,
    accountType: l.bank.accountType,
    amountCents: toCents(l.netPay),
    individualId: l.employeeProfileId,
  }));

  const nachaFile = buildNachaFile({
    originator: input.originator,
    effectiveDate: input.effectiveDate,
    fileCreated: input.fileCreated,
    entries,
    fileIdModifier: input.fileIdModifier,
  });

  return {
    nachaFile,
    payableCount: entries.length,
    totalCents: entries.reduce((t, e) => t + e.amountCents, 0),
  };
}

/** Human attestation that the manual payment was executed at the bank. */
export interface ManualDisbursementAttestation {
  attestedBy: string;
  attestedAt: Date;
  /** The bank's trace/reference for the ACH upload — the external proof. */
  bankReference: string;
  note?: string;
}

export interface RecordManualDisbursementInput {
  payslipIds: string[];
  attestation: ManualDisbursementAttestation;
}

export interface RecordManualDisbursementResult {
  disbursed: string[];
  attestation: ManualDisbursementAttestation;
}

/**
 * Record an attested manual payment: mark each payslip paid (through the shared
 * markPayslipDisbursed hook) as of the attestation time. Requires a bankReference
 * so "paid" is never claimed without the external proof. Returns the attestation
 * for the caller to persist as ComplianceEvidence (BI-DR-03).
 */
export async function recordManualDisbursement(
  db: DisbursePayslipClient,
  input: RecordManualDisbursementInput,
): Promise<RecordManualDisbursementResult> {
  const { attestation } = input;
  if (!attestation.bankReference || attestation.bankReference.trim() === "") {
    throw new Error("manual disbursement requires a bankReference (the external proof of payment)");
  }
  const disbursed: string[] = [];
  for (const payslipId of input.payslipIds) {
    await markPayslipDisbursed(db, payslipId, "paid", attestation.attestedAt);
    disbursed.push(payslipId);
  }
  return { disbursed, attestation };
}
