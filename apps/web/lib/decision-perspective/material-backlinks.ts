export type MaterialBacklinksTarget = {
  materialId?: string;
  pageId?: string;
  slug?: string;
  profileId?: string;
};

export type MaterialBacklinksCaps = {
  inLinks?: number;
  outLinks?: number;
  sources?: number;
  priorDecisions?: number;
  openWork?: number;
};

type PerspectiveMaterialRow = {
  materialId: string;
  profileId: string;
  sourceType: string;
  sourceRef?: unknown;
  summary?: string | null;
  domainClass?: string | null;
  direction?: string | null;
  reviewStatus?: string | null;
  promotionState?: string | null;
};

type WikiPageRow = {
  id: string;
  slug: string;
  title: string;
  pageKind: string;
  status?: string | null;
  isKernel?: boolean | null;
};

type RawSourceRow = {
  id: string;
  sourceKey?: string | null;
  title: string;
  sourceType: string;
  url?: string | null;
  abstract?: string | null;
};

type WikiPageLinkRow = {
  fromPageId: string;
  toPageId: string;
  fromPage?: WikiPageRow | null;
  toPage?: WikiPageRow | null;
};

type WikiPageSourceRow = {
  pageId: string;
  sourceId: string;
  source?: RawSourceRow | null;
};

type DecisionInteractionRow = {
  interactionId: string;
  profileId: string;
  question?: string | null;
  outcomeType?: string | null;
  sources?: unknown;
  createdAt?: Date | string | null;
};

export type MaterialBacklinksDbClient = {
  perspectiveMaterial?: {
    findUnique(args: { where: { materialId: string }; select?: Record<string, unknown> }): Promise<unknown>;
  };
  wikiPage?: {
    findFirst(args: { where: Record<string, unknown>; select?: Record<string, unknown> }): Promise<unknown>;
  };
  wikiPageLink?: {
    findMany(args: {
      where: Record<string, unknown>;
      include?: Record<string, unknown>;
      take?: number;
      orderBy?: Record<string, string> | Array<Record<string, string>>;
    }): Promise<unknown>;
  };
  wikiPageSource?: {
    findMany(args: {
      where: Record<string, unknown>;
      include?: Record<string, unknown>;
      take?: number;
    }): Promise<unknown>;
  };
  decisionInteraction?: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, string>;
      take?: number;
      select?: Record<string, unknown>;
    }): Promise<unknown>;
  };
};

export type MaterialBacklinksResult = {
  material: {
    materialId: string | null;
    profileId: string | null;
    sourceType: string | null;
    summary: string | null;
    domainClass: string | null;
    direction: string | null;
    reviewStatus: string | null;
    promotionState: string | null;
    wikiPageId: string | null;
    wikiSlug: string | null;
  };
  wikiNeighborhood: {
    page: WikiPageSummary | null;
    inLinks: WikiPageSummary[];
    outLinks: WikiPageSummary[];
    stancesAndHeuristics: WikiPageSummary[];
  };
  sources: RawSourceSummary[];
  priorDecisions: DecisionReference[];
  openWork: Array<{ id: string; title: string; href?: string | null }>;
  missingReason: "none" | "material-not-found" | "wiki-page-not-found" | "no-target";
};

export type WikiPageSummary = {
  id: string;
  slug: string;
  title: string;
  pageKind: string;
  status: string | null;
  isKernel: boolean;
};

export type RawSourceSummary = {
  id: string;
  sourceKey: string | null;
  title: string;
  sourceType: string;
  url: string | null;
  abstract: string | null;
};

export type DecisionReference = {
  interactionId: string;
  profileId: string;
  question: string;
  outcomeType: string | null;
  createdAt: string | null;
};

const DEFAULT_CAPS = {
  inLinks: 12,
  outLinks: 12,
  sources: 8,
  priorDecisions: 8,
  openWork: 8,
} satisfies Required<MaterialBacklinksCaps>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toWikiPageSummary(row: WikiPageRow | null | undefined): WikiPageSummary | null {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    pageKind: row.pageKind,
    status: row.status ?? null,
    isKernel: row.isKernel === true,
  };
}

function toRawSourceSummary(row: RawSourceRow | null | undefined): RawSourceSummary | null {
  if (!row) return null;
  return {
    id: row.id,
    sourceKey: row.sourceKey ?? null,
    title: row.title,
    sourceType: row.sourceType,
    url: row.url ?? null,
    abstract: row.abstract ?? null,
  };
}

