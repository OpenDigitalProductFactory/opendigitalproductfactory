/**
 * Work Atlas map: groups and orders the Atlas picture for the glyph map
 * (BI-3791FDD8, design §3.2–3.3).
 *
 * Rooms group by portfolio, then by declared shape. Within a shape the rooms
 * that need a look come first. The five triage counts and the URL filters
 * (`?portfolio=&state=&shape=`) are read here, so other surfaces can link into
 * the Atlas and every reader gets the same grouping.
 *
 * Health comes from the projection (atlas-health.ts); nothing here
 * reclassifies a room.
 *
 * Pure and synchronous.
 */
import { ATLAS_HEALTH_STATES, atlasHealthNeedsLook, type AtlasHealth } from "@/lib/work-management/atlas-health";
import type { AtlasRoom } from "@/lib/work-management/atlas-projection";

/** Portfolio order on the map; a software platform leads with Manufacturing and Delivery. */
export const ATLAS_PORTFOLIO_ORDER = [
  "manufactureAndDeliver", "productsAndServicesSold", "forEmployees", "foundational", "unplaced",
] as const;
export type AtlasPortfolioKey = (typeof ATLAS_PORTFOLIO_ORDER)[number];

/** The five triage counts. Finished rooms are on the map but are not a filter. */
export const ATLAS_TRIAGE_STATES = ["needs-person", "stuck", "working", "waiting", "no-signal"] as const satisfies readonly AtlasHealth[];

/** Shape bucket for rooms that declare none. */
export const ATLAS_UNSHAPED = "unshaped";

/** Rows shown per expanded group before the "N more" line (design §3.3, PWA-02). */
export const ATLAS_ROWS_PER_PAGE = 8;

/** Worst first: stuck, needs a person, no signal, working, waiting, finished. */
const SORT_RANK: Record<AtlasHealth, number> = {
  stuck: 0, "needs-person": 1, "no-signal": 2, working: 3, waiting: 4, finished: 5,
};

/** A shape's display title and stages, resolved on the server from the shape registry. */
export type AtlasShapeMeta = { title: string; stages: Array<{ key: string; title: string }> };

/** Why a held room is held, from the drive's recorded hold. */
export type AtlasHold = { reason: string; since: string | null };

export type AtlasFilters = {
  portfolio?: AtlasPortfolioKey;
  state?: AtlasHealth;
  shape?: string;
};

export type AtlasShapeGroup = {
  shape: string;
  rooms: AtlasRoom[];
};

