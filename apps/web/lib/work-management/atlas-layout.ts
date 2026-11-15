/**
 * Work Atlas business layouts (BI-B0D8394B; tailoring spec
 * docs/superpowers/specs/2026-10-27-work-atlas-archetype-tailoring-design.md §3–§4, §7).
 *
 * One layout per operational twin template. The template comes from
 * `deriveTwinProfile`, so the Atlas arranges rooms the way the business's own
 * twin does. The state glyphs never change between layouts (spec §3): a layout
 * only decides the lanes and time slots rooms sit in, the question asked first,
 * and the nouns.
 *
 * A room is placed by its recorded placement, `outcomeAnchor.atlasPlacement`
 * (`{ lane, laneLabel?, slot? }`), written by whatever surface opens the room for
 * an order, job, appointment or stay. A room without one, or with a lane the
 * layout does not know, goes to "Not yet placed". Nothing is guessed.
 *
 * Pure and synchronous.
 */
import type { TwinTemplate } from "@dpf/storefront-templates";

export type AtlasLane = { key: string; label: string };
export type AtlasSlot = { key: string; label: string };

/** Where a room sits in a lane layout, as the room records it. */
export type AtlasPlacement = { lane: string; laneLabel?: string; slot?: string };

export type AtlasLayoutSpec = {
  /** "portfolio" is the A2 map (TENANTS); "lanes" is a lanes × time-slots board. */
  kind: "portfolio" | "lanes";
  /** The question the Atlas asks first for this kind of business (spec §4). */
  question: string;
  /** What a lane is and what the time axis measures, in the business's words. */
  laneLabel: string;
  slotLabel: string;
  /**
   * Fixed lanes, or `null` when lanes come from the business itself (zones,
   * providers, beds, clients, programs, events). Those take each room's recorded lane.
   */
  lanes: readonly AtlasLane[] | null;
  slots: readonly AtlasSlot[];
};

export type AtlasLayout = AtlasLayoutSpec & { template: TwinTemplate };

const lane = (key: string, label: string): AtlasLane => ({ key, label });
const slot = lane;

/** Spec §4, one row per twin template. */
export const ATLAS_LAYOUTS: Record<TwinTemplate, AtlasLayoutSpec> = {
  TENANTS: {
    kind: "portfolio", question: "What is waiting on a person, and for how long?",
    laneLabel: "Portfolio", slotLabel: "Age against usual", lanes: null, slots: [],
  },
  PIPELINE: {
    kind: "lanes", question: "Which matters will miss their date?",
    laneLabel: "Client or matter", slotLabel: "Stage", lanes: null,
    slots: [slot("intake", "Intake"), slot("in-progress", "In progress"), slot("review", "Review"), slot("deliver", "Deliver")],
  },
  PROGRAMS: {
    kind: "lanes", question: "Which programs are behind on what they promised?",
    laneLabel: "Program or fund", slotLabel: "Days to deadline", lanes: null,
    slots: [slot("later", "More than 30 days"), slot("month", "8–30 days"), slot("week", "7 days or less"), slot("overdue", "Overdue")],
  },
  FLOOR: {
    kind: "lanes", question: "Are we ready for the next service?",
    laneLabel: "Service channel", slotLabel: "Service period",
    lanes: [lane("dine-in", "Dine-in"), lane("takeout", "Takeout"), lane("delivery", "Delivery"), lane("catering", "Catering and events")],
    slots: [slot("breakfast", "Breakfast"), slot("lunch", "Lunch"), slot("dinner", "Dinner"), slot("late", "Late")],
  },
  TERRITORY: {
    kind: "lanes", question: "What has to be dispatched or rescued today?",
    laneLabel: "Service area zone", slotLabel: "Arrival window", lanes: null,
    slots: [slot("early", "Early"), slot("midday", "Midday"), slot("afternoon", "Afternoon"), slot("late", "Late")],
  },
  BOOK: {
    kind: "lanes", question: "Is the day running to time, and who is waiting?",
    laneLabel: "Provider", slotLabel: "Appointment hours", lanes: null,
    slots: [slot("morning", "Morning"), slot("midday", "Midday"), slot("afternoon", "Afternoon"), slot("evening", "Evening")],
  },
  ROOMS: {
    kind: "lanes", question: "Who is due out, and is every patient checked?",
    laneLabel: "Bed, kennel, stall or enclosure", slotLabel: "Length of stay", lanes: null,
    slots: [slot("arriving", "Arriving"), slot("staying", "Staying"), slot("due-out", "Due out")],
  },
  YARD: {
    kind: "lanes", question: "What is due back, and what is not ready to go out?",
    laneLabel: "Bay", slotLabel: "Due back",
    lanes: [lane("in-yard", "In yard"), lane("out", "Out"), lane("due-back", "Due back"), lane("inspection", "In inspection")],
    slots: [slot("today", "Today"), slot("week", "This week"), slot("later", "Later")],
  },
  BAYS: {
    kind: "lanes", question: "Which bay is holding up promised work?",
    laneLabel: "Work centre or bay", slotLabel: "Promised by",
    lanes: [lane("intake", "Intake"), lane("bays", "Bays and stations"), lane("parts", "Awaiting parts"), lane("ready", "Ready")],
    slots: [slot("today", "Today"), slot("tomorrow", "Tomorrow"), slot("later", "Later")],
  },
  STORE: {
    kind: "lanes", question: "What will not ship or restock in time?",
    laneLabel: "Lane", slotLabel: "Order promise",
    lanes: [lane("stock", "Stock"), lane("orders", "Orders to fulfil"), lane("returns", "Returns")],
    slots: [slot("today", "Today"), slot("week", "This week"), slot("later", "Later")],
  },
  VENUE: {
    kind: "lanes", question: "Is every event on track for its date?",
    laneLabel: "Event", slotLabel: "Run of show", lanes: null,
    slots: [slot("planning", "Planning"), slot("load-in", "Load-in"), slot("show", "Show"), slot("settle", "Settle")],
  },
  COUNTER: {
    kind: "lanes", question: "Which cases are near their legal deadline?",
    laneLabel: "Counter or case queue", slotLabel: "Statutory clock",
    lanes: [lane("intake", "Intake"), lane("review", "Review"), lane("inspections", "Inspections")],
    slots: [slot("on-time", "On time"), slot("near", "Near deadline"), slot("overdue", "Overdue")],
  },
  DOCK: {
    kind: "lanes", question: "Will today's waves make their cut-off?",
    laneLabel: "Dock door or pick wave", slotLabel: "Cut-off",
    lanes: [lane("inbound", "Inbound"), lane("putaway", "Putaway"), lane("pick", "Pick waves"), lane("outbound", "Outbound")],
    slots: [slot("before", "Before cut-off"), slot("at-risk", "At risk"), slot("missed", "Missed")],
  },
};