function normalizeMaterial(row: PerspectiveMaterialRow | null, page: WikiPageSummary | null) {
  const sourceRef = asRecord(row?.sourceRef);
  return {
    materialId: row?.materialId ?? null,
    profileId: row?.profileId ?? null,
    sourceType: row?.sourceType ?? null,
    summary: row?.summary ?? null,
    domainClass: row?.domainClass ?? null,
    direction: row?.direction ?? null,
    reviewStatus: row?.reviewStatus ?? null,
    promotionState: row?.promotionState ?? null,
    wikiPageId:
      page?.id ??
      readString(sourceRef, ["wikiPageId", "pageId", "wiki_page_id"]) ??
      null,
    wikiSlug:
      page?.slug ??
      readString(sourceRef, ["wikiSlug", "slug", "sourceSlug"]) ??
      null,
  };
}

function readString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function targetFromMaterial(material: PerspectiveMaterialRow | null): {
  pageId: string | null;
  slug: string | null;
} {
  const sourceRef = asRecord(material?.sourceRef);
  return {
    pageId: readString(sourceRef, ["wikiPageId", "pageId", "wiki_page_id"]),
    slug: readString(sourceRef, ["wikiSlug", "slug", "sourceSlug"]),
  };
}

function uniquePages(pages: Array<WikiPageSummary | null>, cap: number): WikiPageSummary[] {
  const seen = new Set<string>();
  const out: WikiPageSummary[] = [];
  for (const page of pages) {
    if (!page || seen.has(page.id)) continue;
    seen.add(page.id);
    out.push(page);
    if (out.length >= cap) break;
  }
  return out;
}

function decisionMentionsMaterial(row: DecisionInteractionRow, materialId: string): boolean {
  return asArray(row.sources).some((entry) => {
    const source = asRecord(entry);
    return source.materialId === materialId || source.id === materialId;
  });
}

function toDecisionReference(row: DecisionInteractionRow): DecisionReference {
  return {
    interactionId: row.interactionId,
    profileId: row.profileId,
    question: row.question ?? "",
    outcomeType: row.outcomeType ?? null,
    createdAt: toIso(row.createdAt),
  };
}

function emptyResult(missingReason: MaterialBacklinksResult["missingReason"]): MaterialBacklinksResult {
  return {
    material: {
      materialId: null,
      profileId: null,
      sourceType: null,
      summary: null,
      domainClass: null,
      direction: null,
      reviewStatus: null,
      promotionState: null,
      wikiPageId: null,
      wikiSlug: null,
    },
    wikiNeighborhood: {
      page: null,
      inLinks: [],
      outLinks: [],
      stancesAndHeuristics: [],
    },
    sources: [],
    priorDecisions: [],
    openWork: [],
    missingReason,
  };
}

async function loadMaterial(
  db: MaterialBacklinksDbClient,
  materialId: string | undefined,
): Promise<PerspectiveMaterialRow | null> {
  if (!materialId || !db.perspectiveMaterial?.findUnique) return null;
  return await db.perspectiveMaterial.findUnique({
    where: { materialId },
    select: {
      materialId: true,
      profileId: true,
      sourceType: true,
      sourceRef: true,
      summary: true,
      domainClass: true,
      direction: true,
      reviewStatus: true,
      promotionState: true,
    },
  }) as PerspectiveMaterialRow | null;
}

async function loadWikiPage(
  db: MaterialBacklinksDbClient,
  target: MaterialBacklinksTarget,
  material: PerspectiveMaterialRow | null,
): Promise<WikiPageRow | null> {
  if (!db.wikiPage?.findFirst) return null;
  const derived = targetFromMaterial(material);
  const pageId = target.pageId ?? derived.pageId;
  const slug = target.slug ?? derived.slug;
  if (!pageId && !slug) return null;

  const clauses: Array<Record<string, string>> = [];
  if (pageId) clauses.push({ id: pageId });
  if (slug) clauses.push({ slug });

  return await db.wikiPage.findFirst({
    where: clauses.length === 1 ? (clauses[0] ?? {}) : { OR: clauses },
    select: {
      id: true,
      slug: true,
      title: true,
      pageKind: true,
      status: true,
      isKernel: true,
    },
  }) as WikiPageRow | null;
}

