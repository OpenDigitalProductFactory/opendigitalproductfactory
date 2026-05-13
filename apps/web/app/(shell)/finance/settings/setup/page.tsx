import Link from "next/link";
import { prisma } from "@dpf/db";
import { FinanceSetupClient } from "@/components/finance/FinanceSetupClient";
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";
import { resolveFinanceSetupProfile } from "@/lib/finance/setup-profile";
import { getSetupContext } from "@/lib/actions/setup-progress";

export default async function FinanceSetupPage() {
  const [storefrontConfig, setupContext] = await Promise.all([
    prisma.storefrontConfig.findFirst({
      include: {
        archetype: {
          select: {
            name: true,
            category: true,
          },
        },
      },
    }),
    getSetupContext(),
  ]);

  const financeProfile = resolveFinanceSetupProfile({
    category: storefrontConfig?.archetype.category,
    archetypeName: storefrontConfig?.archetype.name,
  });

  return (
    <div>
      <div className="mb-2">
        <Link
          href="/finance"
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <Link
          href="/finance/settings"
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          Settings
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">Setup</span>
      </div>

      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Finance Setup</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Apply the finance defaults that match your business archetype.
        </p>
      </div>

      <FinanceTabNav />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <FinanceSetupClient
            archetypeSlug={financeProfile.slug}
            archetypeName={financeProfile.archetypeName}
            suggestedCurrency={setupContext?.suggestedCurrency ?? null}
          />
        </section>

        <aside className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            Profile Source
          </p>
          <p className="mt-3 text-sm font-semibold text-[var(--dpf-text)]">
            {financeProfile.profileName}
          </p>
          <p className="mt-2 text-xs leading-5 text-[var(--dpf-muted)]">
            The setup profile is derived from the current storefront archetype. If no
            archetype is available yet, Finance uses the professional-services baseline.
          </p>
        </aside>
      </div>
    </div>
  );
}
