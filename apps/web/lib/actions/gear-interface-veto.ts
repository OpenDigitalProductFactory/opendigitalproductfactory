"use server";
//
// Reduction Gear Phase 1 — operator-veto server action.
//
// Called from the Cockpit's graduations panel when an operator vetoes a
// pending or recent graduation event. Emits a `outcomeType='veto'`
// GearInterface row linked to the graduation by `governorRef`. The cooldown
// semantics (does the triple permanently lose access to that tier, or is the
// veto a one-time signal) live in Governor policy per spec §11(9) — Phase 1
// records the veto; Phase 2 lands the cooldown table.
//
// Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §6.4
// BI:   BI-861C4959

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { emitVeto } from "@/lib/gear-interface";
import type { CalibrationKey } from "@/lib/gear-interface";

async function requireOperatorWithVetoAuthority(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_platform")
  ) {
    throw new Error("Unauthorized — manage_platform required to veto an autonomy graduation");
  }
  return user.id!;
}

export interface VetoGraduationInput {
  /** GearInterface.id of the graduation row being vetoed. */
  graduationRowId: string;
  /** Operator-supplied reason — required, surfaces on the veto row. */
  rationale: string;
}

export async function vetoGraduation(input: VetoGraduationInput) {
  const operatorId = await requireOperatorWithVetoAuthority();
  if (!input.rationale || input.rationale.trim().length === 0) {
    throw new Error("Rationale is required when vetoing a graduation");
  }

  const graduation = await prisma.gearInterface.findUnique({
    where: { id: input.graduationRowId },
    select: {
      id: true,
      outcomeType: true,
      agentIdForTriple: true,
      capabilityName: true,
      archetypeContext: true,
      interfaceClass: true,
      innerRing: true,
      outerRing: true,
      graduationFromAutonomy: true,
      graduationGovernorRef: true,
    },
  });

  if (!graduation) {
    throw new Error(`Graduation row ${input.graduationRowId} not found`);
  }
  if (graduation.outcomeType !== "graduation") {
    throw new Error(
      `Row ${input.graduationRowId} is outcomeType=${graduation.outcomeType}, not graduation — nothing to veto`,
    );
  }
  if (!graduation.graduationGovernorRef) {
    throw new Error(
      `Graduation row ${input.graduationRowId} has no governorRef — cannot pair a veto record`,
    );
  }

  const triple: CalibrationKey = {
    agentIdForTriple: graduation.agentIdForTriple,
    capabilityName: graduation.capabilityName,
    archetypeContext: graduation.archetypeContext,
    interfaceClass: graduation.interfaceClass as CalibrationKey["interfaceClass"],
    innerRing: graduation.innerRing,
    outerRing: graduation.outerRing,
    // Pin the from-tier so the veto row reflects what the operator actually rejected.
    autonomyLevel: graduation.graduationFromAutonomy as CalibrationKey["autonomyLevel"],
  };

  await emitVeto({
    triple,
    governorRef: graduation.graduationGovernorRef,
    operatorId,
    rationale: input.rationale.trim(),
  });

  revalidatePath("/admin/cockpit");
  return { ok: true as const };
}