async function loadWikiLinks(
  db: MaterialBacklinksDbClient,
  pageId: string | null,
  caps: Required<MaterialBacklinksCaps>,
) {
  if (!pageId || !db.wikiPageLink?.findMany) {
    return { inLinks: [], outLinks: [] };
  }

  const [incoming, outgoing] = await Promise.all([
    db.wikiPageLink.findMany({
      where: { toPageId: pageId },
      include: { fromPage: true },
      take: caps.inLinks,
      orderBy: { fromPageId: "asc" },
    }) as Promise<WikiPageLinkRow[]>,
    db.wikiPageLink.findMany({
      where: { fromPageId: pageId },
      include: { toPage: true },
      take: caps.outLinks,
      orderBy: { toPageId: "asc" },
    }) as Promise<WikiPageLinkRow[]>,
  ]);

  return {
    inLinks: uniquePages(incoming.map((link) => toWikiPageSummary(link.fromPage)), caps.inLinks),
    outLinks: uniquePages(outgoing.map((link) => toWikiPageSummary(link.toPage)), caps.outLinks),
  };
}

async function loadSources(
  db: MaterialBacklinksDbClient,
  pageId: string | null,
  caps: Required<MaterialBacklinksCaps>,
): Promise<RawSourceSummary[]> {
  if (!pageId || !db.wikiPageSource?.findMany) return [];
  const rows = await db.wikiPageSource.findMany({
    where: { pageId },
    include: { source: true },
    take: caps.sources,
  }) as WikiPageSourceRow[];
  return rows
    .map((row) => toRawSourceSummary(row.source))
    .filter((row): row is RawSourceSummary => Boolean(row))
    .slice(0, caps.sources);
}

async function loadPriorDecisions(
  db: MaterialBacklinksDbClient,
  material: PerspectiveMaterialRow | null,
  target: MaterialBacklinksTarget,
  caps: Required<MaterialBacklinksCaps>,
): Promise<DecisionReference[]> {
  const materialId = target.materialId ?? material?.materialId;
  const profileId = target.profileId ?? material?.profileId;
  if (!materialId || !profileId || !db.decisionInteraction?.findMany) return [];

  const rows = await db.decisionInteraction.findMany({
    where: { profileId },
    orderBy: { createdAt: "desc" },
    take: caps.priorDecisions * 4,
    select: {
      interactionId: true,
      profileId: true,
      question: true,
      outcomeType: true,
      sources: true,
      createdAt: true,
    },
  }) as DecisionInteractionRow[];

  return rows
    .filter((row) => decisionMentionsMaterial(row, materialId))
    .slice(0, caps.priorDecisions)
    .map(toDecisionReference);
}

export async function getMaterialBacklinks(input: {
  db: MaterialBacklinksDbClient;
  target: MaterialBacklinksTarget;
  caps?: MaterialBacklinksCaps;
}): Promise<MaterialBacklinksResult> {
  const caps = { ...DEFAULT_CAPS, ...input.caps };
  const target = input.target;
  if (!target.materialId && !target.pageId && !target.slug) {
    return emptyResult("no-target");
  }

  const material = await loadMaterial(input.db, target.materialId);
  if (target.materialId && !material) {
    return emptyResult("material-not-found");
  }

  const page = await loadWikiPage(input.db, target, material);
  if ((target.pageId || target.slug) && !page && !material) {
    return emptyResult("wiki-page-not-found");
  }

  const pageSummary = toWikiPageSummary(page);
  const [links, sources, priorDecisions] = await Promise.all([
    loadWikiLinks(input.db, pageSummary?.id ?? null, caps),
    loadSources(input.db, pageSummary?.id ?? null, caps),
    loadPriorDecisions(input.db, material, target, caps),
  ]);

  const stancesAndHeuristics = uniquePages(
    [...links.inLinks, ...links.outLinks].filter((linked) =>
      linked.pageKind === "stance" || linked.pageKind === "heuristic"
    ),
    caps.inLinks + caps.outLinks,
  );

  return {
    material: normalizeMaterial(material, pageSummary),
    wikiNeighborhood: {
      page: pageSummary,
      inLinks: links.inLinks,
      outLinks: links.outLinks,
      stancesAndHeuristics,
    },
    sources,
    priorDecisions,
    openWork: [],
    missingReason: "none",
  };
}
