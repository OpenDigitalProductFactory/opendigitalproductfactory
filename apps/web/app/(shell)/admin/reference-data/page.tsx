import { prisma, type Prisma } from "@dpf/db";
import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { CountryPanel } from "@/components/admin/CountryPanel";
import { RegionPanel } from "@/components/admin/RegionPanel";
import { CityPanel } from "@/components/admin/CityPanel";
import { WorkLocationPanel } from "@/components/admin/WorkLocationPanel";
import {
  createReferenceDataQueryPlan,
  parseReferenceDataSearchParams,
  type ReferenceDataSearchParams,
} from "@/lib/admin/reference-data-read-model";

type RegionRow = Prisma.RegionGetPayload<{
  include: {
    country: { select: { id: true; name: true; iso2: true } };
  };
}>;

type CityRow = Prisma.CityGetPayload<{
  include: {
    region: {
      include: {
        country: { select: { id: true; name: true; iso2: true } };
      };
    };
  };
}>;

type WorkLocationRow = Prisma.WorkLocationGetPayload<{
  include: {
    address: {
      include: {
        city: {
          include: {
            region: {
              include: {
                country: { select: { id: true; name: true } };
              };
            };
          };
        };
      };
    };
  };
}>;

const EMPTY_TOTALS = {
  countries: 0,
  regions: 0,
  cities: 0,
  workLocations: 0,
};

export default async function AdminReferenceDataPage({
  searchParams,
}: {
  searchParams: Promise<ReferenceDataSearchParams>;
}) {
  const filters = parseReferenceDataSearchParams(await searchParams);
  const countPlan = createReferenceDataQueryPlan(filters, EMPTY_TOTALS);

  const [
    countryTotal,
    regionTotal,
    cityTotal,
    workLocationTotal,
    selectedCountry,
    selectedRegion,
  ] = await Promise.all([
    prisma.country.count(
      countPlan.countries.count as Prisma.CountryCountArgs,
    ),
    filters.regions.countryId
      ? prisma.region.count(
          countPlan.regions.count as Prisma.RegionCountArgs,
        )
      : Promise.resolve(0),
    filters.cities.regionId
      ? prisma.city.count(countPlan.cities.count as Prisma.CityCountArgs)
      : Promise.resolve(0),
    prisma.workLocation.count(
      countPlan.workLocations.count as Prisma.WorkLocationCountArgs,
    ),
    filters.regions.countryId
      ? prisma.country.findUnique({
          where: { id: filters.regions.countryId },
          select: { id: true, name: true, iso2: true },
        })
      : Promise.resolve(null),
    filters.cities.regionId
      ? prisma.region.findUnique({
          where: { id: filters.cities.regionId },
          select: {
            id: true,
            name: true,
            code: true,
            country: { select: { id: true, name: true, iso2: true } },
          },
        })
      : Promise.resolve(null),
  ]);

  const plan = createReferenceDataQueryPlan(filters, {
    countries: countryTotal,
    regions: regionTotal,
    cities: cityTotal,
    workLocations: workLocationTotal,
  });

  const [countries, regions, cities, workLocations] = await Promise.all([
    prisma.country.findMany(
      plan.countries.findMany as Prisma.CountryFindManyArgs,
    ),
    plan.regions.findMany
      ? (prisma.region.findMany(
          plan.regions.findMany as Prisma.RegionFindManyArgs,
        ) as Promise<RegionRow[]>)
      : Promise.resolve([] as RegionRow[]),
    plan.cities.findMany
      ? (prisma.city.findMany(
          plan.cities.findMany as Prisma.CityFindManyArgs,
        ) as Promise<CityRow[]>)
      : Promise.resolve([] as CityRow[]),
    prisma.workLocation.findMany(
      plan.workLocations.findMany as Prisma.WorkLocationFindManyArgs,
    ) as Promise<WorkLocationRow[]>,
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Admin</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Geographic reference data management
        </p>
      </div>
      <AdminTabNav />
      <div className="mt-6 space-y-6">
        <CountryPanel
          countries={countries}
          query={filters.countries.query}
          window={plan.countries.window}
        />
        <RegionPanel
          regions={regions}
          selectedCountry={selectedCountry}
          query={filters.regions.query}
          window={plan.regions.window}
        />
        <CityPanel
          cities={cities}
          selectedRegion={selectedRegion}
          query={filters.cities.query}
          window={plan.cities.window}
        />
        <WorkLocationPanel
          workLocations={workLocations}
          query={filters.workLocations.query}
          window={plan.workLocations.window}
        />
      </div>
    </div>
  );
}
