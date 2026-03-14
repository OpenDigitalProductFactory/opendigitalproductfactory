import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EaTabNav } from "@/components/ea/EaTabNav";
import { ReferenceModelPortfolioTable } from "@/components/ea/ReferenceModelPortfolioTable";
import { ReferenceProjectionActions } from "@/components/ea/ReferenceProjectionActions";
import { ReferenceProposalQueue } from "@/components/ea/ReferenceProposalQueue";
import { projectReferenceModelValueStreams } from "@/lib/actions/ea";
import {
  getReferenceModelDetail,
  getReferenceModelPortfolioRollup,
} from "@/lib/ea-data";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function ReferenceModelPage({ params }: Props) {
  const { slug } = await params;

  try {
    const [detail, rollup] = await Promise.all([
      getReferenceModelDetail(slug),
      getReferenceModelPortfolioRollup(slug),
    ]);

    async function loadValueStreamProjection(formData: FormData) {
      "use server";

      const referenceModelSlug = String(formData.get("referenceModelSlug") ?? slug);
      const result = await projectReferenceModelValueStreams({ referenceModelSlug });
      redirect(`/ea/views/${result.viewId}`);
    }

    return (
      <div>
        <div className="mb-6">
          <div className="mb-2">
            <Link href="/ea" className="text-xs text-[var(--dpf-muted)] hover:text-white">
              EA / Reference Models
            </Link>
          </div>
          <h1 className="text-xl font-bold text-white">{detail.name}</h1>
          <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
            {detail.version} · {detail.authorityType} · {detail.status}
          </p>
          {detail.description && (
            <p className="mt-2 max-w-3xl text-sm text-[var(--dpf-muted)]">
              {detail.description}
            </p>
          )}
        </div>

        <EaTabNav />

        <ReferenceProjectionActions
          referenceModelSlug={slug}
          valueStreamProjection={detail.valueStreamProjection}
          loadValueStreamProjection={loadValueStreamProjection}
        />

        <section className="mb-6">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-white">Artifacts</h2>
            <p className="text-xs text-[var(--dpf-muted)]">
              Authoritative and supporting source materials tracked for this model.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {detail.artifacts.map((artifact) => (
              <div
                key={artifact.id}
                className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
              >
                <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--dpf-muted)]">
                  {artifact.authority}
                </p>
                <p className="mt-1 text-sm font-medium text-white">{artifact.kind}</p>
                <p className="mt-1 break-all text-xs text-[var(--dpf-muted)]">{artifact.path}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-6">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-white">Portfolio Coverage</h2>
            <p className="text-xs text-[var(--dpf-muted)]">
              MVP-aligned coverage posture by portfolio scope.
            </p>
          </div>
          <ReferenceModelPortfolioTable rows={rollup.rows} />
        </section>

        <ReferenceProposalQueue proposals={detail.proposals} />
      </div>
    );
  } catch {
    notFound();
  }
}
