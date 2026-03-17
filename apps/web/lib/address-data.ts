import { prisma } from "@dpf/db";

// ---------------------------------------------------------------------------
// getEmployeeAddresses — fetches all active addresses for an employee
// with full geographic hierarchy: city → region → country
// ---------------------------------------------------------------------------

export async function getEmployeeAddresses(employeeProfileId: string) {
  return prisma.employeeAddress.findMany({
    where: {
      employeeProfileId,
      address: { status: "active" },
    },
    include: {
      address: {
        include: {
          city: {
            include: {
              region: {
                include: {
                  country: {
                    select: { id: true, name: true, iso2: true, phoneCode: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
}
