import { getPromptCatalog } from "@/lib/actions/prompt-admin";
import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { PromptManager } from "@/components/admin/PromptManager";

export default async function AdminPromptsPage() {
  const catalog = await getPromptCatalog();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          AI Coworker Prompts
        </p>
      </div>

      <AdminTabNav />

      <p className="mb-4 text-sm text-[var(--dpf-muted)]">
        System prompts that shape how AI coworkers think and respond. Changes
        take effect within 60 seconds. Use &ldquo;Reset to Default&rdquo; to
        restore the original prompt from the source file.
      </p>
      <p className="mb-6 text-xs text-[var(--dpf-muted)]">
        Setup wizard triggers (ai-providers, branding, etc.) are conversation
        starters, not system prompts — they&rsquo;re not listed here. To
        customise setup guidance, edit the Onboarding COO prompt under Route
        Personas. User-triggerable actions appear in{" "}
        <a href="/admin/skills" className="underline text-[var(--dpf-accent)]">
          Skills
        </a>.
      </p>
      <PromptManager initialCatalog={catalog} />
    </div>
  );
}
