// NACHA ACH file generator — the MANUAL disbursement rail (US).
//
// A customer whose bank offers no payment API pays employees by uploading a
// NACHA-formatted ACH file to their bank portal. This builds that file from a
// pay run's net-pay lines as PPD credits (Prearranged Payment and Deposit —
// the payroll SEC code). The file is data only: this module NEVER moves money;
// the customer uploads it and attests (lib/hr/manual-disbursement.ts).
//
// Bank details are INPUT, not stored here — the payee bank-account store is a
// governed schema follow-up (epic EP-PAYROLL-DISBURSEMENT, BI-DR-01). This is
// the pure, deterministic, golden-file-tested core the rail is built on.

const RECORD_SIZE = 94;
const BLOCKING_FACTOR = 10;

export interface NachaOriginator {
  /** Company name on the batch (≤16 chars used). */
  companyName: string;
  /** Company id (usually an IRS EIN like "1234567890"), ≤10 chars. */
  companyId: string;
  /** Originating DFI routing number (the company bank), 9 digits. */
  originatingDfiRouting: string;
  /** Immediate destination routing (the ACH operator / bank), 9 digits. */
  immediateDestination: string;
  /** Immediate origin (company routing or assigned id), 9-10 digits. */
  immediateOrigin: string;
  immediateDestinationName: string;
  immediateOriginName: string;
}

export interface NachaEntry {
  receiverName: string;
  /** Receiving DFI routing number, 9 digits (8 + check digit). */
  routingNumber: string;
  accountNumber: string;
  accountType: "checking" | "savings";
  /** Net pay in whole cents (integer). */
  amountCents: number;
  /** Stable per-employee id for the Individual ID field (≤15 chars). */
  individualId: string;
}

export interface NachaBatchInput {
  originator: NachaOriginator;
  /** Effective entry date (when funds post). */
  effectiveDate: Date;
  /** File creation timestamp — pass explicitly (deterministic; no clock here). */
  fileCreated: Date;
  entries: NachaEntry[];
  /** File ID modifier (A–Z) distinguishing files created the same day. */
  fileIdModifier?: string;
}

const digits = (s: string): string => s.replace(/\D/g, "");

/** Right-justified, zero-padded numeric field. */
function num(value: number | string, width: number): string {
  const s = typeof value === "number" ? String(Math.trunc(value)) : digits(value);
  if (s.length > width) return s.slice(s.length - width);
  return s.padStart(width, "0");
}

/** Left-justified, space-padded alphanumeric field (truncated to width). */
function alpha(value: string, width: number): string {
  const s = (value ?? "").toUpperCase().replace(/[^\x20-\x7E]/g, " ");
  return s.length > width ? s.slice(0, width) : s.padEnd(width, " ");
}

const yymmdd = (d: Date): string =>
  `${String(d.getUTCFullYear()).slice(2)}${num(d.getUTCMonth() + 1, 2)}${num(d.getUTCDate(), 2)}`;
const hhmm = (d: Date): string => `${num(d.getUTCHours(), 2)}${num(d.getUTCMinutes(), 2)}`;

// PPD credit transaction codes: 22 = checking credit, 32 = savings credit.
const txCode = (t: NachaEntry["accountType"]): string => (t === "savings" ? "32" : "22");

function assertAbaRoutingNumber(value: string, field: string): void {
  if (!/^\d{9}$/.test(value)) {
    throw new Error(`${field} must contain exactly 9 digits`);
  }
  const d = [...value].map(Number);
  const checksum =
    3 * (d[0] + d[3] + d[6]) +
    7 * (d[1] + d[4] + d[7]) +
    (d[2] + d[5] + d[8]);
  if (checksum % 10 !== 0) {
    throw new Error(`${field} failed the ABA routing checksum`);
  }
}

