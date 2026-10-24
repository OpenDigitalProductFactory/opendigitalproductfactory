/**
 * Shared plumbing for the controlled-substance custody commands
 * (EP-CSC-CUSTODY): the injectable client surface, typed command error, the
 * serializable-transaction wrapper with RLS context and advisory locks, input
 * coercion, and the loaders every command uses.
 */

import type { CountRefusal } from "./count-policy";
import type { DiscrepancyRefusal } from "./discrepancy-policy";
import type { HandlerGrant, MovementRefusal, PrincipalFacts } from "./ledger-policy";
import { parseQuantity, QuantityFormatError, type Quantity } from "./quantity";

// ─── Client surface ─────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

interface Delegate {
  findFirst(args: unknown): Promise<Row | null>;
  findMany(args: unknown): Promise<Row[]>;
  create(args: unknown): Promise<Row>;
  update(args: unknown): Promise<Row>;
}

export interface CustodyTransaction {
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
  principal: Pick<Delegate, "findMany">;
  controlledSubstanceRegister: Pick<Delegate, "findFirst">;
  controlledSubstanceProduct: Pick<Delegate, "findFirst" | "findMany">;
  controlledSubstanceHandlerAuthorization: Pick<Delegate, "findMany">;
  controlledSubstanceMovement: Pick<Delegate, "findFirst" | "findMany" | "create">;
  controlledSubstanceCount: Pick<Delegate, "findFirst" | "create">;
  controlledSubstanceCountLine: Pick<Delegate, "create">;
  controlledSubstanceDiscrepancy: Pick<Delegate, "findFirst" | "create" | "update">;
}

export interface CustodyClient {
  $transaction<T>(
    work: (transaction: CustodyTransaction) => Promise<T>,
    options: { isolationLevel: "Serializable" },
  ): Promise<T>;
}

export interface CustodyContext {
  organizationId: string;
  /** Principal.id of the authenticated person acting. */
  actorPrincipalId: string;
  now?: Date;
}

export class CustodyCommandError extends Error {
  constructor(
    public readonly code:
      | "invalid_input"
      | "register_not_found"
      | "product_not_found"
      | "movement_not_found"
      | "discrepancy_not_found"
      | "principal_not_found"
      | "refused",
    message: string,
    public readonly refusals?: ReadonlyArray<MovementRefusal | CountRefusal | DiscrepancyRefusal>,
  ) {
    super(message);
    this.name = "CustodyCommandError";
  }
}

const MAX_SERIALIZATION_ATTEMPTS = 3;

function isSerializationConflict(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "P2034";
}

export async function serializable<T>(db: CustodyClient, work: (tx: CustodyTransaction) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_SERIALIZATION_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(work, { isolationLevel: "Serializable" });
    } catch (error) {
      if (!isSerializationConflict(error) || attempt === MAX_SERIALIZATION_ATTEMPTS) throw error;
    }
  }
  throw new Error("unreachable");
}

export async function setOrganizationContext(tx: CustodyTransaction, organizationId: string): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
}

export async function lock(tx: CustodyTransaction, key: string): Promise<void> {
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", key);
}

export function quantity(value: string, field: string): Quantity {
  try {
    return parseQuantity(value);
  } catch (error) {
    if (error instanceof QuantityFormatError) {
      throw new CustodyCommandError("invalid_input", `${field} must be a number with at most 4 decimal places.`);
    }
    throw error;
  }
}

export function date(value: string | undefined | null, field: string, fallback: Date): Date {
  if (value == null || value === "") return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new CustodyCommandError("invalid_input", `${field} must be a valid date.`);
  return parsed;
}

export function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function loadPrincipals(tx: CustodyTransaction, ids: ReadonlyArray<string | null | undefined>) {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const rows = await tx.principal.findMany({
    where: { id: { in: wanted } },
    select: { id: true, kind: true, status: true },
  });
  const byId = new Map(rows.map((row) => [String(row.id), row as unknown as PrincipalFacts]));
  for (const id of wanted) {
    if (!byId.has(id)) throw new CustodyCommandError("principal_not_found", "A named person could not be found.");
  }
  return byId;
}

export async function loadRegister(tx: CustodyTransaction, organizationId: string, registerRef: string) {
  const register = await tx.controlledSubstanceRegister.findFirst({
    where: { organizationId, registerRef },
    select: { id: true, registerRef: true, lifecycle: true, careLocation: { select: { timezone: true } } },
  });
  if (!register) throw new CustodyCommandError("register_not_found", "That controlled-substance register was not found.");
  return register as {
    id: string;
    registerRef: string;
    lifecycle: string;
    careLocation: { timezone: string } | null;
  };
}

export async function loadGrants(tx: CustodyTransaction, registerDbId: string, principalIds: string[]): Promise<HandlerGrant[]> {
  const rows = await tx.controlledSubstanceHandlerAuthorization.findMany({
    where: { registerId: registerDbId, principalId: { in: principalIds } },
    select: { principalId: true, scope: true, effectiveFrom: true, effectiveTo: true },
  });
  return rows as unknown as HandlerGrant[];
}

export function refused(refusals: ReadonlyArray<MovementRefusal | CountRefusal | DiscrepancyRefusal>): CustodyCommandError {
  return new CustodyCommandError("refused", refusals.map((refusal) => refusal.message).join(" "), refusals);
}

