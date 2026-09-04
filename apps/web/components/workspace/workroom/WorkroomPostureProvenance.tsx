import { buildPostureProvenance, type PostureProvenanceDriver } from "@/lib/work-posture/provenance";
import type { PostureLayer } from "@/lib/work-posture/resolve";
import type { WorkroomPostureView } from "@/lib/work-management/room-posture";

// EP-WORK-POSTURE Slice H (BI-4EB2F1D0) — the layer-by-layer account.
//
// Answers "why is it behaving like this" without reading code: which of the
// precedence layers set each value, and what drove it.
//
// Nested inside the section's own collapsed disclosure, so it adds nothing to
// the arrival view. The UX budget measure excises collapsed content from
// defaultVisibleWords, and /platform/ai/assignments — the other surface this
// epic touches — is already well over its word budget (BI-6786CE44).
//
// This component DECIDES NOTHING. Every reason string is carried verbatim from
// the resolver's PolicyAdjustment chain; nothing here is re-derived.

const LAYER_COPY: Record<PostureLayer, string> = {
  "hard-policy": "Policy",
  "room-declaration": "This room",
  derived: "The work itself",
  "workroom-default": "Default for rooms",
  agent: "The coworker",
  organization: "The organisation",
  platform: "Platform default",
};

const FIELD_COPY: Record<string, string> = {
  proactivityLevel: "Pace",
  actionBoundary: "Authority",
  minimumTier: "Model floor",
  verificationDepth: "Checking",
  priority: "Priority",
};

// Only the drivers that add something the layer name does not already say.
const DRIVER_COPY: Partial<Record<PostureProvenanceDriver, string>> = {
  "work-shape": "the shape of the work",
  "activity-kind": "the kind of activity",
  "archetype-stream": "the value stream",
  clock: "the clock",
  "room-mode": "the room mode",
  unclassified: "an unnamed input",
};

function fieldLabel(field: string): string {
  return FIELD_COPY[field] ?? field;
}

export function WorkroomPostureProvenance({ posture }: { posture: WorkroomPostureView }) {
  // Honest empty state. A room that derived nothing and declared nothing gets
  // one plain sentence, not a rich chain implying decisions nobody made.
  if (posture.inert) {
    return (
      <p className="text-xs text-[var(--dpf-muted)]">
        Running platform defaults. Nothing about this room changed them.
      </p>
    );
  }

  const provenance = buildPostureProvenance(posture);

  return (
    <details>
      <summary className="min-h-11 cursor-pointer list-none py-2 text-xs font-semibold text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">
        How this was decided
      </summary>

      <ol className="mt-1 space-y-2 border-l border-[var(--dpf-border)] pl-3">
        {provenance.layers.map((layer) => (
          <li key={layer.layer}>
            <p className="text-xs font-medium text-[var(--dpf-text)]">
              {LAYER_COPY[layer.layer]}
              {layer.decidedFields.length > 0 ? (
                <span className="font-normal text-[var(--dpf-muted)]">
                  {" — set "}
                  {layer.decidedFields.map(fieldLabel).join(", ").toLowerCase()}
                </span>
              ) : null}
            </p>

            {layer.contributed ? null : (
              <p className="text-xs text-[var(--dpf-muted)]">Nothing from here.</p>
            )}

            {layer.steps.length > 0 ? (
              <ul className="mt-1 space-y-1">
                {layer.steps.map((step, index) => (
                  <li
                    key={`${step.field}:${step.reasonCode}:${index}`}
                    className="text-xs text-[var(--dpf-muted)]"
                  >
                    <span className="text-[var(--dpf-text)]">{fieldLabel(step.field)}</span>
                    {": "}
                    {step.reason}
                    {DRIVER_COPY[step.driver] ? ` (from ${DRIVER_COPY[step.driver]})` : ""}
                    {step.decisive ? "" : " Later overridden."}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
    </details>
  );
}