function assertValidInput(input: NachaBatchInput): void {
  if (Number.isNaN(input.effectiveDate.getTime()) || Number.isNaN(input.fileCreated.getTime())) {
    throw new Error("effectiveDate and fileCreated must be valid dates");
  }
  if (input.entries.length === 0) {
    throw new Error("a NACHA payroll batch requires at least one entry");
  }
  assertAbaRoutingNumber(input.originator.originatingDfiRouting, "originatingDfiRouting");
  assertAbaRoutingNumber(input.originator.immediateDestination, "immediateDestination");
  if (!/^\d{9,10}$/.test(input.originator.immediateOrigin)) {
    throw new Error("immediateOrigin must contain 9 or 10 digits");
  }
  if (input.fileIdModifier !== undefined && !/^[A-Z]$/i.test(input.fileIdModifier)) {
    throw new Error("fileIdModifier must be one letter A-Z");
  }
  input.entries.forEach((entry, index) => {
    const prefix = `entries[${index}]`;
    assertAbaRoutingNumber(entry.routingNumber, `${prefix}.routingNumber`);
    if (!entry.accountNumber.trim() || entry.accountNumber.length > 17) {
      throw new Error(`${prefix}.accountNumber must contain 1-17 characters`);
    }
    if (!Number.isSafeInteger(entry.amountCents) || entry.amountCents <= 0 || entry.amountCents > 9_999_999_999) {
      throw new Error(`${prefix}.amountCents must be a positive whole-cent amount within NACHA width`);
    }
    if (!entry.receiverName.trim()) throw new Error(`${prefix}.receiverName is required`);
    if (!entry.individualId.trim()) throw new Error(`${prefix}.individualId is required`);
  });
}

/**
 * Build a NACHA file (single PPD credit batch) for payroll net pay. Deterministic:
 * pass fileCreated/effectiveDate explicitly. Returns the CRLF-joined 94-char records,
 * padded to a multiple of the blocking factor with 9-filler records.
 */
export function buildNachaFile(input: NachaBatchInput): string {
  assertValidInput(input);
  const { originator: o, entries } = input;
  const originDfi8 = digits(o.originatingDfiRouting).slice(0, 8);
  const lines: string[] = [];

  // ── File Header (type 1) ──
  lines.push(
    "1" +
      "01" +
      " " + num(o.immediateDestination, 9) +
      num(o.immediateOrigin, 10) +
      yymmdd(input.fileCreated) +
      hhmm(input.fileCreated) +
      (input.fileIdModifier ?? "A").slice(0, 1).toUpperCase() +
      num(RECORD_SIZE, 3) +
      num(BLOCKING_FACTOR, 2) +
      "1" +
      alpha(o.immediateDestinationName, 23) +
      alpha(o.immediateOriginName, 23) +
      alpha("", 8),
  );

  // ── Batch Header (type 5) — 220 = credits only ──
  lines.push(
    "5" +
      "220" +
      alpha(o.companyName, 16) +
      alpha("", 20) +
      alpha(o.companyId, 10) +
      "PPD" +
      alpha("PAYROLL", 10) +
      yymmdd(input.effectiveDate) +
      yymmdd(input.effectiveDate) +
      "   " +
      "1" +
      originDfi8 +
      num(1, 7),
  );

  // ── Entry Detail (type 6) ──
  let entryHash = 0;
  let totalCredits = 0;
  entries.forEach((e, i) => {
    const rdfi = digits(e.routingNumber);
    const rdfi8 = rdfi.slice(0, 8);
    const checkDigit = rdfi.slice(8, 9) || "0";
    entryHash += Number(rdfi8);
    totalCredits += e.amountCents;
    lines.push(
      "6" +
        txCode(e.accountType) +
        rdfi8 +
        checkDigit +
        alpha(e.accountNumber, 17) +
        num(e.amountCents, 10) +
        alpha(e.individualId, 15) +
        alpha(e.receiverName, 22) +
        "  " +
        "0" +
        originDfi8 +
        num(i + 1, 7),
    );
  });

  const hashField = num(entryHash % 10_000_000_000, 10);

  // ── Batch Control (type 8) ──
  lines.push(
    "8" +
      "220" +
      num(entries.length, 6) +
      hashField +
      num(0, 12) +
      num(totalCredits, 12) +
      alpha(o.companyId, 10) +
      alpha("", 19) +
      alpha("", 6) +
      originDfi8 +
      num(1, 7),
  );

  // ── File Control (type 9) ──
  const entryRecords = entries.length;
  // Records so far + file control; block count rounds up to the blocking factor.
  const recordsBeforePad = lines.length + 1;
  const blockCount = Math.ceil(recordsBeforePad / BLOCKING_FACTOR);
  lines.push(
    "9" +
      num(1, 6) +
      num(blockCount, 6) +
      num(entryRecords, 8) +
      hashField +
      num(0, 12) +
      num(totalCredits, 12) +
      alpha("", 39),
  );

  // ── Pad to a multiple of the blocking factor with 9-filler records ──
  while (lines.length % BLOCKING_FACTOR !== 0) {
    lines.push("9".repeat(RECORD_SIZE));
  }

  return lines.join("\r\n") + "\r\n";
}
