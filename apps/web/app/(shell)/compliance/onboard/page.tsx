import { prisma } from "@dpf/db";
import Link from "next/link";
import { OnboardingWizard } from "@/components/compliance/OnboardingWizard";

type Props = { searchParams: Promise<{ draft?: string }> };

export default async function OnboardPage({ searchParams }: Props) {
  const { draft: draftId } = await searchParams;

  // Lazy cleanup: delete expired drafts
  await prisma.onboardingDraft.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  }).catch(() => {});

  // Load draft if provided
  let draftData = null;
  if (draftId) {
    const draft = await prisma.onboardingDraft.findUnique({ where: { id: draftId } });
    if (draft) {
      draftData = draft.data as Record<string, unknown>;
    }
  }

  return (
    <div>
      <div className="mb-4">
        <Link href="/compliance/regulations" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Regulations
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">Onboard</span>
      </div>
      <OnboardingWizard draft={draftData as any} />
    </div>
  );
}
