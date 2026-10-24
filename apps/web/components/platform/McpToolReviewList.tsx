"use client";

// Operator review of discovered external MCP tools (BI-8B7B2FE9). A working
// connection is never permission: a tool is usable by coworkers only after a
// person approves it here, and a tool whose description or inputs change
// returns to review with the approved and newly reported text side by side.
//
// Progressive disclosure: the summary shows name + state; the review panel asks
// two plain questions (which permission, does it change things). Execution
// modes are derived from the effect, never asked.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ExpandableCard, Notice, SearchableSelect, StatusBadge } from "@/components/ui/report-kit";
import { reviewMcpServerToolAction } from "@/lib/actions/mcp-services";
import { useT } from "@/lib/i18n/use-t";

export type McpToolReviewRow = {
  id: string;
  toolName: string;
  policyClass: "bundled-approved" | "approved" | "denied" | "quarantined" | "blocked";
  reasonText: string | null;
  contentDigest: string;
  contentChanged: boolean;
  /** What a coworker would read now (hidden characters removed). */
  description: string;
  inputSchemaText: string;
  /** The text that was approved, when it differs from what is reported now. */
  approvedDescription: string | null;
  approvedInputSchemaText: string | null;
  grantKey: string | null;
  effect: "read_only" | "side_effecting" | null;
};

function TextBlock({ title, description, schema }: { title: string; description: string; schema: string }) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs font-medium text-[var(--dpf-muted)]">{title}</p>
      <p className="whitespace-pre-wrap break-words text-sm text-[var(--dpf-text)]">{description || "—"}</p>
      <pre className="max-h-48 overflow-auto rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-xs text-[var(--dpf-text)]">
        {schema}
      </pre>
    </div>
  );
}

function ReviewControls({ tool, grantOptions }: { tool: McpToolReviewRow; grantOptions: string[] }) {
  const t = useT("mcpTools");
  const router = useRouter();
  const [grantKey, setGrantKey] = useState(tool.grantKey ?? "");
  const [effect, setEffect] = useState<"read_only" | "side_effecting" | "">(tool.effect ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (decision: "approve" | "deny" | "return-to-review") => {
    startTransition(async () => {
      const result = await reviewMcpServerToolAction({
        toolId: tool.id,
        decision,
        ...(decision === "approve"
          ? { reviewedContentDigest: tool.contentDigest, grantKey, effect: effect || undefined }
          : {}),
      });
      setMessage({ ok: result.ok, text: result.ok ? result.data.message : result.error });
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-3 border-t border-[var(--dpf-border)] pt-3">
      <SearchableSelect
        label={t("review.permissionLabel")}
        options={grantOptions.map((key) => ({ value: key, label: key }))}
        value={grantKey}
        onChange={setGrantKey}
      />
      <fieldset className="space-y-1">
        <legend className="text-xs font-medium text-[var(--dpf-muted)]">{t("review.effectLegend")}</legend>
        <label className="flex items-center gap-2 text-sm text-[var(--dpf-text)]">
          <input type="radio" name={`effect-${tool.id}`} checked={effect === "read_only"} onChange={() => setEffect("read_only")} />
          {t("review.effectRead")}
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--dpf-text)]">
          <input type="radio" name={`effect-${tool.id}`} checked={effect === "side_effecting"} onChange={() => setEffect("side_effecting")} />
          {t("review.effectChange")}
        </label>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending || !grantKey || !effect} onClick={() => submit("approve")}>
          {t("review.approve")}
        </Button>
        {tool.policyClass === "approved" && (
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => submit("return-to-review")}>
            {t("review.returnToReview")}
          </Button>
        )}
        {tool.policyClass !== "denied" && (
          <Button size="sm" variant="danger" disabled={pending} onClick={() => submit("deny")}>
            {t("review.block")}
          </Button>
        )}
      </div>
      {message && (
        <Notice variant={message.ok ? "success" : "error"}>{message.text}</Notice>
      )}
    </div>
  );
}

export function McpToolReviewList({
  tools,
  canReview,
  grantOptions,
}: {
  tools: McpToolReviewRow[];
  canReview: boolean;
  grantOptions: string[];
}) {
  const t = useT("mcpTools");
  const [openId, setOpenId] = useState<string | null>(null);
  const waiting = tools.filter((t) => t.policyClass === "quarantined").length;

  return (
    <div className="space-y-3">
      <Notice variant={waiting > 0 ? "warn" : "info"} title={waiting > 0 ? t("review.waiting", { count: waiting }) : undefined}>
        {t("review.intro")}
      </Notice>
      {tools.map((tool) => (
        <ExpandableCard
          key={tool.id}
          id={`mcp-tool-${tool.id}`}
          open={openId === tool.id}
          onOpenChange={(next) => setOpenId(next ? tool.id : null)}
          headingLevel={3}
          summary={
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-[var(--dpf-text)]">{tool.toolName}</span>
              <StatusBadge domain="mcpToolPolicy" status={tool.policyClass} label={t(`state.${tool.policyClass}`)} />
              {tool.contentChanged && <StatusBadge intent="warning" label={t("review.changedBadge")} />}
              {tool.reasonText && tool.policyClass !== "approved" && tool.policyClass !== "bundled-approved" && (
                <span className="text-xs text-[var(--dpf-muted)]">{tool.reasonText}</span>
              )}
            </div>
          }
        >
          <div className="space-y-3 p-3">
            {tool.contentChanged && tool.approvedDescription !== null ? (
              <div className="grid gap-3 md:grid-cols-2">
                <TextBlock title={t("review.approvedText")} description={tool.approvedDescription} schema={tool.approvedInputSchemaText ?? "{}"} />
                <TextBlock title={t("review.reportedNow")} description={tool.description} schema={tool.inputSchemaText} />
              </div>
            ) : (
              <TextBlock title={t("review.coworkerReads")} description={tool.description} schema={tool.inputSchemaText} />
            )}
            {canReview && tool.policyClass !== "bundled-approved" && (
              <ReviewControls tool={tool} grantOptions={grantOptions} />
            )}
            {tool.policyClass === "bundled-approved" && (
              <p className="text-xs text-[var(--dpf-muted)]">{t("review.bundledNote")}</p>
            )}
          </div>
        </ExpandableCard>
      ))}
    </div>
  );
}
