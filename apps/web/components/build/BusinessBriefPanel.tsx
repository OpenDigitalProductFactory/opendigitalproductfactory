"use client";
import { AlertCircle, CheckCircle2, FileText, Pencil, Save, Target, Users } from "lucide-react";
import type { ReactNode } from "react";
import { useId, useState, useTransition } from "react";
import { updateBusinessBuildBrief } from "@/lib/actions/build";
import type {
  BusinessBriefEvidence,
  BusinessBriefEvidenceKind,
  BusinessBuildBrief,
  BusinessBuildBriefSource,
} from "@/lib/build/business-build-brief";

interface Props {
  brief: BusinessBuildBrief;
  onSaved?: () => void | Promise<void>;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-[var(--dpf-border)] px-5 py-4 last:border-b-0">
      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--dpf-muted)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-h-7 items-center rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 text-[12px] font-medium text-[var(--dpf-text)]">
      {children}
    </span>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="m-0 text-[13px] text-[var(--dpf-muted)]">{children}</p>;
}

function textFromList(values: string[]): string {
  return values.join("\n");
}

function textFromEvidence(brief: BusinessBuildBrief): string {
  return brief.sourceEvidence.map((evidence) => evidence.summary).join("\n");
}

function evidenceKindFromBrief(brief: BusinessBuildBrief): BusinessBriefEvidenceKind {
  const firstKind = brief.sourceEvidence[0]?.kind;
  if (
    firstKind === "document" ||
    firstKind === "screenshot" ||
    firstKind === "spreadsheet" ||
    firstKind === "url" ||
    firstKind === "existing_route" ||
    firstKind === "backlog_item" ||
    firstKind === "feature_build" ||
    firstKind === "email" ||
    firstKind === "existing_example"
  ) {
    return firstKind;
  }
  if (brief.intakeSource === "existing_example") return "existing_example";
  if (brief.intakeSource === "artifact_reference") return "document";
  return "artifact";
}

function intakeSourceFromEvidenceKind(kind: BusinessBriefEvidenceKind): BusinessBuildBriefSource {
  if (kind === "existing_example" || kind === "existing_route" || kind === "feature_build") {
    return "existing_example";
  }
  return "artifact_reference";
}

function copyAdaptAvoidText(evidence: BusinessBriefEvidence[]): string {
  const first = evidence.find((item) => item.kind === "existing_example");
  if (!first) return "";
  return [
    ...(first.copy ?? []).map((entry) => `Copy: ${entry}`),
    ...(first.adapt ?? []).map((entry) => `Adapt: ${entry}`),
    ...(first.avoid ?? []).map((entry) => `Avoid: ${entry}`),
  ].join("\n");
}

const EVIDENCE_KIND_OPTIONS: Array<{
  value: BusinessBriefEvidenceKind;
  label: string;
}> = [
  { value: "document", label: "Document or artifact" },
  { value: "screenshot", label: "Screenshot or visual example" },
  { value: "spreadsheet", label: "Spreadsheet or working tracker" },
  { value: "url", label: "Public URL or vendor guide" },
  { value: "existing_example", label: "Something that already works" },
];

