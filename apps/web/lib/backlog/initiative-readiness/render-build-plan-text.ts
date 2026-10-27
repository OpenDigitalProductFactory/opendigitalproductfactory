// apps/web/lib/backlog/initiative-readiness/render-build-plan-text.ts
//
// BI-6F2872FC — a Build Studio plan is reviewable text.
//
// The independent plan review reads the plan through the immutable revision
// reader, which renders a stored value with initiativeTextFromBuildValue. That
// rendered only design documents, so a stored plan read as "not reviewable
// text" and no plan review of a Build Studio build could ever be recorded.
//
// Deterministic for the same reason the design renderer is: the review binds
// the revision's digest and reviewers cite lines of this text, so one stored
// value must always produce one document. Field order is fixed here.

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Render a Build Studio implementation plan, or null when the value is not one. */
export function renderBuildPlanText(value: unknown): string | null {
  const plan = record(value);
  if (!plan || !Array.isArray(plan.tasks) || plan.tasks.length === 0) return null;
  const parts: string[] = ["# Implementation plan"];
  const files = Array.isArray(plan.fileStructure) ? plan.fileStructure.map(record).filter(Boolean) as Record<string, unknown>[] : [];
  if (files.length > 0) {
    parts.push(["## Files", "", ...files.map((file) => {
      const purpose = text(file.purpose);
      return `- ${text(file.action) || "change"} \`${text(file.path)}\`${purpose ? ` — ${purpose}` : ""}`;
    })].join("\n"));
  }
  const tasks = plan.tasks.map((entry, index) => {
    const task = record(entry) ?? {};
    const satisfies = Array.isArray(task.satisfies)
      ? task.satisfies.filter((ref): ref is string => typeof ref === "string" && ref.trim().length > 0).map((ref) => ref.trim())
      : [];
    return [
      `### Task ${index + 1}: ${text(task.title) || "(untitled)"}`,
      "",
      `Satisfies: ${satisfies.length > 0 ? satisfies.join(", ") : "(none)"}`,
      "",
      `- Test first: ${text(task.testFirst) || "(not stated)"}`,
      `- Implement: ${text(task.implement) || "(not stated)"}`,
      `- Verify: ${text(task.verify) || "(not stated)"}`,
    ].join("\n");
  });
  parts.push(["## Tasks", "", tasks.join("\n\n")].join("\n"));
  return parts.join("\n\n");
}
