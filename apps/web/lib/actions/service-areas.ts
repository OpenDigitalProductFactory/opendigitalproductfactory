"use server";

// Service-area actions (BI-6CC10E4C): save the organization's drawn service
// areas. The capability is checked before anything is read or written, and
// every crew or employee an area names must exist in this organization.

import { revalidatePath } from "next/cache";

import { prisma } from "@dpf/db";

import { requireCapability } from "@/lib/actions/shared/guards";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { isRecord } from "@/lib/shared/coerce";
import { saveServiceAreas, type ServiceAreaDatabase } from "@/lib/twin/service-area-layout";

async function allowed(): Promise<boolean> {
  try {
    await requireCapability("operate_customer");
    return true;
  } catch {
    return false;
  }
}

function coverageIds(zones: unknown[], kind: string): string[] {
  return zones.flatMap((zone) =>
    isRecord(zone) && isRecord(zone.coveredBy) && zone.coveredBy.kind === kind && typeof zone.coveredBy.id === "string"
      ? [zone.coveredBy.id]
      : [],
  );
}

async function coverageResolves(organizationId: string, zones: unknown[]): Promise<boolean> {
  const crewIds = [...new Set(coverageIds(zones, "staffing-crew"))];
  const employeeIds = [...new Set(coverageIds(zones, "employee"))];
  const [crews, employees] = await Promise.all([
    crewIds.length
      ? prisma.staffingCrew.count({ where: { crewId: { in: crewIds }, organizationId } })
      : Promise.resolve(0),
    employeeIds.length
      ? prisma.employeeProfile.count({ where: { employeeId: { in: employeeIds } } })
      : Promise.resolve(0),
  ]);
  return crews === crewIds.length && employees === employeeIds.length;
}

/** Replace the organization's service areas (AC-COV-DRAW-1/2/3). */
export async function saveServiceAreasAction(
  expectedVersion: number,
  zones: unknown,
): Promise<ActionResult<{ version: number }>> {
  if (!(await allowed())) return err("forbidden");
  if (!Array.isArray(zones)) return err("invalid");
  const organization = await prisma.organization.findFirst({ select: { id: true, orgId: true } });
  if (!organization) return err("not-found");
  if (!(await coverageResolves(organization.id, zones))) return err("unknown-assignee");

  const result = await saveServiceAreas(prisma as unknown as ServiceAreaDatabase, {
    orgId: organization.orgId,
    expectedVersion,
    zones,
  });
  if (!result.ok) return err(result.code);
  revalidatePath("/customer");
  return ok({ version: result.version });
}
