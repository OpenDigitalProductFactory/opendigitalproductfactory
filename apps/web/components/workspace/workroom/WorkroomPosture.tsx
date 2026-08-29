import { Surface } from "@/components/ui/Surface";

import { WorkroomPostureControl } from "./WorkroomPostureControl";
import { WorkroomPostureProvenance } from "./WorkroomPostureProvenance";
import type { WorkroomView } from "@/lib/work-management/room-types";

// EP-WORK-POSTURE Slice D (BI-4F468192) — make the room's posture observable.
//
// Deliberately minimal. It answers "how hard is this room pushing, how is it
// trading cost against quality against time, and WHY" — and stops there. The
// rich provenance surface (layer-by-layer, with the full adjustment chain) is
// BI-4EB2F1D0.
//
// Collapsed by default, matching the sibling Work / Context / Decisions
// sections, so it adds nothing to the first viewport.

const LEVEL_COPY: Record<string, string> = {
  quiet: "Quiet",
  balanced: "Follows up",
  assertive: "Pushes",
};

const BOUNDARY_COPY: Record<string, string> = {
  advise: "advises",
  propose: "asks first",
  preauthorized: "acts alone",
};

const BAND_COPY: Record<string, string> = {
  "in-hours": "open",
  "out-of-hours": "closed",
  "low-traffic": "quiet",
  "pre-deadline": "due soon",
  "breach-imminent": "overdue",
};

const SOURCE_COPY: Record<string, string> = {
  "hard-policy": "policy",
  "room-declaration": "this room",
  derived: "the work shape",
  agent: "the coworker",
  organization: "the organisation",
  platform: "the default",
};

function dominantAxis(priority: WorkroomView["posture"] extends null ? never : NonNullable<WorkroomView["posture"]>["priority"]): string | null {
  if (!priority) return null;
  const { costWeight: cost, qualityWeight: quality, timeWeight: time } = priority;
  if (Math.abs(quality - cost) < 0.04 && Math.abs(quality - time) < 0.04) return null;
  if (quality >= cost && quality >= time) return "Quality first";
  if (cost >= time) return "Cost first";
  return "Speed first";
}

export function WorkroomPosture({ room }: { room: WorkroomView }) {
  const posture = room.posture;

  return (
    <Surface as="section" aria-label="Pace and priority" padding="none" rounded="xl">
      <details>
        <summary className="min-h-11 cursor-pointer list-none px-4 py-3 text-sm font-semibold text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">
          Pace and priority
        </summary>
        <div className="space-y-3 border-t border-[var(--dpf-border)] px-4 py-3 text-sm">
          {!posture ? (
            <p className="text-[var(--dpf-muted)]">Running on defaults.</p>
          ) : (
            <>
              <div>
                <p className="text-xs text-[var(--dpf-muted)]">Pace</p>
                <p className="mt-1 font-medium text-[var(--dpf-text)]">
                  {LEVEL_COPY[posture.proactivityLevel] ?? posture.proactivityLevel}
                  {", "}
                  {BOUNDARY_COPY[posture.actionBoundary] ?? posture.actionBoundary}.
                </p>
                <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                  From {SOURCE_COPY[posture.proactivitySource] ?? posture.proactivitySource}
                  {posture.temporalBand
                    ? ` · now ${BAND_COPY[posture.temporalBand] ?? posture.temporalBand}`
                    : ""}
                  .
                </p>
              </div>

              {dominantAxis(posture.priority) ? (
                <div>
                  <p className="text-xs text-[var(--dpf-muted)]">Priority</p>
                  <p className="mt-1 text-[var(--dpf-text)]">{dominantAxis(posture.priority)}</p>
                </div>
              ) : null}

              {posture.verificationDepth && posture.verificationDepth !== "none" ? (
                <div>
                  <p className="text-xs text-[var(--dpf-muted)]">Checking</p>
                  <p className="mt-1 text-[var(--dpf-text)]">Verified before done.</p>
                </div>
              ) : null}

              {/* The layer-by-layer account (BI-4EB2F1D0). It subsumes the flat
                  "Why" list this section used to render — the same reasons, now
                  attributed to the layer that produced them — so the reasons
                  appear once rather than twice. */}
              <WorkroomPostureProvenance posture={posture} />
            </>
          )}

          {/* The control the section used to imply and not provide. Rendered
              only when the room is actually writable — a control with nothing
              to target would be the inert surface this epic exists to remove. */}
          {posture?.editable ? (
            <WorkroomPostureControl
              roomRowId={posture.editable.roomRowId}
              caseKey={posture.editable.caseKey}
              currentShape={posture.editable.declaredShape as never}
              currentPace={posture.proactivityLevel}
              currentAuthority={posture.actionBoundary}
              hasDeclaration={posture.editable.hasDeclaration}
            />
          ) : null}
        </div>
      </details>
    </Surface>
  );
}
