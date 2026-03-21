import { prisma } from "@dpf/db";
import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { CountryPanel } from "@/components/admin/CountryPanel";
import { RegionPanel } from "@/components/admin/RegionPanel";
import { CityPanel } from "@/components/admin/CityPanel";
import { WorkLocationPanel } from "@/components/admin/WorkLocationPanel";

export default async function AdminReferenceDataPage() {
  const [countries, regions, cities, workLocations] = await Promise.all([
    prisma.country.findMany({ orderBy: { name: "asc" } }),
    prisma.region.findMany({
      include: { country: { select: { id: true, name: true, iso2: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.city.findMany({
      include: {
        region: {
          include: {
            country: { select: { id: true, name: true, iso2: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.workLocation.findMany({
      include: {
        address: {
          include: {
            city: {
              include: {
                region: {
                  include: { country: { select: { id: true, name: true } } },
                },
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Geographic reference data management
        </p>
      </div>
      <AdminTabNav />
      <div className="mt-6 space-y-6">
        <CountryPanel countries={countries} />
        <RegionPanel
          regions={regions}
          countries={countries.map((c) => ({
            id: c.id,
            name: c.name,
            iso2: c.iso2,
          }))}
        />
        <CityPanel
          cities={cities}
          countries={countries.map((c) => ({
            id: c.id,
            name: c.name,
            iso2: c.iso2,
          }))}
          regions={regions.map((r) => ({
            id: r.id,
            name: r.name,
            countryId: r.countryId,
          }))}
        />
        <WorkLocationPanel workLocations={workLocations} />
      </div>
    </div>
  );
}
