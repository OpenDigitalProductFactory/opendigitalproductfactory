import type { CSSProperties } from "react";

import type {
  SkillEvidenceRefs,
  SkillEvidenceResult,
} from "@/lib/skills/evidence-search";

type Props = {
  evidence: SkillEvidenceResult[];
  activeScope?: {
    threadId?: string | null;
    taskRunId?: string | null;
    routeContext?: string | null;
    query?: string | null;
  };
};

const kindLabels: Record<SkillEvidenceResult["kind"], string> = {
  skill_usage_event: "Usage",
  tool_execution: "Tool",
  task_run: "Run",
  task_message: "Message",
  task_artifact: "Artifact",
  agent_message: "Thread",
  platform_issue: "Issue",
  improvement_proposal: "Proposal",
  skill_revision: "Revision",
  backlog_activity: "Backlog",
  external_evidence: "External",
};

const visibleRefKeys: Array<keyof SkillEvidenceRefs> = [
  "skillId",
  "threadId",
  "taskRunId",
  "proposalId",
  "toolExecutionId",
  "reportId",
  "artifactId",
  "messageId",
  "backlogItemId",
];

export function SkillEvidencePanel({ evidence, activeScope }: Props) {
  const scopeEntries = Object.entries(activeScope ?? {}).filter(
    ([, value]) => typeof value === "string" && value.length > 0,
  );

  if (evidence.length === 0) {
    return (
      <div style={emptyState}>
        No linked evidence yet
        {scopeEntries.length > 0 ? (
          <span style={{ color: "var(--dpf-muted)" }}>
            {" "}
            for {scopeEntries.map(([key, value]) => `${key}=${value}`).join(", ")}
          </span>
        ) : null}
        .
      </div>
    );
  }

  return (
    <div id="skill-evidence" style={rootStyle}>
      {scopeEntries.length > 0 && (
        <div style={scopeStyle}>
          {scopeEntries.map(([key, value]) => (
            <code key={key} style={scopeTokenStyle}>
              {key}={value}
            </code>
          ))}
        </div>
      )}
      <div role="list" style={listStyle}>
        {evidence.map((item) => (
          <EvidenceRow key={`${item.kind}:${item.id}`} item={item} />
        ))}
      </div>
    </div>
  );
}

function EvidenceRow({ item }: { item: SkillEvidenceResult }) {
  const refs = visibleRefKeys
    .map((key) => [key, item.refs[key]] as const)
    .filter(([, value]) => typeof value === "string" && value.length > 0);

  return (
    <article role="listitem" style={rowStyle}>
      <div style={rowHeaderStyle}>
        <span style={badgeStyle}>{kindLabels[item.kind]}</span>
        <span style={labelStyle}>{item.label}</span>
        <time dateTime={item.createdAt} style={timeStyle}>
          {formatDate(item.createdAt)}
        </time>
      </div>
      <p style={summaryStyle}>{item.summary}</p>
      {refs.length > 0 && (
        <div style={refsStyle}>
          {refs.map(([key, value]) => (
            <code key={`${key}:${value}`} style={refTokenStyle}>
              {key}={value}
            </code>
          ))}
        </div>
      )}
    </article>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

const rootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const scopeStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  alignItems: "center",
};

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  border: "1px solid var(--dpf-border)",
  borderRadius: 6,
  overflow: "hidden",
  background: "var(--dpf-surface-2)",
};

const rowStyle: CSSProperties = {
  padding: "10px 12px",
  borderTop: "1px solid var(--dpf-border)",
};

const rowHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
};

const badgeStyle: CSSProperties = {
  flex: "0 0 auto",
  fontSize: 10,
  padding: "2px 7px",
  borderRadius: 999,
  background: "color-mix(in srgb, var(--dpf-accent) 12%, transparent)",
  color: "var(--dpf-accent)",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0,
};

const labelStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  color: "var(--dpf-text)",
  fontSize: 13,
  fontWeight: 600,
};

const timeStyle: CSSProperties = {
  flex: "0 0 auto",
  color: "var(--dpf-muted)",
  fontSize: 11,
};

const summaryStyle: CSSProperties = {
  margin: "6px 0 0 0",
  color: "var(--dpf-muted)",
  fontSize: 12,
  lineHeight: 1.45,
};

const refsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  marginTop: 8,
};

const tokenBase: CSSProperties = {
  border: "1px solid var(--dpf-border)",
  background: "var(--dpf-surface-1)",
  color: "var(--dpf-muted)",
  borderRadius: 4,
  fontSize: 11,
  padding: "2px 5px",
  overflowWrap: "anywhere",
};

const refTokenStyle: CSSProperties = tokenBase;

const scopeTokenStyle: CSSProperties = {
  ...tokenBase,
  color: "var(--dpf-text)",
};

const emptyState: CSSProperties = {
  padding: 12,
  borderRadius: 6,
  border: "1px solid var(--dpf-border)",
  background: "var(--dpf-surface-2)",
  color: "var(--dpf-muted)",
  fontSize: 12,
};