export function atlasLayoutFor(template: TwinTemplate): AtlasLayout {
  return { template, ...ATLAS_LAYOUTS[template] };
}

/** Reads a room's recorded placement from its outcome anchor, or null. */
export function readAtlasPlacement(outcomeAnchor: unknown): AtlasPlacement | null {
  if (!outcomeAnchor || typeof outcomeAnchor !== "object") return null;
  const raw = (outcomeAnchor as Record<string, unknown>).atlasPlacement;
  if (!raw || typeof raw !== "object") return null;
  const { lane: laneKey, laneLabel, slot: slotKey } = raw as Record<string, unknown>;
  if (typeof laneKey !== "string" || !/^[A-Za-z0-9:_-]{1,80}$/.test(laneKey)) return null;
  return {
    lane: laneKey,
    ...(typeof laneLabel === "string" && laneLabel.trim() ? { laneLabel: laneLabel.trim().slice(0, 80) } : {}),
    ...(typeof slotKey === "string" && /^[a-z0-9-]{1,40}$/.test(slotKey) ? { slot: slotKey } : {}),
  };
}

/** A lane layout drawn from the rooms: lanes × slots, plus the rooms it could not place. */
export type AtlasBoard<R> = {
  lanes: Array<AtlasLane & { cells: Record<string, R[]>; unslotted: R[] }>;
  unplaced: R[];
};

/**
 * Places rooms on a lane layout. A layout with fixed lanes accepts only those
 * lanes. A layout whose lanes come from the business takes each room's
 * recorded lane, in first-seen order. A slot the layout does not know leaves
 * the room in its lane's "Any time" column. A room with no placement is unplaced.
 */
export function placeAtlasRooms<R extends { placement?: AtlasPlacement }>(layout: AtlasLayout, rooms: readonly R[]): AtlasBoard<R> {
  const slotKeys = new Set(layout.slots.map((s) => s.key));
  const lanes = new Map<string, AtlasBoard<R>["lanes"][number]>();
  const emptyLane = (l: AtlasLane) => ({ ...l, cells: Object.fromEntries(layout.slots.map((s) => [s.key, [] as R[]])), unslotted: [] as R[] });
  for (const fixed of layout.lanes ?? []) lanes.set(fixed.key, emptyLane(fixed));
  const unplaced: R[] = [];
  for (const room of rooms) {
    const place = room.placement;
    if (!place) { unplaced.push(room); continue; }
    let target = lanes.get(place.lane);
    if (!target) {
      if (layout.lanes) { unplaced.push(room); continue; }
      target = emptyLane({ key: place.lane, label: place.laneLabel ?? place.lane });
      lanes.set(place.lane, target);
    }
    if (place.slot && slotKeys.has(place.slot)) target.cells[place.slot]!.push(room);
    else target.unslotted.push(room);
  }
  return { lanes: [...lanes.values()], unplaced };
}
