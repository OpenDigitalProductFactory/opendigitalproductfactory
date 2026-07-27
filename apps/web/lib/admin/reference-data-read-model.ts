export const REFERENCE_DATA_PAGE_SIZE = 25;
const MAX_QUERY_LENGTH = 100;
const REFERENCE_DATA_ROUTE = "/admin/reference-data";

export type ReferenceDataSearchParams = Record<
  string,
  string | string[] | undefined
>;

export type ReferenceDataFilters = {
  countries: { query: string; page: number };
  regions: { countryId: string; query: string; page: number };
  cities: { regionId: string; query: string; page: number };
  workLocations: { query: string; page: number };
};

export type ReferenceDataTotals = {
  countries: number;
  regions: number;
  cities: number;
  workLocations: number;
};

export type PageWindow = {
  page: number;
  pageCount: number;
  skip: number;
  take: number;
  total: number;
};

type QuerySpec<FindMany = Record<string, unknown>> = {
  count: { where: Record<string, unknown> };
  findMany: FindMany;
  window: PageWindow;
};

export type ReferenceDataQueryPlan = {
  countries: QuerySpec;
  regions: QuerySpec<Record<string, unknown> | null>;
  cities: QuerySpec<Record<string, unknown> | null>;
  workLocations: QuerySpec;
};

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function normalizedText(value: string | string[] | undefined): string {
  return firstValue(value).trim().slice(0, MAX_QUERY_LENGTH);
}

function positivePage(value: string | string[] | undefined): number {
  const raw = firstValue(value);
  if (!/^[1-9]\d*$/.test(raw)) return 1;
  const page = Number(raw);
  return Number.isSafeInteger(page) ? page : 1;
}

export function parseReferenceDataSearchParams(
  searchParams: ReferenceDataSearchParams,
): ReferenceDataFilters {
  return {
    countries: {
      query: normalizedText(searchParams.countryQ),
      page: positivePage(searchParams.countryPage),
    },
    regions: {
      countryId: normalizedText(searchParams.regionCountry),
      query: normalizedText(searchParams.regionQ),
      page: positivePage(searchParams.regionPage),
    },
    cities: {
      regionId: normalizedText(searchParams.cityRegion),
      query: normalizedText(searchParams.cityQ),
      page: positivePage(searchParams.cityPage),
    },
    workLocations: {
      query: normalizedText(searchParams.workLocationQ),
      page: positivePage(searchParams.workLocationPage),
    },
  };
}

export function resolvePageWindow(
  requestedPage: number,
  total: number,
): PageWindow {
  const safeTotal = Math.max(0, Math.trunc(total));
  const pageCount = Math.max(
    1,
    Math.ceil(safeTotal / REFERENCE_DATA_PAGE_SIZE),
  );
  const page = Math.min(Math.max(1, Math.trunc(requestedPage)), pageCount);

  return {
    page,
    pageCount,
    skip: (page - 1) * REFERENCE_DATA_PAGE_SIZE,
    take: REFERENCE_DATA_PAGE_SIZE,
    total: safeTotal,
  };
}

function countryWhere(query: string): Record<string, unknown> {
  return query
    ? {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { iso2: { contains: query, mode: "insensitive" } },
          { iso3: { contains: query, mode: "insensitive" } },
        ],
      }
    : {};
}

function regionWhere(
  countryId: string,
  query: string,
): Record<string, unknown> {
  return {
    countryId,
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { code: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

function cityWhere(regionId: string, query: string): Record<string, unknown> {
  return {
    regionId,
    ...(query
      ? { name: { contains: query, mode: "insensitive" } }
      : {}),
  };
}

function workLocationWhere(query: string): Record<string, unknown> {
  return query
    ? { name: { contains: query, mode: "insensitive" } }
    : {};
}

export function createReferenceDataQueryPlan(
  filters: ReferenceDataFilters,
  totals: ReferenceDataTotals,
): ReferenceDataQueryPlan {
  const countryWindow = resolvePageWindow(
    filters.countries.page,
    totals.countries,
  );
  const regionWindow = resolvePageWindow(
    filters.regions.page,
    totals.regions,
  );
  const cityWindow = resolvePageWindow(filters.cities.page, totals.cities);
  const workLocationWindow = resolvePageWindow(
    filters.workLocations.page,
    totals.workLocations,
  );

  const countriesWhere = countryWhere(filters.countries.query);
  const regionsWhere = regionWhere(
    filters.regions.countryId,
    filters.regions.query,
  );
  const citiesWhere = cityWhere(
    filters.cities.regionId,
    filters.cities.query,
  );
  const workLocationsWhere = workLocationWhere(
    filters.workLocations.query,
  );

  return {
    countries: {
      count: { where: countriesWhere },
      findMany: {
        where: countriesWhere,
        orderBy: { name: "asc" },
        skip: countryWindow.skip,
        take: countryWindow.take,
      },
      window: countryWindow,
    },
    regions: {
      count: { where: regionsWhere },
      findMany: filters.regions.countryId
        ? {
            where: regionsWhere,
            include: {
              country: { select: { id: true, name: true, iso2: true } },
            },
            orderBy: { name: "asc" },
            skip: regionWindow.skip,
            take: regionWindow.take,
          }
        : null,
      window: regionWindow,
    },
    cities: {
      count: { where: citiesWhere },
      findMany: filters.cities.regionId
        ? {
            where: citiesWhere,
            include: {
              region: {
                include: {
                  country: { select: { id: true, name: true, iso2: true } },
                },
              },
            },
            orderBy: { name: "asc" },
            skip: cityWindow.skip,
            take: cityWindow.take,
          }
        : null,
      window: cityWindow,
    },
    workLocations: {
      count: { where: workLocationsWhere },
      findMany: {
        where: workLocationsWhere,
        include: {
          address: {
            include: {
              city: {
                include: {
                  region: {
                    include: {
                      country: { select: { id: true, name: true } },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { name: "asc" },
        skip: workLocationWindow.skip,
        take: workLocationWindow.take,
      },
      window: workLocationWindow,
    },
  };
}

function addEntries(
  target: Map<string, string>,
  entries: ReferenceDataSearchParams,
): void {
  for (const [key, rawValue] of Object.entries(entries)) {
    const value = firstValue(rawValue).trim();
    if (value) target.set(key, value);
  }
}

export function buildReferenceDataHref(
  current: ReferenceDataSearchParams,
  patch: Record<string, string | null | undefined>,
): string {
  const values = new Map<string, string>();
  addEntries(values, current);

  for (const [key, rawValue] of Object.entries(patch)) {
    const value = rawValue?.trim() ?? "";
    if (value) values.set(key, value);
    else values.delete(key);
  }

  const query = [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");

  return query ? `${REFERENCE_DATA_ROUTE}?${query}` : REFERENCE_DATA_ROUTE;
}
