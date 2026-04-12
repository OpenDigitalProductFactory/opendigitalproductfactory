import { getPromptCatalog } from "@/lib/actions/prompt-admin";
import { PromptManager } from "@/components/admin/PromptManager";

export default async function AdminPromptsPage() {
  const catalog = await getPromptCatalog();

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold text-[var(--dpf-text)]">
        AI Coworker Prompts
      </h2>
      <p className="mb-6 text-sm text-[var(--dpf-muted)]">
        View and edit the system prompts used by AI coworkers. Changes take
        effect within 60 seconds. Use &ldquo;Reset to Default&rdquo; to restore
        the original prompt from the source file.
      </p>
      <PromptManager initialCatalog={catalog} />
    </section>
  );
}
