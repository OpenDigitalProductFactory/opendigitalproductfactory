import Link from "next/link";
import { notFound } from "next/navigation";

import { BindingDetailDrawer } from "@/components/platform/authority/BindingDetailDrawer";
import { getAuthorityBinding, getAuthorityBindingEvidence } from "@/lib/authority/bindings";

type Props = {
  params: Promise<{
    bindingId: string;
  }>;
};

export default async function AiAssignmentsBindingPage({ params }: Props) {
  const { bindingId } = await params;
  const [binding, evidence] = await Promise.all([
    getAuthorityBinding(bindingId),
    getAuthorityBindingEvidence(bindingId),
  ]);

  if (!binding) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs uppercase tracking-[0.08em] text-[var(--dpf-muted)]">
          <Link href="/platform/ai/assignments" className="text-[var(--dpf-accent)]">
            Resource bindings
          </Link>
          {" · "}AI Workforce{" · "}Assignments
        </div>
        <p className="mt-2 text-sm text-[var(--dpf-muted)]">
          Coworker-first fallback view for the shared authority binding detail surface.
        </p>
      </div>
      <BindingDetailDrawer binding={binding} evidence={evidence} />
    </div>
  );
}
