// A stalled Workroom must reach a human (BI-03E94B5B).
//
// WC-A69BCABB woke every 15 minutes for days and refused every one:
//   conformance_pause / missing_explicit_coordinator
// Each refusal was written faithfully to workspaceState.workroomDrive and to a
// WorkroomActivity row. Nothing read either. 328 wakes produced 0 dispatches and
// 0 notifications, and the only reason anyone found out was a human going
// looking. That is the defect this source closes: the drive already knows it is
// stuck, so being stuck must cost someone an inbox item.
//
// The threshold is deliberately not 1. A single paused tick is ordinary — a room
// between cycles, a quiescent gate. An hour of consecutive refusals is a stall.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { encodeWorkCaseKey } from "@/lib/work-management/case-key";
import {
  STALL_TICK_THRESHOLD,
  projectRoomStall,
  type RoomStallRow,
} from "./workroom-stall";

const APP_ROOT = new URL("../../../app", import.meta.url).pathname;

// Walk the App Router tree the way Next.js does: route groups "(shell)" are
// transparent, and a "[param]" directory matches any single segment. Returns
// false when no directory chain can consume every segment of the path.
function routeExists(href: string): boolean {
  const segments = href.split("?")[0].split("/").filter(Boolean).map(decodeURIComponent);

  function walk(dir: string, remaining: string[]): boolean {
    let entries: string[];
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return false;
    }
    if (remaining.length === 0) return true;
    const [head, ...tail] = remaining;
    for (const entry of entries) {
      // A route group adds nesting without consuming a URL segment.
      if (entry.startsWith("(") && entry.endsWith(")")) {
        if (walk(join(dir, entry), remaining)) return true;
        continue;
      }
      if (entry === head || (entry.startsWith("[") && entry.endsWith("]"))) {
        if (walk(join(dir, entry), tail)) return true;
      }
    }
    return false;
  }

  return segments.length > 0 && walk(APP_ROOT, segments);
}

function pause(reason: string, deviations: string[] = []): unknown {
  return {
    kind: "workroom-drive",
    action: "pause",
    reason,
    conformance: {
      deviations: deviations.map((code) => ({ code, summary: `${code} summary` })),
      processOverseerPrincipalRef: null,
    },
  };
}

function row(over: Partial<RoomStallRow> = {}): RoomStallRow {
  return {
    capsuleId: "WC-A69BCABB",
    title: "Dependency and advisory watch",
    portfolioRole: "foundational",
    updatedAt: new Date("2026-09-06T06:15:00Z"),
    drive: pause("conformance_pause", ["missing_explicit_coordinator"]),
    consecutivePauses: STALL_TICK_THRESHOLD,
    ...over,
  };
}

describe("projectRoomStall", () => {
  it("raises attention for a room that has refused the threshold of consecutive wakes", () => {
    const item = projectRoomStall(row());
    expect(item).not.toBeNull();
    expect(item?.source).toBe("workroom-stall");
    expect(item?.id).toBe("workroom-stall:WC-A69BCABB");
  });

  it("stays silent for a room that is advancing", () => {
    // The overwhelmingly common case. A source that cries on healthy rooms is a
    // source operators learn to ignore, which is worse than no source.
    const item = projectRoomStall(
      row({ drive: { kind: "workroom-drive", action: "dispatch" }, consecutivePauses: 0 }),
    );
    expect(item).toBeNull();
  });

  it("stays silent below the threshold", () => {
    const item = projectRoomStall(row({ consecutivePauses: STALL_TICK_THRESHOLD - 1 }));
    expect(item).toBeNull();
  });

  it("names the room, so the operator is not handed an anonymous alert", () => {
    // BI-79E207B9: thirty-four items rendered the identical generic body. The
    // room names itself; say which one this is.
    const item = projectRoomStall(row());
    expect(item?.title).toContain("Dependency and advisory watch");
    expect(item?.context).toContain("Dependency and advisory watch");
  });

  it("names the reason, so the operator knows what to fix", () => {
    const item = projectRoomStall(row());
    expect(item?.context).toContain("missing_explicit_coordinator");
  });

  it("says how long it has been stuck rather than that it merely is", () => {
    const item = projectRoomStall(row({ consecutivePauses: 328 }));
    expect(item?.context).toContain("328");
  });

  it("routes an unowned room to the operator, because no owner exists to route to", () => {
    // The trap this source must not fall into: assigning the item to the very
    // principal whose absence is the finding.
    const item = projectRoomStall(row());
    expect(item?.audience.operator).toBe(true);
    expect(item?.audience.assigneePrincipalId).toBeUndefined();
  });

  it("routes an owned but stalled room to its accountable principal as well", () => {
    const item = projectRoomStall(
      row({
        drive: {
          kind: "workroom-drive",
          action: "pause",
          reason: "budget_exhausted",
          conformance: { deviations: [], processOverseerPrincipalRef: "PRN-SEC-1" },
        },
      }),
    );
    expect(item?.audience.assigneePrincipalId).toBe("PRN-SEC-1");
    expect(item?.audience.operator).toBe(true);
  });

  it("classifies the stall honestly — no deadline, no irreversibility, real cost", () => {
    const item = projectRoomStall(row());
    expect(item?.triage.timeToAct).toBe("none");
    expect(item?.triage.irreversible).toBe(false);
    expect(item?.triage.residueReason).toBe("room-stalled");
    expect(item?.triage.blastRadius).toBeTruthy();
  });

  it("carries the room's portfolio so the cockpit can place it", () => {
    const item = projectRoomStall(row({ portfolioRole: "productsAndServicesSold" }));
    expect(item?.portfolio).toBe("products-and-services-sold");
  });

  it("deep-links to the room rather than a generic index", () => {
    const item = projectRoomStall(row());
    expect(item?.deepLink).toContain("WC-A69BCABB");
  });

  it("survives a drive payload it does not recognise instead of throwing", () => {
    // workspaceState is untyped JSON written by a queue function. A projector
    // that throws here takes the whole attention inbox down with it.
    expect(projectRoomStall(row({ drive: null }))).toBeNull();
    expect(projectRoomStall(row({ drive: "nonsense" }))).toBeNull();
    expect(projectRoomStall(row({ drive: { action: "pause" }, consecutivePauses: 9 }))).not.toBeNull();
  });
});

