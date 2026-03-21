"use server";

import * as crypto from "crypto";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";

/** Generate SK-XXXXXXXX (8 hex chars = 32 bits of entropy, collision-safe to ~65k skills) */
export async function generateSkillId(): Promise<string> {
  return `SK-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

export async function createUserSkill(input: {
  name: string;
  intent: string;
  constraints?: string[];
  tags?: string[];
  routeHint?: string;
  visibility: "personal" | "team" | "org";
  teamId?: string;
}) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  return prisma.userSkill.create({
    data: {
      skillId: generateSkillId(),
      name: input.name,
      intent: input.intent,
      constraints: input.constraints ?? [],
      tags: input.tags ?? [],
      routeHint: input.routeHint ?? null,
      visibility: input.visibility,
      teamId: input.visibility === "team" ? input.teamId : null,
      createdById: session.user.id,
    },
  });
}

export async function getUserSkillsForDropdown(params?: { routeHint?: string }) {
  const session = await auth();
  if (!session?.user?.id) return [];

  const userId = session.user.id;

  // Get user's team IDs
  const memberships = await prisma.teamMembership.findMany({
    where: { userId },
    select: { teamId: true },
  });
  const teamIds = memberships.map((m) => m.teamId);

  // Query: personal (mine) + team (my teams) + org (all)
  const skills = await prisma.userSkill.findMany({
    where: {
      OR: [
        { visibility: "personal", createdById: userId },
        { visibility: "team", teamId: { in: teamIds } },
        { visibility: "org" },
      ],
    },
    orderBy: [
      { usageCount: "desc" },
      { updatedAt: "desc" },
    ],
  });

  return skills;
}

export async function incrementSkillUsage(skillId: string) {
  return prisma.userSkill.update({
    where: { skillId },
    data: { usageCount: { increment: 1 } },
  });
}

export async function deleteUserSkill(skillId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const skill = await prisma.userSkill.findUnique({ where: { skillId } });
  if (!skill || skill.createdById !== session.user.id) {
    throw new Error("Unauthorized");
  }

  return prisma.userSkill.delete({ where: { skillId } });
}
