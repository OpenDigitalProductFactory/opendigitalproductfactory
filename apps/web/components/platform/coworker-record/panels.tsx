// apps/web/components/platform/coworker-record/panels.tsx
// EP-AI-WORKFORCE-001 (HRIS surface) — server-rendered tab panels for the
// coworker "employee record". Pure functions of the loaded CoworkerRecord
// (plus, for Capabilities, the page-built model-routing card). Theme tokens
// only (AGENTS.md §12) — no hardcoded hex.

import Link from "next/link";
import type { CoworkerRecord } from "@/lib/coworker-record/load-record";
import type { CorpusGapRow, CorpusUsageRollup } from "@/lib/coworker-record/corpus-signals";
import { jurisdictionGaps } from "@/lib/coworker-record/coverage";
import {
  PROFESSION_JURISDICTIONS,
  PROFESSION_COMPETENCY_LEVELS,
} from "@dpf/db/wiki-taxonomy";
import { LocalTime } from "@/components/ui/LocalTime";
import { getOversightCopy, oversightLabel } from "@/lib/workforce/oversight-copy";

const GAP_REASON_LABEL: Record<string, string> = {
  unmapped: "Unmapped role",
  "empty-corpus": "Empty corpus",
  "low-relevance": "Not covered",
  deferred: "Deferred",
  "bet-completed": "Bet learning",
};

// ─── Shared primitives ───────────────────────────────────────────────────────

export function Section({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, color: "var(--dpf-text)", margin: 0 }}>
          {title}
          {count !== undefined && (
            <span style={{ fontSize: 10, color: "var(--dpf-muted)", fontWeight: 400, marginLeft: 6 }}>
              ({count})
            </span>
          )}
        </h2>
        {action ? <span style={{ marginLeft: "auto" }}>{action}</span> : null}
      </div>
      {children}
    </section>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "8px 12px",
        borderRadius: 6,
        border: "1px solid var(--dpf-border)",
        background: "var(--dpf-surface)",
      }}
    >
      <div style={{ fontSize: 10, color: "var(--dpf-muted)", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, color: "var(--dpf-text)", fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function InfoGrid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
      {children}
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 11, color: "var(--dpf-muted)", fontStyle: "italic", padding: "8px 0" }}>
      {text}
    </div>
  );
}