function Field({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <label className="grid gap-1.5 text-[13px] font-semibold text-[var(--dpf-text)]">
      {label}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        className="min-h-20 resize-y rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-[13px] font-normal leading-5 text-[var(--dpf-text)] outline-none transition-colors focus:border-[var(--dpf-accent)]"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: BusinessBriefEvidenceKind;
  onChange: (value: BusinessBriefEvidenceKind) => void;
}) {
  return (
    <label className="grid gap-1.5 text-[13px] font-semibold text-[var(--dpf-text)]">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as BusinessBriefEvidenceKind)}
        className="min-h-10 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 text-[13px] font-normal text-[var(--dpf-text)] outline-none transition-colors focus:border-[var(--dpf-accent)]"
      >
        {EVIDENCE_KIND_OPTIONS.map((option) => (
          <option
            key={option.value}
            className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
            value={option.value}
          >
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function BusinessBriefPanel(props: Props) {
  const briefIdentity = props.brief.briefId ?? `legacy:${props.brief.title}`;
  return <BusinessBriefPanelContent key={briefIdentity} {...props} />;
}

function BusinessBriefPanelContent({ brief, onSaved }: Props) {
  const headingId = useId();
  const needsClarification = brief.openQuestions.length > 0;
  const [isEditing, setIsEditing] = useState(Boolean(brief.briefId));
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [businessOutcome, setBusinessOutcome] = useState(brief.businessOutcome);
  const [affectedPeopleText, setAffectedPeopleText] = useState(textFromList(brief.affectedPeople));
  const [affectedWorkflow, setAffectedWorkflow] = useState(brief.affectedWorkflow ?? "");
  const [sourceEvidenceText, setSourceEvidenceText] = useState(textFromEvidence(brief));
  const [evidenceKind, setEvidenceKind] = useState<BusinessBriefEvidenceKind>(evidenceKindFromBrief(brief));
  const [copyAdaptAvoid, setCopyAdaptAvoid] = useState(copyAdaptAvoidText(brief.sourceEvidence));
  const [successSignalsText, setSuccessSignalsText] = useState(textFromList(brief.successSignals));
  const [constraintsText, setConstraintsText] = useState(textFromList(brief.constraints));
  const [openQuestionsText, setOpenQuestionsText] = useState(textFromList(brief.openQuestions));

  function saveBrief(accept: boolean) {
    const briefId = brief.briefId;
    if (!briefId) return;
    setMessage(null);
    startTransition(async () => {
      try {
        await updateBusinessBuildBrief({
          briefId,
          intakeSource: intakeSourceFromEvidenceKind(evidenceKind),
          evidenceKind,
          businessOutcome,
          affectedPeopleText,
          affectedWorkflow,
          sourceEvidenceText,
          copyAdaptAvoidText: copyAdaptAvoid,
          successSignalsText,
          constraintsText,
          openQuestionsText,
          accept,
        });
        await onSaved?.();
        setMessage(accept ? "Brief accepted." : "Brief saved.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "The brief could not be saved.");
      }
    });
  }

  return (
    <div
      role="region"
      aria-labelledby={headingId}
      className="h-full overflow-auto bg-[var(--dpf-bg)] text-[var(--dpf-text)]"
    >
      <header className="border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-5 py-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Pill>{brief.capabilityPack}</Pill>
          <Pill>{brief.intakeSource.replace(/_/g, " ")}</Pill>
          <span
            className="inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium"
            style={{
              background: needsClarification
                ? "color-mix(in srgb, var(--dpf-warning) 12%, var(--dpf-surface-1))"
                : "color-mix(in srgb, var(--dpf-success) 12%, var(--dpf-surface-1))",
              borderColor: needsClarification
                ? "color-mix(in srgb, var(--dpf-warning) 35%, var(--dpf-border))"
                : "color-mix(in srgb, var(--dpf-success) 35%, var(--dpf-border))",
            }}
          >
            {needsClarification ? <AlertCircle size={13} /> : <CheckCircle2 size={13} />}
            {needsClarification ? "Needs clarification" : "Ready for interpretation"}
          </span>
        </div>
        <h2 id={headingId} className="m-0 text-[17px] font-bold tracking-normal text-[var(--dpf-text)]">
          {brief.title}
        </h2>
        {brief.briefId && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsEditing((value) => !value)}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 text-[12px] font-semibold text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)]"
            >
              <Pencil size={13} />
              Edit brief
            </button>
            {message && (
              <span className="text-[12px] font-medium text-[var(--dpf-muted)]">
                {message}
              </span>
            )}
          </div>
        )}
      </header>

      {brief.briefId && isEditing && (
        <Section title="Edit business brief">
          <div className="grid gap-3">
            <Field label="Business outcome" value={businessOutcome} onChange={setBusinessOutcome} rows={4} />
            <Field label="Affected people" value={affectedPeopleText} onChange={setAffectedPeopleText} />
            <Field label="Affected workflow" value={affectedWorkflow} onChange={setAffectedWorkflow} rows={2} />
            <SelectField label="Reference type" value={evidenceKind} onChange={setEvidenceKind} />
            <Field label="Source evidence" value={sourceEvidenceText} onChange={setSourceEvidenceText} />
            {evidenceKind === "existing_example" && (
              <Field
                label="Copy, adapt, avoid"
                value={copyAdaptAvoid}
                onChange={setCopyAdaptAvoid}
                rows={4}
              />
            )}
            <Field label="Success signals" value={successSignalsText} onChange={setSuccessSignalsText} />
            <Field label="Constraints" value={constraintsText} onChange={setConstraintsText} />
            <Field label="Open questions" value={openQuestionsText} onChange={setOpenQuestionsText} />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={() => saveBrief(false)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 text-[13px] font-semibold text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Save size={14} />
                Save brief
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => saveBrief(true)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-[var(--dpf-accent)] px-3 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CheckCircle2 size={14} />
                Accept brief
              </button>
            </div>
          </div>
        </Section>
      )}

      <Section title="Business outcome">
        <p className="m-0 max-w-3xl text-[14px] leading-6 text-[var(--dpf-text)]">
          {brief.businessOutcome}
        </p>
      </Section>

      <Section title="Affected people">
        {brief.affectedPeople.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {brief.affectedPeople.map((person) => (
              <Pill key={person}>
                <Users size={13} className="mr-1.5" />
                {person}
              </Pill>
            ))}
          </div>
        ) : (
          <Empty>No affected role has been confirmed yet.</Empty>
        )}
      </Section>

      <Section title="Source evidence">
        {brief.sourceEvidence.length > 0 ? (
          <div className="grid gap-2">
            {brief.sourceEvidence.map((evidence) => (
              <article
                key={`${evidence.kind}-${evidence.label}`}
                className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3"
              >
                <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-[var(--dpf-text)]">
                  <FileText size={14} />
                  {evidence.label}
                </div>
                <p className="m-0 text-[12.5px] leading-5 text-[var(--dpf-muted)]">
                  {evidence.summary}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <Empty>No artifact, example, or coworker evidence has been attached yet.</Empty>
        )}
      </Section>

      <Section title="Success signals">
        {brief.successSignals.length > 0 ? (
          <ul className="m-0 grid gap-2 p-0">
            {brief.successSignals.map((signal) => (
              <li key={signal} className="flex gap-2 text-[13px] leading-5 text-[var(--dpf-text)]">
                <Target size={14} className="mt-0.5 shrink-0 text-[var(--dpf-accent)]" />
                <span>{signal}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No business success signal has been confirmed yet.</Empty>
        )}
      </Section>

      {needsClarification && (
        <Section title="Open questions">
          <ul className="m-0 grid gap-2 p-0">
            {brief.openQuestions.map((question) => (
              <li key={question} className="text-[13px] leading-5 text-[var(--dpf-text)]">
                {question}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="How DPF will likely build this">
        <dl className="m-0 grid gap-2 text-[13px]">
          <div>
            <dt className="font-semibold text-[var(--dpf-text)]">Data needed</dt>
            <dd className="m-0 mt-1 text-[var(--dpf-muted)]">
              {brief.technicalInterpretation.dataNeeds ?? "No data needs have been identified yet."}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--dpf-text)]">Verification focus</dt>
            <dd className="m-0 mt-1 text-[var(--dpf-muted)]">
              {brief.technicalInterpretation.verificationFocus.length > 0
                ? brief.technicalInterpretation.verificationFocus.join("; ")
                : "Build Studio will generate checks after the business outcome is clear."}
            </dd>
          </div>
        </dl>
      </Section>
    </div>
  );
}
