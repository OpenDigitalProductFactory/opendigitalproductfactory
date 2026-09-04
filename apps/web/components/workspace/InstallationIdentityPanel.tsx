"use client";

// EP-1FABA22D · Purpose-Aware Installation and Ecosystem Productivity
//
// One workspace panel for the whole installation identity: what this install is,
// what that means for the agents connected to it, and how to correct it.
//
// Every sentence here comes from `installation-identity-view` or from the stance
// resolver's own `rationale`, so the panel cannot state a stance the resolver
// would not. Detail stays behind one disclosure, and a material change cannot be
// saved until its impact has been shown.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { SelectField } from "@/components/ui/form/SelectField";
import { TextField } from "@/components/ui/form/TextField";
import { ExpandableCard, Notice, StatusBadge } from "@/components/ui/report-kit";
import {
  declareInstallationIdentity,
  previewInstallationIdentityChange,
} from "@/lib/actions/installation-operating-intent";
// Values come ONLY from identity-presentation: its siblings reach `node:crypto`
// and `node:fs/promises`, and importing a label out of either drags the
// filesystem into this client chunk and fails the production build.
import {
  CONFIRMATION_PRESENTATION,
  ENVIRONMENT_CLASS_LABEL,
  ENVIRONMENT_OPTIONS,
  PURPOSE_OPTIONS,
  type InstallationIdentityImpact,
  type InstallationIdentityView,
} from "@/lib/installation-journey/identity-presentation";
import type {
  InstallationEnvironmentClass,
  InstallationOperatingPurpose,
} from "@dpf/db/installation-operating-intent";

const DIRECTION_INTENT = {
  tightens: "success",
  loosens: "warning",
  unchanged: "neutral",
} as const;

const DIRECTION_LABEL = {
  tightens: "Tighter",
  loosens: "Looser",
  unchanged: "Same",
} as const;

