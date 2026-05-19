import { prisma } from "@dpf/db";

export type CoverageRow = {
  id: string;
  organizationId: string;
  providerKey: string;
  role: string;
  surface: string;
  readPosture: string;
  writeGates: string[];
  createdAt: Date;
};

export async function getMatrixByOrg(organizationId: string): Promise<CoverageRow[]> {
  return prisma.integrationRoleCoverage.findMany({
    where: { organizationId },
    orderBy: [{ providerKey: "asc" }, { role: "asc" }, { surface: "asc" }],
  });
}
