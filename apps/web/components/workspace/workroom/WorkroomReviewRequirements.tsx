import { EmptyState, Notice, StatusBadge } from "@/components/ui/report-kit";
import type { WorkroomView } from "@/lib/work-management/room-types";

const disclosureClass = "min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold text-dpf-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]";

/** Present the authorized profile; composing requirements never assesses them. */
export function WorkroomReviewRequirements({ profile }: { profile?: WorkroomView["reviewProfile"] }) {
  const source = profile?.source;

  return (
    <section aria-label="Review and learning" className="rounded-dpf-xl border border-dpf-border bg-dpf-surface-1">
      <details>
        <summary className={disclosureClass}>Review requirements</summary>
        <div className="space-y-4 border-t border-dpf-border px-4 py-4">
          <StatusBadge intent="neutral" label="Not yet assessed" variant="soft" />
          <p className="text-sm text-dpf-muted">Organization fit has not been assessed.</p>
          <p className="text-sm text-dpf-muted">Requirements describe what must be checked. They do not establish a passed review.</p>
          {!source ? (
            <EmptyState size="sm" bordered={false} title="Review requirements are unavailable."
              description="The source profile is missing. No review result can be inferred." />
          ) : source.status !== "resolved" ? (
            <Notice variant="warn" title={source.status === "unsupported"
              ? "This source has no supported review profile." : "Requirements need reconciliation."}>
              <p>Keep the unresolved requirements for the delivery owner to reconcile before relying on this profile.</p>
            </Notice>
          ) : null}
          {source ? (
            <>
              <ul className="space-y-4">
                {source.requirements.map((requirement) => (
                  <li key={requirement.ref} className="space-y-2 border-l-2 border-dpf-border pl-3 text-sm">
                    <p className="font-dpf-medium text-dpf-text">{requirement.outcome}</p>
                    <p className="text-dpf-muted">Compare against: {requirement.denominator}</p>
                    <details>
                      <summary className="min-h-11 cursor-pointer py-3 text-dpf-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">
                        Evidence fields and provenance
                      </summary>
                      <dl className="space-y-2 break-words text-dpf-muted">
                        <div><dt>Required evidence</dt><dd>{requirement.evidence.join(", ") || "Not recorded"}</dd></div>
                        <div><dt>Critical failures</dt><dd>{requirement.criticalFailures.join(", ") || "Not recorded"}</dd></div>
                        <div><dt>Inherited from</dt><dd>{requirement.provenance.join(", ")}</dd></div>
                        {requirement.maxAgeSeconds !== undefined ? (
                          <div><dt>Maximum evidence age</dt><dd>{requirement.maxAgeSeconds} seconds</dd></div>
                        ) : null}
                      </dl>
                    </details>
                  </li>
                ))}
              </ul>
              <details>
                <summary className="min-h-11 cursor-pointer py-3 text-sm text-dpf-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">
                  Profile identity and unresolved references
                </summary>
                <dl className="space-y-2 break-all text-sm text-dpf-muted">
                  <div><dt>Source definition</dt><dd>{source.identity
                    ? `${source.identity.sourceKey} · version ${source.identity.definitionVersion}` : "Unavailable"}</dd></div>
                  <div><dt>Profile fingerprint</dt><dd>{source.fingerprint ?? "Unresolved"}</dd></div>
                  <div><dt>Requirement sources</dt><dd>{source.provenance.join(", ")}</dd></div>
                  <div><dt>Unresolved references</dt><dd>{source.conflicts.join(", ") || "None in this composition"}</dd></div>
                </dl>
              </details>
            </>
          ) : null}
        </div>
      </details>
      <details className="border-t border-dpf-border">
        <summary className={disclosureClass}>Did the change help?</summary>
        <div className="space-y-2 border-t border-dpf-border px-4 py-4 text-sm text-dpf-muted">
          <p>No independent assessment is available in this view.</p>
          <p>An assessment needs an applied version, a comparison window, and an independent reviewer.</p>
          <p>A recorded receipt or closed cycle alone does not establish improvement.</p>
        </div>
      </details>
    </section>
  );
}