export function InstallationIdentityPanel({ view }: { view: InstallationIdentityView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [purpose, setPurpose] = useState<InstallationOperatingPurpose>(
    view.declaration.primaryPurpose,
  );
  const [environmentClass, setEnvironmentClass] = useState<InstallationEnvironmentClass>(
    view.declaration.environmentClass,
  );
  const [pairedRef, setPairedRef] = useState(
    view.declaration.pairedProductionInstallationRef ?? "",
  );
  const [impact, setImpact] = useState<InstallationIdentityImpact | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const confirmation = CONFIRMATION_PRESENTATION[view.confirmationStatus];
  const input = {
    primaryPurpose: purpose,
    environmentClass,
    pairedProductionInstallationRef: pairedRef,
  };

  // Any edit invalidates a preview the operator has already seen, so the
  // confirm step disappears until the new shape has been previewed again.
  function edited<T>(setter: (next: T) => void) {
    return (next: T) => {
      setImpact(null);
      setMessage(null);
      setError(null);
      setter(next);
    };
  }

  function preview() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await previewInstallationIdentityChange(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setImpact(result.data.impact);
      if (!result.data.impact.material) {
        setMessage("Nothing changes. Saving records that you checked it.");
      }
    });
  }

  function declare() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await declareInstallationIdentity(input, impact?.previewToken);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // A refused change is an outcome, not a failure: it carries the fresh
      // preview the operator now has to look at.
      if (result.data.kind === "needs-preview") {
        setError(result.data.reason);
        setImpact(result.data.impact);
        return;
      }
      setImpact(null);
      setMessage(
        result.data.confirmationStatus === "confirmed"
          ? "Saved. This is what the installation is."
          : "Saved, but a higher authority sets the environment. See the note above.",
      );
      router.refresh();
    });
  }

  return (
    <section
      className="border-b border-[var(--dpf-border)] px-4 py-4 sm:px-6"
      aria-labelledby="installation-identity-heading"
    >
      {/* The lead band is the identity statement itself — the first thing the
          operator reads. The stance rationales below are detail, not lead. */}
      <div data-dpf-lead="installation-identity">
        <div className="mb-2 flex items-start justify-between gap-4">
          <div>
            <h2
              id="installation-identity-heading"
              className="text-base font-semibold text-[var(--dpf-text)]"
            >
              About this installation
            </h2>
            <p className="mt-1 text-sm text-[var(--dpf-muted)]">
              What this installation is decides what your AI coworkers may do here.
            </p>
          </div>
          <StatusBadge intent={confirmation.intent} label={confirmation.label} size="md" />
        </div>

        <p className="text-sm text-[var(--dpf-text)]">{view.headline}</p>
        {view.detail ? (
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">{view.detail}</p>
        ) : null}
      </div>

      {view.environment.shadowedPortalDeclaration ? (
        <Notice variant="warn" title="Your saved choice is not the one in force." className="mt-3">
          <p className="text-xs">
            Run the installer again with{" "}
            <code className="rounded bg-[var(--dpf-surface-2)] px-1">--environment-class</code> to
            change the value in force.
          </p>
        </Notice>
      ) : null}

      {view.intentStatus === "invalid" ? (
        <Notice variant="error" title="The stored record could not be read." className="mt-3">
          <p className="text-xs">Declare the identity again to replace it.</p>
        </Notice>
      ) : null}

      <h3 className="mt-4 text-xs font-semibold text-[var(--dpf-muted)]">
        What your AI coworkers may do here
      </h3>
      <ul className="mt-2 grid gap-2">
        {view.stances.map((row) => (
          <Surface as="li" key={row.stance} level={2} padding="sm" rounded="md">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-[var(--dpf-text)]">{row.label}</span>
              <StatusBadge intent={row.intent} label={row.valueLabel} />
            </div>
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">{row.rationale}</p>
          </Surface>
        ))}
      </ul>

      <p className="mt-2 text-xs text-[var(--dpf-muted)]">
        A stance is a brake, never a permission. Access still comes from roles, grants, and
        approved links.
      </p>

      <div className="mt-4" data-owner-first-next-action="change-installation-identity">
        <ExpandableCard
          id="installation-identity-change"
          open={open}
          onOpenChange={setOpen}
          headingLevel={3}
          summary={
            <span className="text-sm font-medium text-[var(--dpf-text)]">
              Change what this installation is
            </span>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              name="installation-purpose"
              label="Its main job"
              value={purpose}
              onValueChange={edited((next: string) =>
                setPurpose(next as InstallationOperatingPurpose),
              )}
              options={[...PURPOSE_OPTIONS]}
              disabled={isPending}
            />
            <SelectField
              name="installation-environment"
              label="Environment"
              value={environmentClass}
              onValueChange={edited((next: string) =>
                setEnvironmentClass(next as InstallationEnvironmentClass),
              )}
              options={[...ENVIRONMENT_OPTIONS]}
              hint={
                view.environment.installerStateValue
                  ? `The installer set ${ENVIRONMENT_CLASS_LABEL[view.environment.installerStateValue].toLowerCase()}. That value wins here.`
                  : "No installer value is set, so your choice is the one in force."
              }
              disabled={isPending}
            />
            <TextField
              name="installation-paired-ref"
              label="Paired installation"
              value={pairedRef}
              onValueChange={edited(setPairedRef)}
              optional
              autoComplete="off"
              hint="Name the production install this one learns from. Leave it empty if there is none."
              className="sm:col-span-2"
              disabled={isPending}
            />
          </div>

          {impact ? <IdentityImpactPreview impact={impact} /> : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {impact ? (
              <>
                <Button
                  onClick={declare}
                  disabled={isPending}
                  data-owner-first-next-action="declare-installation-identity"
                >
                  {isPending ? "Saving" : "Yes, this is what it is"}
                </Button>
                <Button variant="secondary" onClick={() => setImpact(null)} disabled={isPending}>
                  Leave it as it is
                </Button>
              </>
            ) : (
              <Button
                onClick={preview}
                disabled={isPending}
                data-owner-first-next-action="preview-installation-identity"
              >
                {isPending ? "Working" : "Show me the impact"}
              </Button>
            )}
          </div>

          {!impact ? (
            <p className="mt-2 text-xs text-[var(--dpf-muted)]">
              Nothing is saved until you see the impact and confirm it.
            </p>
          ) : null}

          {message ? (
            <p className="mt-2 text-xs text-[var(--dpf-muted)]" role="status">
              {message}
            </p>
          ) : null}
          {error ? (
            <p className="mt-2 text-xs text-[var(--dpf-error)]" role="alert">
              {error}
            </p>
          ) : null}
        </ExpandableCard>
      </div>
    </section>
  );
}

function IdentityImpactPreview({ impact }: { impact: InstallationIdentityImpact }) {
  if (!impact.material) {
    return (
      <Notice variant="info" title="Nothing changes." className="mt-4">
        <p className="text-xs">The identity you chose is the one already in force.</p>
      </Notice>
    );
  }

  return (
    <Surface level={2} padding="sm" rounded="md" className="mt-4">
      <h4 className="text-xs font-semibold text-[var(--dpf-text)]">What you are changing</h4>
      <ul className="mt-2 grid gap-1">
        {impact.changes.map((change) => (
          <li key={change.field} className="text-xs text-[var(--dpf-muted)]">
            <span className="font-medium text-[var(--dpf-text)]">{change.label}:</span>{" "}
            {change.from} <span aria-hidden="true">&rarr;</span>{" "}
            <span className="sr-only">becomes</span>
            <span className="font-medium text-[var(--dpf-text)]">{change.to}</span>
          </li>
        ))}
      </ul>

      <h4 className="mt-3 text-xs font-semibold text-[var(--dpf-text)]">
        What agents may do after this
      </h4>
      <ul className="mt-2 grid gap-2">
        {impact.stanceDeltas.map((delta) => (
          <li key={delta.stance} className="text-xs">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-[var(--dpf-text)]">{delta.label}</span>
              <StatusBadge
                intent={DIRECTION_INTENT[delta.direction]}
                label={DIRECTION_LABEL[delta.direction]}
              />
              <span className="text-[var(--dpf-muted)]">
                {delta.direction === "unchanged"
                  ? delta.to
                  : `${delta.from} → ${delta.to}`}
              </span>
            </span>
            <p className="mt-1 text-[var(--dpf-muted)]">{delta.rationale}</p>
          </li>
        ))}
      </ul>

      {impact.warnings.map((warning) => (
        <Notice key={warning} variant="warn" className="mt-3">
          <p className="text-xs">{warning}</p>
        </Notice>
      ))}

      {impact.staleEvidence.length > 0 ? (
        <Notice
          variant="info"
          title={
            impact.staleEvidence.length === 1
              ? "One evidence note goes stale."
              : `${impact.staleEvidence.length} evidence notes go stale.`
          }
          className="mt-3"
        >
          <ul className="mt-1 grid gap-1">
            {impact.staleEvidence.map((note) => (
              <li key={`${note.source}:${note.claim}`} className="text-xs">
                {note.claim} <span className="text-[var(--dpf-muted)]">{note.reason}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            They stay in the record as history.
          </p>
        </Notice>
      ) : null}
    </Surface>
  );
}
