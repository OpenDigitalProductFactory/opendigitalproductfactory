type ReviewQueueKey = "urgent" | "renewal" | "review" | "research";

type ReviewQueueItem = {
  id: string;
  customerCiId: string;
  name: string;
  ciType: string;
  lifecycleStatus: string;
  supportStatus: string;
  recommendedAction: string;
  attentionLevel: string;
  queue: ReviewQueueKey;
};

const QUEUE_META: Array<{
  key: ReviewQueueKey;
  label: string;
  description: string;
}> = [
  {
    key: "urgent",
    label: "Urgent",
    description: "Expired or high-risk lifecycle work that should be handled first.",
  },
  {
    key: "renewal",
    label: "Renewals",
    description: "Commercial coverage and subscription items that need contract attention.",
  },
  {
    key: "review",
    label: "Reviews",
    description: "Supported items that still need upgrade or lifecycle review planning.",
  },
  {
    key: "research",
    label: "Research",
    description: "Items missing enough support evidence to make a clean recommendation.",
  },
];

export function CustomerLifecycleReviewQueues({
  counts,
  queues,
}: {
  counts: Record<ReviewQueueKey, number>;
  queues: Record<ReviewQueueKey, ReviewQueueItem[]>;
}) {
  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="mb-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
          Lifecycle Review Queues
        </h2>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          Shared review buckets for technology refresh, renewal, and support posture work.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {QUEUE_META.map((queue) => (
          <div
            key={queue.key}
            className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--dpf-muted)]">
              {queue.label}
            </p>
            <p className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">{counts[queue.key]}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {QUEUE_META.map((queue) => (
          <section
            key={queue.key}
            className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3"
          >
            <div className="mb-2">
              <h3 className="text-sm font-semibold text-[var(--dpf-text)]">{queue.label}</h3>
              <p className="text-[10px] text-[var(--dpf-muted)]">{queue.description}</p>
            </div>

            {queues[queue.key].length > 0 ? (
              <div className="space-y-2">
                {queues[queue.key].slice(0, 4).map((item) => (
                  <div
                    key={item.id}
                    className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-semibold text-[var(--dpf-text)]">{item.name}</p>
                      <span className="rounded-full bg-[var(--dpf-surface-2)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--dpf-muted)]">
                        {item.ciType}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] text-[var(--dpf-muted)]">
                      {item.customerCiId} · {item.lifecycleStatus} · {item.recommendedAction}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-[var(--dpf-muted)]">No items in this queue.</p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
