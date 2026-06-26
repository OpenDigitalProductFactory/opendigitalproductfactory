import { prisma } from "@dpf/db";
import { slugify } from "@/lib/shared/slugify";
import type { ProposedEmployee } from "./roster-import";

/** Structural client — satisfied by the real PrismaClient and by test fakes. */
export type RosterImportClient = {
  employeeProfile: {
    findMany: (args: unknown) => Promise<Array<{ workEmail: string | null }>>;
    create: (args: unknown) => Promise<unknown>;
  };
};

export type RosterImportResult = {
  created: number;
  /** Skipped because an employee with this work email already exists. */
  skippedExisting: number;
  failed: number;
  errors: string[];
};

/** Business id for the new employee. The model's @id (cuid) is the real PK;
 *  this is a human-facing unique handle, so name-slug + a short stamp suffices. */
function makeEmployeeId(displayName: string, index: number): string {
  const slug = slugify(displayName).slice(0, 24) || "employee";
  return `emp-${slug}-${Date.now().toString(36)}${index.toString(36)}`;
}

/**
 * Create EmployeeProfile rows from operator-confirmed roster rows
 * (EP-ONBOARDING-INTAKE P4). Dedup by work email against existing employees
 * (skip matches), fail-soft per row so one bad row never aborts the batch.
 * Persists the identity baseline (name / email / phone / start date); the
 * detected title + department surface for confirmation but their FK resolution
 * (Position / Department lookup-or-create) is a follow-on slice.
 */
export async function importRoster(
  confirmed: ProposedEmployee[],
  db: RosterImportClient = prisma as unknown as RosterImportClient,
): Promise<RosterImportResult> {
  const result: RosterImportResult = { created: 0, skippedExisting: 0, failed: 0, errors: [] };

  const emails = confirmed
    .map((e) => e.workEmail?.toLowerCase())
    .filter((e): e is string => !!e);
  const existing = emails.length
    ? await db.employeeProfile.findMany({
        where: { workEmail: { in: emails, mode: "insensitive" } },
        select: { workEmail: true },
      })
    : [];
  const seen = new Set(
    existing.map((e) => (e.workEmail ?? "").toLowerCase()).filter(Boolean),
  );

  for (let i = 0; i < confirmed.length; i++) {
    const emp = confirmed[i]!;
    if (!emp.displayName) {
      result.failed++;
      result.errors.push(`row ${emp.sourceRow}: no name`);
      continue;
    }
    const emailKey = emp.workEmail?.toLowerCase();
    if (emailKey && seen.has(emailKey)) {
      result.skippedExisting++;
      continue;
    }
    try {
      await db.employeeProfile.create({
        data: {
          employeeId: makeEmployeeId(emp.displayName, i),
          firstName: emp.firstName || emp.displayName,
          lastName: emp.lastName,
          displayName: emp.displayName,
          status: "onboarding",
          ...(emp.workEmail ? { workEmail: emp.workEmail } : {}),
          ...(emp.phoneWork ? { phoneWork: emp.phoneWork } : {}),
          ...(emp.startDate ? { startDate: new Date(emp.startDate) } : {}),
        },
      });
      result.created++;
      if (emailKey) seen.add(emailKey); // guard intra-batch dupes too
    } catch (e) {
      result.failed++;
      result.errors.push(`row ${emp.sourceRow}: ${e instanceof Error ? e.message : "create failed"}`);
    }
  }
  return result;
}