export function Chip({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "accent" | "success" | "warning" | "error" }) {
  const toneVar = {
    muted: "var(--dpf-muted)",
    accent: "var(--dpf-accent)",
    success: "var(--dpf-success)",
    warning: "var(--dpf-warning)",
    error: "var(--dpf-error)",
  }[tone];
  return (
    <span
      style={{
        fontSize: 10,
        padding: "2px 8px",
        borderRadius: 4,
        border: `1px solid ${toneVar}`,
        color: toneVar,
        fontFamily: "monospace",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function deepLink(href: string, label: string) {
  return (
    <Link href={href} style={{ fontSize: 11, color: "var(--dpf-accent)", textDecoration: "none" }}>
      {label} →
    </Link>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  fontSize: 10,
  fontWeight: 600,
  color: "var(--dpf-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};
const tdStyle: React.CSSProperties = { padding: "6px 8px", color: "var(--dpf-text)", fontSize: 11 };

// ─── Overview ────────────────────────────────────────────────────────────────

/** WS2 Overview summary: model tier · priority · #skills · #tools · autonomy · health.
 *  Computed page-side (the loader does not carry model-config/catalog data) and
 *  passed in so this stays a pure presentational panel. */
export type CoworkerSummary = {
  modelTier: string;
  /** Effective priority / budget class label (e.g. "Balanced"). */
  priority: string;
  skillCount: number;
  toolCount: number;
  /** agent.hitlTierDefault (0=human-only,1=approve,2=review,3=autonomous). */
  hitlTier: number;
  providerHealthy: boolean;
};

function SummaryChipRow({ summary }: { summary: CoworkerSummary }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
      <Chip tone="accent">model: {summary.modelTier}</Chip>
      <Chip tone="accent">priority: {summary.priority}</Chip>
      <Chip tone="muted">{summary.skillCount} skill{summary.skillCount === 1 ? "" : "s"}</Chip>
      <Chip tone="muted">{summary.toolCount} tool grant{summary.toolCount === 1 ? "" : "s"}</Chip>
      <Chip tone={summary.hitlTier === 3 ? "warning" : summary.hitlTier === 0 ? "muted" : "accent"}>
        oversight: {oversightLabel(summary.hitlTier, { short: true })}
      </Chip>
      <Chip tone={summary.providerHealthy ? "success" : "error"}>
        {summary.providerHealthy ? "provider healthy" : "provider degraded"}
      </Chip>
    </div>
  );
}

export function OverviewPanel({ record, summary }: { record: CoworkerRecord; summary: CoworkerSummary }) {
  const { agent, profession, decisions, voice } = record;
  const owningTeam = agent.ownerships[0]?.team.name ?? null;
  const coveragePct =
    profession.coverage && profession.coverage.checklist.length > 0
      ? Math.min(100, Math.round((profession.coverage.pageCount / profession.coverage.checklist.length) * 100))
      : null;
  // Jurisdiction gaps surface a risk the volume % alone hides (e.g. 100% corpus
  // depth while a whole jurisdiction has zero pages). EP-COWORKER-RT follow-up.
  const jurGaps = profession.coverage ? jurisdictionGaps(profession.coverage) : [];

  return (
    <div>
      <SummaryChipRow summary={summary} />

      <Section title="Fitness at a glance">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Chip tone={profession.profile ? "success" : "warning"}>
            {profession.profile ? "profession profile bound" : "no profession profile"}
          </Chip>
          {profession.family ? (
            <Chip tone="accent">{profession.family.label}</Chip>
          ) : (
            <Chip tone="error">unmapped role</Chip>
          )}
          {coveragePct !== null ? (
            <Chip tone={jurGaps.length > 0 ? "warning" : coveragePct >= 80 ? "success" : coveragePct >= 40 ? "warning" : "error"}>
              corpus {coveragePct}% of checklist
            </Chip>
          ) : null}
          {jurGaps.length > 0 ? (
            <Chip tone="error">jurisdiction gap: {jurGaps.map((j) => j.toUpperCase()).join(", ")}</Chip>
          ) : null}
          <Chip tone={decisions.deferRate > 0.25 ? "warning" : "muted"}>
            defer {Math.round(decisions.deferRate * 100)}% ({decisions.total} decisions/30d)
          </Chip>
          {voice ? <Chip tone="muted">voice: {voice.status}</Chip> : null}
        </div>
      </Section>

      <Section title="Identity & ownership">
        <InfoGrid>
          <InfoCard label="Profession family" value={profession.family?.label ?? "unmapped"} />
          <InfoCard label="Value stream" value={agent.valueStream ?? "—"} />
          <InfoCard label="Lifecycle stage" value={agent.lifecycleStage} />
          <InfoCard label="Sensitivity" value={agent.sensitivity} />
          <InfoCard
            label="Oversight"
            value={oversightLabel(agent.hitlTierDefault)}
            hint={getOversightCopy(agent.hitlTierDefault)?.description}
          />
          <InfoCard label="Supervising employee" value={agent.humanSupervisorId ?? "—"} />
          <InfoCard label="Owning team" value={owningTeam ?? "—"} />
          <InfoCard label="Escalates to" value={agent.escalatesTo ?? "none"} />
          <InfoCard label="Delegates to" value={agent.delegatesTo.length > 0 ? agent.delegatesTo.join(", ") : "none"} />
          <InfoCard label="Portfolio" value={agent.portfolio?.name ?? "—"} />
        </InfoGrid>
      </Section>
    </div>
  );
}

// ─── Profession & Knowledge (WSID) ──────────────────────────────────────────

export function ProfessionPanel({
  record,
  corpusSignals,
  installArchetype,
}: {
  record: CoworkerRecord;
  corpusSignals?: { usage: CorpusUsageRollup; gaps: CorpusGapRow[] } | null;
  /** The install's resolved archetype (selects the corpus slice this coworker is served). */
  installArchetype?: string | null;
}) {
  const { profession } = record;
  if (!profession.family) {
    return (
      <EmptyState text="This coworker is not mapped to a profession family. Per WSID §4.11 every active role must resolve to a family — this is a registry-lint gap to fix in docs/professions/registry.json." />
    );
  }
  const fam = profession.family;
  const cov = profession.coverage;

  return (
    <div>
      <Section
        title="Profession profile (WSID)"
        action={profession.profileId ? deepLink("/coworker-decisions/perspectives", "All perspectives") : null}
      >
        {profession.profile ? (
          <InfoGrid>
            <InfoCard label="Profile" value={profession.profile.name} />
            <InfoCard label="Profile ID" value={profession.profileId ?? "—"} />
            <InfoCard label="Version" value={`v${profession.profile.currentVersion?.versionNumber ?? "?"}`} />
            <InfoCard label="Fallback chain" value={profession.profile.fallbackProfileId ?? "platform doctrine"} />
          </InfoGrid>
        ) : (
          <EmptyState text={`Family "${fam.label}" has no seeded profession profile yet. The gate falls back to org/platform doctrine; its defer outcomes are the demand signal for building this corpus.`} />
        )}
      </Section>

      <Section title="Corpus coverage" action={cov ? deepLink("/admin/wiki/lint", "Corpus lint") : null}>
        {cov && !cov.emptyCorpus ? (
          <>
            <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginBottom: 10 }}>
              {cov.pageCount} corpus page{cov.pageCount !== 1 ? "s" : ""} under{" "}
              <code style={{ fontSize: 10 }}>professions/{fam.professionKey}/</code>
              {" · "}This install&apos;s archetype:{" "}
              <strong style={{ color: "var(--dpf-text)" }}>{installArchetype ?? "universal (none set)"}</strong>
            </div>
            <CoverageMatrix coverage={cov} />
            {jurisdictionGaps(cov).length > 0 ? (
              <div style={{ marginTop: 10 }}>
                <Chip tone="error">
                  jurisdiction gap: {jurisdictionGaps(cov).map((j) => j.toUpperCase()).join(", ")} uncovered while other jurisdictions have corpus
                </Chip>
              </div>
            ) : null}
            <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 10 }}>
              Archetype variants:{" "}
              {Object.keys(cov.archetype).length > 0
                ? Object.entries(cov.archetype)
                    .sort((a, b) => b[1] - a[1])
                    .map(([a, n]) => `${a} (${n})`)
                    .join(", ")
                : "universal only"}
            </div>
          </>
        ) : (
          <EmptyState text="No published corpus pages for this family yet (empty corpus — the rollout demand signal)." />
        )}
      </Section>

      <Section title="Runtime usage & gaps (30d)" action={deepLink("/platform/ai", "Workforce signals")}>
        {corpusSignals ? (
          <>
            <InfoGrid>
              <InfoCard label="Corpus injections" value={String(corpusSignals.usage.injected)} />
              <InfoCard label="Misses" value={String(corpusSignals.usage.missed)} />
              <InfoCard
                label="Injection rate"
                value={corpusSignals.usage.injectionRatePct === null ? "—" : `${corpusSignals.usage.injectionRatePct}%`}
              />
              <InfoCard label="Open growth gaps" value={String(corpusSignals.gaps.length)} />
            </InfoGrid>
            {corpusSignals.gaps.length > 0 ? (
              <ul style={{ margin: "10px 0 0", paddingLeft: 18 }}>
                {corpusSignals.gaps.slice(0, 8).map((gap) => (
                  <li key={gap.id} style={{ fontSize: 11, color: "var(--dpf-text-secondary)", marginBottom: 4 }}>
                    <Chip tone="muted">{GAP_REASON_LABEL[gap.reason] ?? gap.reason}</Chip>{" "}
                    <span title={gap.missingTopic}>{gap.missingTopic}</span>{" "}
                    <span style={{ color: "var(--dpf-muted)" }}>×{gap.occurrences}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 8 }}>
                No corpus gaps recorded — every recent turn was grounded in this corpus.
              </div>
            )}
          </>
        ) : (
          <EmptyState text="No runtime usage recorded yet. Once this coworker answers questions, its corpus injection/miss signal and growth gaps appear here." />
        )}
      </Section>

      <Section title="Knowledge-area checklist" count={fam.coverageChecklist.length}>
        {fam.coverageChecklist.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {fam.coverageChecklist.map((area) => (
              <Chip key={area} tone="muted">{area}</Chip>
            ))}
          </div>
        ) : (
          <EmptyState text="No coverage checklist declared for this family." />
        )}
      </Section>

      <Section title="Source registry" count={fam.sources.length}>
        {fam.sources.length > 0 ? (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {fam.sources.map((s) => (
              <li key={s.url} style={{ fontSize: 11, color: "var(--dpf-text-secondary)", marginBottom: 3 }}>
                {s.name}{" "}
                <span style={{ color: "var(--dpf-muted)" }}>({s.licenseClass})</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState text="No sources registered for this family." />
        )}
      </Section>
    </div>
  );
}

function CoverageMatrix({ coverage }: { coverage: NonNullable<CoworkerRecord["profession"]["coverage"]> }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr>
            <th style={thStyle}>jurisdiction → / competency ↓</th>
            {PROFESSION_JURISDICTIONS.map((j: string) => (
              <th key={j} style={thStyle}>{j}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PROFESSION_COMPETENCY_LEVELS.map((level: string) => (
            <tr key={level} style={{ borderTop: "1px solid var(--dpf-border)" }}>
              <td style={{ ...tdStyle, fontWeight: 600 }}>{level}</td>
              {PROFESSION_JURISDICTIONS.map((j: string) => {
                // V1 displays the two axes independently (per-axis page counts);
                // the cross-tab cell shows the jurisdiction count as the shared
                // denominator. A true 2-D tally rides V2 with the gate binding.
                const n = coverage.jurisdiction[j] ?? 0;
                const has = (coverage.competency[level] ?? 0) > 0 && n > 0;
                return (
                  <td
                    key={j}
                    style={{
                      ...tdStyle,
                      textAlign: "center",
                      color: has ? "var(--dpf-success)" : "var(--dpf-muted)",
                    }}
                  >
                    {has ? "✓" : "·"}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr style={{ borderTop: "1px solid var(--dpf-border-strong)" }}>
            <td style={{ ...tdStyle, fontWeight: 600 }}>pages tagged</td>
            {PROFESSION_JURISDICTIONS.map((j: string) => (
              <td key={j} style={{ ...tdStyle, textAlign: "center" }}>{coverage.jurisdiction[j] ?? 0}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Capabilities ────────────────────────────────────────────────────────────

export function CapabilitiesPanel({
  record,
  routingCard,
  capabilitiesEditor,
}: {
  record: CoworkerRecord;
  routingCard: React.ReactNode;
  /** WS2 editable grants/skills control (client). Built page-side with the
   *  catalog + held-grant data the loader does not carry; renders read-only
   *  chips (no add/remove controls) when the viewer lacks manage_platform. */
  capabilitiesEditor: React.ReactNode;
}) {
  const { agent, voice, profession } = record;
  return (
    <div>
      {/* WS2: in-place grant/skill editing. Catalog skills (SkillAssignment) +
          tool grants (AgentToolGrant) are managed here; the global
          /platform/ai/skills stays the catalog. */}
      <Section
        title="Assigned skills & tool grants"
        action={deepLink("/platform/ai/skills", "Skills catalog")}
      >
        {capabilitiesEditor}
      </Section>

      {/* Persona skills are free-form role declarations (AgentSkillAssignment,
          keyed by label) — distinct from the catalog skills above. Read-only:
          they are authored with the persona, not granted per-coworker. */}
      <Section title="Persona skills" count={agent.skills.length}>
        {agent.skills.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
            {agent.skills.map((skill) => (
              <div
                key={skill.id}
                style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid var(--dpf-border)", background: "var(--dpf-surface)" }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dpf-text)" }}>{skill.label}</div>
                <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>{skill.description}</div>
                {skill.capability && (
                  <div style={{ fontSize: 10, color: "var(--dpf-accent)", marginTop: 4 }}>requires: {skill.capability}</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="No persona skills declared" />
        )}
      </Section>

      <Section title="Model routing">{routingCard}</Section>

      <Section
        title="Voice"
        action={profession.profileId ? deepLink(`/coworker-decisions/perspectives/${profession.profileId}/voice`, "Voice admin") : null}
      >
        {voice ? (
          <InfoGrid>
            <InfoCard label="Status" value={voice.status} />
            <InfoCard label="Provider" value={voice.provider} />
            <InfoCard label="Language" value={voice.language} />
            <InfoCard label="Quality" value={voice.qualityScore !== null ? voice.qualityScore.toFixed(2) : "—"} />
          </InfoGrid>
        ) : (
          <EmptyState text="No voice profile configured for this coworker's perspective." />
        )}
      </Section>
    </div>
  );
}

// ─── Priority (Golden Triangle) ──────────────────────────────────────────────

/** WS4 — the per-coworker Cost/Quality/Time priority with its inheritance chain.
 *  The interactive control (presets/triangle, save/reset, read-only fallback) is
 *  the client `CoworkerPriorityControl`, built page-side and passed in so this
 *  stays a pure presentational panel. */
export function PriorityPanel({
  priorityControl,
  proactivitySection,
}: {
  priorityControl: React.ReactNode;
  proactivitySection?: React.ReactNode;
}) {
  return (
    <div>
      <Section title="Cost / Quality / Time priority">
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: -4, marginBottom: 12, maxWidth: 680, lineHeight: 1.5 }}>
          The everyday priority for this coworker. By default it inherits the platform default set on the{" "}
          {deepLink("/platform/ai/assignments", "Priority & Models")} surface; override it here only when this coworker
          needs a different balance. The platform compiles it into the model, effort, verification, and review/debate —
          shown in plain language — and it governs this coworker&apos;s live dispatch.
        </p>
        {priorityControl}
      </Section>
      {proactivitySection && (
        <>
          <Section title="Proactivity">
            <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: -4, marginBottom: 12, maxWidth: 680, lineHeight: 1.5 }}>
              How persistently this coworker follows up with <em>you</em> — your setting for this coworker, and the
              same dial shown beside the chat composer. Changing it in either place changes the other.
            </p>
            {proactivitySection}
          </Section>
          <Section title="In the chat">
            <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: -4, maxWidth: 680, lineHeight: 1.5 }}>
              Three switches are deliberately <strong>per-conversation</strong> and live in the chat composer, not
              here: Advise/Act mode, page editing, and web access. They reset each session so a broad permission never
              lingers silently — open the coworker chat to set them for the conversation you&apos;re in.
            </p>
          </Section>
        </>
      )}
    </div>
  );
}

// ─── Governance ──────────────────────────────────────────────────────────────

export function GovernancePanel({ record }: { record: CoworkerRecord }) {
  const { agent } = record;
  return (
    <div>
      <Section title="Governance profile">
        {agent.governanceProfile ? (
          <InfoGrid>
            <InfoCard label="Capability class" value={agent.governanceProfile.capabilityClass.name} />
            <InfoCard label="Autonomy level" value={agent.governanceProfile.autonomyLevel} />
            <InfoCard label="Oversight policy" value={agent.governanceProfile.hitlPolicy} />
            <InfoCard label="Delegation" value={agent.governanceProfile.allowDelegation ? "allowed" : "denied"} />
            {agent.governanceProfile.maxDelegationRiskBand && (
              <InfoCard label="Max delegation risk" value={agent.governanceProfile.maxDelegationRiskBand} />
            )}
          </InfoGrid>
        ) : (
          <EmptyState text="No governance profile configured" />
        )}
      </Section>

      <Section title="Feature degradation" count={agent.degradationMappings.length}>
        {agent.degradationMappings.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                  <th style={thStyle}>Route</th>
                  <th style={thStyle}>Feature</th>
                  <th style={thStyle}>Required tier</th>
                  <th style={thStyle}>Mode</th>
                  <th style={thStyle}>User message</th>
                </tr>
              </thead>
              <tbody>
                {agent.degradationMappings.map((m) => (
                  <tr key={m.id} style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                    <td style={tdStyle}><code style={{ fontSize: 10 }}>{m.featureRoute}</code></td>
                    <td style={tdStyle}>{m.featureName}</td>
                    <td style={tdStyle}>{m.requiredTier}</td>
                    <td style={tdStyle}>
                      <Chip tone={m.degradationMode === "disabled" ? "error" : "warning"}>{m.degradationMode}</Chip>
                    </td>
                    <td style={tdStyle}>{m.userMessage ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState text="No degradation mappings defined" />
        )}
      </Section>
    </div>
  );
}

// ─── Performance & Improvement ──────────────────────────────────────────────

export function PerformancePanel({ record }: { record: CoworkerRecord }) {
  const { agent } = record;
  const assessments = agent.coworkerAssessments ?? [];
  return (
    <div>
      <Section title="Performance" count={agent.performanceProfiles.length}>
        {agent.performanceProfiles.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                  <th style={thStyle}>Task type</th>
                  <th style={thStyle}>Phase</th>
                  <th style={thStyle}>Evals</th>
                  <th style={thStyle}>Avg score</th>
                  <th style={thStyle}>Success</th>
                  <th style={thStyle}>Confidence</th>
                  <th style={thStyle}>Last evaluated</th>
                </tr>
              </thead>
              <tbody>
                {agent.performanceProfiles.map((p) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                    <td style={tdStyle}>{p.taskType}</td>
                    <td style={tdStyle}>{p.instructionPhase}</td>
                    <td style={tdStyle}>{p.evaluationCount}</td>
                    <td style={tdStyle}>{p.avgOrchestratorScore.toFixed(2)}</td>
                    <td style={tdStyle}>
                      {p.evaluationCount > 0 ? `${((p.successCount / p.evaluationCount) * 100).toFixed(0)}%` : "n/a"}
                    </td>
                    <td style={tdStyle}>{p.profileConfidence}</td>
                    <td style={tdStyle}>{p.lastEvaluatedAt ? <LocalTime value={p.lastEvaluatedAt} mode="date" /> : "never"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState text="No performance data yet" />
        )}
      </Section>

      <Section
        title="Improvement loop — self-assessments"
        count={assessments.length}
        action={deepLink("/ops?origin=capability-need", "Capability needs queue")}
      >
        {assessments.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {assessments.map((a) => (
              <div
                key={a.assessmentId}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", border: "1px solid var(--dpf-border)", borderRadius: 6, background: "var(--dpf-surface)" }}
              >
                <Chip tone={a.verdict === "capable" ? "success" : a.verdict === "blocked" ? "error" : "warning"}>{a.verdict}</Chip>
                <span style={{ fontSize: 11, color: "var(--dpf-muted)" }}>confidence: {a.confidence}</span>
                <span style={{ fontSize: 11, color: "var(--dpf-muted)", marginLeft: "auto" }}>
                  <LocalTime value={a.createdAt} mode="date" />
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="No self-assessments recorded yet. The coworker has not run its improvement loop." />
        )}
      </Section>
    </div>
  );
}

// ─── Decisions & Activity ───────────────────────────────────────────────────

export function DecisionsPanel({ record }: { record: CoworkerRecord }) {
  const { agent, decisions, profession } = record;
  const outcomes = Object.entries(decisions.byOutcome).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      <Section
        title="Decision signals (30d)"
        action={profession.profileId ? deepLink("/workspace/inbox", "Open Needs you") : null}
      >
        {decisions.total > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {outcomes.map(([outcome, n]) => (
              <Chip
                key={outcome}
                tone={outcome === "defer" ? "warning" : outcome === "escalate" ? "error" : outcome === "recommend" ? "success" : "muted"}
              >
                {outcome}: {n}
              </Chip>
            ))}
            <Chip tone={decisions.deferRate > 0.25 ? "warning" : "muted"}>
              defer rate {Math.round(decisions.deferRate * 100)}%
            </Chip>
          </div>
        ) : (
          <EmptyState text="No governed decisions recorded against this coworker's profession profile in the last 30 days." />
        )}
        <div style={{ marginTop: 8, fontSize: 10, color: "var(--dpf-muted)" }}>
          Each decision links to its Decision Canvas (per-interaction provenance). A high defer
          rate is the corpus-gap demand signal for this profession.
        </div>
      </Section>

      {agent.promptContext && (
        <Section title="Prompt context" action={deepLink("/platform/ai/prompts", "Prompt editor")}>
          <div style={{ display: "grid", gap: 12 }}>
            {agent.promptContext.perspective && (
              <PromptBlock label="Perspective" value={agent.promptContext.perspective} />
            )}
            {agent.promptContext.heuristics && (
              <PromptBlock label="Heuristics" value={agent.promptContext.heuristics} />
            )}
            {agent.promptContext.interpretiveModel && (
              <PromptBlock label="Interpretive model" value={agent.promptContext.interpretiveModel} />
            )}
            {agent.promptContext.domainTools.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--dpf-text)", marginBottom: 4 }}>Domain tools</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {agent.promptContext.domainTools.map((tool) => (
                    <Chip key={tool} tone="muted">{tool}</Chip>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

function PromptBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--dpf-text)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 11, color: "var(--dpf-muted)" }}>{value}</div>
    </div>
  );
}
