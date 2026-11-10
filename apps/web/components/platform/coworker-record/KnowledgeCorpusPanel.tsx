// apps/web/components/platform/coworker-record/KnowledgeCorpusPanel.tsx
// BI-825D3487 (AC-CRG-6): the knowledge corpora this coworker may read, as
// lib/tak/corpus-read-scope.ts resolves them — kernel, organization and the
// profession families — and whether it maps to a family at all. Read-only:
// grants change through the Capabilities editor and the coworker grant core.
// Server-usable (no hooks); the record page passes copy from the coworkerRecord catalog.

import type { MessageArgs, MessageKey } from "@dpf/i18n";

import { StatusBadge } from "@/components/ui/report-kit";
import { Surface } from "@/components/ui/Surface";
import { findProfessionFamilyByKey } from "@/lib/decision-perspective/resolve-profession-profile";
import type { CorpusReadScope } from "@/lib/tak/corpus-read-scope";

import { Section } from "./panels";

export type KnowledgeCorpusLabels = {
  heading: string; kernel: string; organization: string; families: string;
  granted: string; revoked: string; mapped: string; notMapped: string;
  reportOnlyAll: string; noFamily: string; ownFamily: string; mode: string;
};

const LABEL_KEYS = ["heading", "kernel", "organization", "families", "granted", "revoked", "mapped", "notMapped",
  "reportOnlyAll", "noFamily", "ownFamily"] as const;

/** Builds the panel copy from a coworkerRecord translator (getT on the server, translate in tests). */
export function knowledgeCorpusLabels(t: (key: MessageKey<"coworkerRecord">, args?: MessageArgs) => string, mode: string): KnowledgeCorpusLabels {
  const labels = Object.fromEntries(LABEL_KEYS.map((key) => [key, t(`knowledgeCorpus.${key}`)])) as Omit<KnowledgeCorpusLabels, "mode">;
  return { ...labels, mode: t("knowledgeCorpus.mode", { mode }) };
}

function GrantRow({ label, grant, held, labels }: { label: string; grant: string; held: boolean; labels: KnowledgeCorpusLabels }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--dpf-border)] py-2 last:border-b-0">
      <div className="min-w-0">
        <div className="text-xs font-medium text-[var(--dpf-text)]">{label}</div>
        <code className="text-dpf-caption text-[var(--dpf-muted)]">{grant}</code>
      </div>
      <StatusBadge intent={held ? "success" : "neutral"} label={held ? labels.granted : labels.revoked} />
    </div>
  );
}

export function KnowledgeCorpusPanel({ scope, labels }: { scope: CorpusReadScope; labels: KnowledgeCorpusLabels }) {
  const families = scope.professionFamilies === null
    ? null
    : [...scope.professionFamilies].sort((a, b) => Number(b === scope.familyKey) - Number(a === scope.familyKey) || a.localeCompare(b));
  return (
    <Section title={labels.heading}>
      <Surface padding="none" rounded="md" className="px-3">
        <GrantRow label={labels.kernel} grant="wiki_kernel_read" held={scope.kernel} labels={labels} />
        <GrantRow label={labels.organization} grant="wiki_org_read" held={scope.organization} labels={labels} />
        <div className="py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-medium text-[var(--dpf-text)]">{labels.families}</div>
            <StatusBadge intent={scope.mapped ? "success" : "warning"} label={scope.mapped ? labels.mapped : labels.notMapped} />
          </div>
          {families === null ? (
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">{labels.reportOnlyAll}</p>
          ) : families.length === 0 ? (
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">{labels.noFamily}</p>
          ) : (
            <ul className="mt-1 flex flex-wrap gap-2">
              {families.map((key) => (
                <li key={key} className="flex items-center gap-1 text-xs text-[var(--dpf-text)]">
                  <span>{findProfessionFamilyByKey(key)?.label ?? key}</span>
                  {key === scope.familyKey && <StatusBadge intent="info" label={labels.ownFamily} size="sm" />}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Surface>
      <p className="mt-2 text-dpf-caption text-[var(--dpf-muted)]">{labels.mode}</p>
    </Section>
  );
}