export type AtlasPortfolioGroup = {
  portfolio: AtlasPortfolioKey;
  total: number;
  needPerson: number;
  stuck: number;
  shapes: AtlasShapeGroup[];
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Reads `?portfolio=&state=&shape=`. An unknown value is dropped, never guessed. */
export function parseAtlasFilters(params: Record<string, string | string[] | undefined>): AtlasFilters {
  const portfolio = first(params.portfolio);
  const state = first(params.state);
  const shape = first(params.shape);
  return {
    ...(portfolio && (ATLAS_PORTFOLIO_ORDER as readonly string[]).includes(portfolio) ? { portfolio: portfolio as AtlasPortfolioKey } : {}),
    ...(state && (ATLAS_HEALTH_STATES as readonly string[]).includes(state) ? { state: state as AtlasHealth } : {}),
    ...(shape && /^[a-z0-9-]{1,80}$/.test(shape) ? { shape } : {}),
  };
}

/** The filters plus which group is expanded; all of it lives in the URL so it survives a refresh. */
export type AtlasView = AtlasFilters & { group?: string };

/** Builds an Atlas link from the current view. A `null` change clears that key. */
export function atlasHref(base: string, view: AtlasView, change: Partial<Record<keyof AtlasView, string | null>> = {}): string {
  const merged: Record<string, string | null | undefined> = { ...view, ...change };
  const params = new URLSearchParams();
  for (const key of ["portfolio", "state", "shape", "group"] as const) {
    const value = merged[key];
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/** Reads the expanded group (`portfolio/shape`) from the URL. */
export function parseAtlasGroup(params: Record<string, string | string[] | undefined>): string | undefined {
  const group = first(params.group);
  return group && /^[A-Za-z]{1,40}\/[a-z0-9-]{1,80}$/.test(group) ? group : undefined;
}

export function atlasGroupKey(portfolio: string, shape: string): string {
  return `${portfolio}/${shape}`;
}

export function shapeOf(room: AtlasRoom): string {
  return room.shape ?? ATLAS_UNSHAPED;
}

export function compareAtlasRooms(a: AtlasRoom, b: AtlasRoom): number {
  return SORT_RANK[a.health] - SORT_RANK[b.health] || a.title.localeCompare(b.title) || a.capsuleId.localeCompare(b.capsuleId);
}

/** True when the room passes the portfolio and shape filters (the state filter dims, it does not hide). */
export function inAtlasScope(room: AtlasRoom, filters: AtlasFilters): boolean {
  if (filters.portfolio && room.portfolio !== filters.portfolio) return false;
  if (filters.shape && shapeOf(room) !== filters.shape) return false;
  return true;
}

/** True when the room matches the selected triage state, or no state is selected. */
export function matchesAtlasState(room: AtlasRoom, filters: AtlasFilters): boolean {
  return !filters.state || room.health === filters.state;
}

function portfolioKey(room: AtlasRoom): AtlasPortfolioKey {
  return (ATLAS_PORTFOLIO_ORDER as readonly string[]).includes(room.portfolio) ? room.portfolio as AtlasPortfolioKey : "unplaced";
}

/**
 * Groups rooms by portfolio then shape. Empty portfolios are left out. Shapes
 * order by size, with "Unshaped" last, and rooms within a shape order worst first.
 */
export function groupAtlas(rooms: readonly AtlasRoom[], filters: AtlasFilters = {}): AtlasPortfolioGroup[] {
  const byPortfolio = new Map<AtlasPortfolioKey, Map<string, AtlasRoom[]>>();
  for (const room of rooms) {
    if (!inAtlasScope(room, filters)) continue;
    const portfolio = portfolioKey(room);
    const shapes = byPortfolio.get(portfolio) ?? new Map<string, AtlasRoom[]>();
    const list = shapes.get(shapeOf(room)) ?? [];
    list.push(room);
    shapes.set(shapeOf(room), list);
    byPortfolio.set(portfolio, shapes);
  }
  return ATLAS_PORTFOLIO_ORDER.flatMap((portfolio) => {
    const shapes = byPortfolio.get(portfolio);
    if (!shapes) return [];
    const groups = [...shapes.entries()]
      .map(([shape, list]) => ({ shape, rooms: [...list].sort(compareAtlasRooms) }))
      .sort((a, b) => Number(a.shape === ATLAS_UNSHAPED) - Number(b.shape === ATLAS_UNSHAPED)
        || b.rooms.length - a.rooms.length || a.shape.localeCompare(b.shape));
    const all = groups.flatMap((group) => group.rooms);
    return [{
      portfolio,
      total: all.length,
      needPerson: all.filter((room) => room.health === "needs-person").length,
      stuck: all.filter((room) => room.health === "stuck").length,
      shapes: groups,
    }];
  });
}

/** Triage counts over the rooms in scope (the portfolio and shape filters apply). */
export function atlasTriageCounts(rooms: readonly AtlasRoom[], filters: AtlasFilters = {}): Record<AtlasHealth, number> {
  const counts = Object.fromEntries(ATLAS_HEALTH_STATES.map((state) => [state, 0])) as Record<AtlasHealth, number>;
  for (const room of rooms) if (inAtlasScope(room, filters)) counts[room.health] += 1;
  return counts;
}

/**
 * Today's question (design §3.1). The answer counts the rooms waiting on a
 * person and names the one with the oldest recorded signal. The Atlas holds
 * no time-at-step yet (A5), so it says "no new signal since" rather than
 * claiming how long the room has waited.
 */
export function atlasQuestionAnswer(rooms: readonly AtlasRoom[], filters: AtlasFilters = {}): {
  waiting: number;
  oldest: { capsuleId: string; title: string; lastSignalAt: string } | null;
} {
  const waiting = rooms.filter((room) => inAtlasScope(room, filters) && room.health === "needs-person");
  const dated = waiting.filter((room): room is AtlasRoom & { lastSignalAt: string } => typeof room.lastSignalAt === "string")
    .sort((a, b) => a.lastSignalAt.localeCompare(b.lastSignalAt));
  const oldest = dated[0];
  return {
    waiting: waiting.length,
    oldest: oldest ? { capsuleId: oldest.capsuleId, title: oldest.title, lastSignalAt: oldest.lastSignalAt } : null,
  };
}

export { atlasHealthNeedsLook };
