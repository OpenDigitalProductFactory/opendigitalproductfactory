import Link from "next/link";
import { PromptManager } from "@/components/admin/PromptManager";
import { getPromptCatalog } from "@/lib/actions/prompt-admin";

export default async function AiPromptsPage() {
  const catalog = await getPromptCatalog();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">AI Operations</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">Prompts</p>
      </div>

      <p className="mb-4 text-sm text-[var(--dpf-muted)]">
        System prompts shape how coworkers think, respond, and hand work off across the platform.
        Changes take effect within 60 seconds. Use &ldquo;Reset to Default&rdquo; to restore the
        original prompt from the source file.
      </p>

      {/* Catalog framing (coworker-management-consolidation WS3): this is the
          GLOBAL prompt library. Per-coworker persona editing lives on each
          coworker's record, reached from the directory. */}
      <div className="mb-6 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-3 text-xs text-[var(--dpf-muted)]">
        This is the <strong className="text-[var(--dpf-text)]">global prompt library</strong>. To view or edit the
        prompt for a single coworker, open that coworker&rsquo;s record from the{" "}
        <Link href="/platform/ai/overview" className="underline text-[var(--dpf-accent)]">
          AI Workforce directory
        </Link>
        .
      </div>

      <p className="mb-6 text-xs text-[var(--dpf-muted)]">
        User-invocable actions now live with AI Operations as well. Review{" "}
        <Link href="/platform/ai/skills" className="underline text-[var(--dpf-accent)]">
          Skills
        </Link>{" "}
        when you need to pair runtime behavior with the skills coworkers can expose.
      </p>

      <PromptManager initialCatalog={catalog} />
    </div>
  );
}
