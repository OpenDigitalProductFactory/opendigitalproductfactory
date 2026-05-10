"use client";
import { AlertCircle, CheckCircle2, FileText, Target, Users } from "lucide-react";
import type { ReactNode } from "react";
import type { BusinessBuildBrief } from "@/lib/build/business-build-brief";

interface Props {
  brief: BusinessBuildBrief;
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

export function BusinessBriefPanel({ brief }: Props) {
  const needsClarification = brief.openQuestions.length > 0;

  return (
    <div className="h-full overflow-auto bg-[var(--dpf-bg)] text-[var(--dpf-text)]">
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
        <h2 className="m-0 text-[17px] font-bold tracking-normal text-[var(--dpf-text)]">
          {brief.title}
        </h2>
      </header>

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