// ─── The ladder seam (BI-24E7D59F) ───────────────────────────────────────────
//
// Reporting "nobody owns this" is a diagnosis. Naming who the work shape says
// should drive it is an instruction the operator can act on in one step. All
// twelve standing rooms on this install resolve a driver from their shape, so
// this is the difference between twelve alerts and twelve appointments.

describe("projectRoomStall with a resolved ladder owner", () => {
  it("names the principal the ladder resolved, and how it was resolved", () => {
    const item = projectRoomStall(
      row({ ladderOwner: { principalRef: "agent:security-engineer", source: "shape" } }),
    );
    expect(item?.context).toContain("agent:security-engineer");
    expect(item?.context.toLowerCase()).toContain("shape");
  });

  it("still refuses to assign the item to a merely-derived owner", () => {
    // A derived owner is a SUGGESTION. Routing the item to them would make the
    // room look owned to the very surface reporting that it is not, and
    // conformance still requires an explicit appointment to execute.
    const item = projectRoomStall(
      row({ ladderOwner: { principalRef: "agent:security-engineer", source: "shape" } }),
    );
    expect(item?.audience.assigneePrincipalId).toBeUndefined();
    expect(item?.audience.operator).toBe(true);
  });

  it("says plainly that nobody can be derived when the ladder returns null", () => {
    const item = projectRoomStall(row({ ladderOwner: null }));
    expect(item?.context).toContain("No owner can be derived");
  });
});

// ─── Escalation is a stall too (BI-2A5F1E77) ─────────────────────────────────
//
// Found live, immediately after the first appointment worked. WC-A69BCABB left
// `pause` and entered `escalate` — and escalate writes no pendingAttention, so a
// source watching only `pause` handed the room from a state it covered into a
// state nothing reads. The room stopped being reported at the exact moment it
// started needing a human.
//
// An escalation with no channel is a stall with extra steps.

describe("projectRoomStall over escalating rooms", () => {
  const escalating = (over: Record<string, unknown> = {}) => ({
    kind: "workroom-drive",
    action: "escalate",
    reason: "conformance_escalate",
    conformance: {
      deviations: [{ code: "coordinator_authority_binding_ineligible", summary: "s" }],
      processOverseerPrincipalRef: "PRN-SEC-1",
      interventionReason: "The AI Process Overseer's TAK authority binding is unknown.",
    },
    ...over,
  });

  it("raises attention for a room stuck escalating", () => {
    const item = projectRoomStall(row({ drive: escalating() }));
    expect(item).not.toBeNull();
    expect(item?.context).toContain("coordinator_authority_binding_ineligible");
  });

  it("routes an escalating room to its overseer, who now exists", () => {
    // Unlike the unowned case, an escalating room HAS an owner — the escalation
    // is theirs to answer.
    const item = projectRoomStall(row({ drive: escalating() }));
    expect(item?.audience.assigneePrincipalId).toBe("PRN-SEC-1");
  });

  it("still stays silent for a room that is advancing", () => {
    expect(
      projectRoomStall(
        row({ drive: { kind: "workroom-drive", action: "dispatch" }, consecutivePauses: 9 }),
      ),
    ).toBeNull();
  });

  it("counts an escalation streak the same way it counts a pause streak", () => {
    expect(projectRoomStall(row({ drive: escalating(), consecutivePauses: 1 }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The room the card points at must exist (BI-6F2CC21B).
//
// The operator reported that no "Open room" button on the Needs-you inbox
// worked. This source emitted `/ea/workrooms/<capsuleId>`, a path with no
// dynamic segment behind it, so every card 404'd — a total failure that shipped
// because nothing asserted the link resolved. The canonical room address
// already existed (encodeWorkCaseKey, used by the workrooms index); this source
// hand-built a second shape instead of composing it.
//
// These two tests are deliberately a pair. The first pins the address to the
// canonical helper, so a hand-built path fails. The second walks the real App
// Router tree, so renaming the route fails the test rather than the operator's
// inbox.

describe("the emitted room link is reachable", () => {
  it("addresses the room by its canonical work-case key, not a hand-built path", () => {
    const item = projectRoomStall(row());
    const expected = `/workspace/cases/${encodeWorkCaseKey({
      sourceType: "work-capsule",
      sourceId: "WC-A69BCABB",
    })}`;
    expect(item?.deepLink).toBe(expected);
    expect(item?.actions?.[0]?.href).toBe(expected);
  });

  it("emits a path that resolves to a real App Router route", () => {
    const item = projectRoomStall(row());
    expect(routeExists(item?.deepLink ?? "")).toBe(true);
  });
});
