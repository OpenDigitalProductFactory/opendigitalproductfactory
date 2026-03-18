"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getMyPendingRequirements, acknowledgePolicy, completeRequirement } from "@/lib/actions/policy";

type PendingData = Awaited<ReturnType<typeof getMyPendingRequirements>>;

export function MyPoliciesView() {
  const [data, setData] = useState<PendingData | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    getMyPendingRequirements().then((d) => { setData(d); setLoading(false); });
  }, []);

  async function handleAcknowledge(policyId: string) {
    await acknowledgePolicy(policyId);
    router.refresh();
    const fresh = await getMyPendingRequirements();
    setData(fresh);
  }

  async function handleComplete(requirementId: string) {
    await completeRequirement(requirementId, "digital-signature");
    router.refresh();
    const fresh = await getMyPendingRequirements();
    setData(fresh);
  }

  if (loading) return <p className="text-sm text-[var(--dpf-muted)]">Loading...</p>;
  if (!data) return <p className="text-sm text-[var(--dpf-muted)]">Unable to load policy data.</p>;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
          Pending Acknowledgments ({data.pendingAcknowledgments.length})
        </h2>
        {data.pendingAcknowledgments.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">All policies acknowledged.</p>
        ) : (
          <div className="space-y-2">
            {data.pendingAcknowledgments.map((p) => (
              <div key={p.id} className="p-3 rounded-lg border border-[var(--dpf-border)] flex items-center justify-between">
                <div>
                  <span className="text-sm text-white">{p.title}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)] ml-2">{p.category}</span>
                </div>
                <button onClick={() => handleAcknowledge(p.id)}
                  className="px-3 py-1 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90">
                  Acknowledge
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
          Pending Training ({data.pendingTraining.length})
        </h2>
        {data.pendingTraining.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">All training complete.</p>
        ) : (
          <div className="space-y-2">
            {data.pendingTraining.map((r) => (
              <div key={r.id} className="p-3 rounded-lg border border-[var(--dpf-border)] flex items-center justify-between">
                <div>
                  <span className="text-sm text-white">{r.trainingRequirement?.trainingTitle ?? r.title}</span>
                  <span className="text-[9px] text-[var(--dpf-muted)] ml-2">({r.policy.title})</span>
                  {r.trainingRequirement?.externalUrl && (
                    <a href={r.trainingRequirement.externalUrl} target="_blank" rel="noopener noreferrer"
                      className="text-[9px] text-blue-400 hover:underline ml-2">Open training</a>
                  )}
                </div>
                <button onClick={() => handleComplete(r.id)}
                  className="px-3 py-1 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90">
                  Mark Complete
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
          Completed ({data.completedHistory.length})
        </h2>
        {data.completedHistory.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">No completions yet.</p>
        ) : (
          <div className="space-y-2">
            {data.completedHistory.map((c) => (
              <div key={c.id} className="p-3 rounded-lg border border-[var(--dpf-border)] flex items-start justify-between">
                <div>
                  <span className="text-sm text-white">{c.requirement.title}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)] ml-2">{c.requirement.requirementType}</span>
                  <p className="text-[9px] text-[var(--dpf-muted)] mt-1">{c.requirement.policy.title}</p>
                </div>
                <span className="text-xs text-[var(--dpf-muted)]">{new Date(c.completedAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
