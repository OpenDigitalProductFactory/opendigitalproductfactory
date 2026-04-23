type ReviewQueueKey = "urgent" | "renewal" | "review" | "research";

export type LifecycleReviewCandidate = {
  id: string;
  name: string;
  ciType?: string | null;
  lifecycleStatus: string;
  supportStatus: string;
  recommendedAction: string;
  attentionLevel: "low" | "medium" | "high";
  licensingReviewRequired?: boolean;
  nextReviewAt?: Date | null;
};

export type LifecycleReviewQueueItem = LifecycleReviewCandidate & {
  queue: ReviewQueueKey;
};

export type LifecycleReviewQueue = {
  counts: Record<ReviewQueueKey, number>;
  queues: Record<ReviewQueueKey, LifecycleReviewQueueItem[]>;
  nextUp: LifecycleReviewQueueItem | null;
};

const QUEUE_PRIORITY: Record<ReviewQueueKey, number> = {
  urgent: 4,
  renewal: 3,
  review: 2,
  research: 1,
};

const ATTENTION_PRIORITY: Record<LifecycleReviewCandidate["attentionLevel"], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

function classifyQueue(item: LifecycleReviewCandidate): ReviewQueueKey {
  if (
    item.lifecycleStatus === "replace_due" ||
    item.lifecycleStatus === "upgrade_due" ||
    item.supportStatus === "expired" ||
    item.attentionLevel === "high"
  ) {
    return "urgent";
  }

  if (item.recommendedAction === "renew" || item.lifecycleStatus === "renew" || item.licensingReviewRequired) {
    return "renewal";
  }

  if (
    item.recommendedAction === "research" ||
    item.lifecycleStatus === "unknown" ||
    item.supportStatus === "unknown"
  ) {
    return "research";
  }

  return "review";
}

function compareQueueItems(left: LifecycleReviewQueueItem, right: LifecycleReviewQueueItem) {
  const leftTime = left.nextReviewAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightTime = right.nextReviewAt?.getTime() ?? Number.POSITIVE_INFINITY;

  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  const attentionGap = ATTENTION_PRIORITY[right.attentionLevel] - ATTENTION_PRIORITY[left.attentionLevel];
  if (attentionGap !== 0) {
    return attentionGap;
  }

  return left.name.localeCompare(right.name);
}

export function buildLifecycleReviewQueue(
  items: LifecycleReviewCandidate[],
  _asOf: Date = new Date(),
): LifecycleReviewQueue {
  const queues: Record<ReviewQueueKey, LifecycleReviewQueueItem[]> = {
    urgent: [],
    renewal: [],
    review: [],
    research: [],
  };

  for (const item of items) {
    const queue = classifyQueue(item);
    queues[queue].push({
      ...item,
      queue,
    });
  }

  (Object.keys(queues) as ReviewQueueKey[]).forEach((key) => {
    queues[key].sort(compareQueueItems);
  });

  const nextUp =
    (Object.entries(queues) as Array<[ReviewQueueKey, LifecycleReviewQueueItem[]]>)
      .filter(([, queueItems]) => queueItems.length > 0)
      .sort((left, right) => {
        const priorityGap = QUEUE_PRIORITY[right[0]] - QUEUE_PRIORITY[left[0]];
        if (priorityGap !== 0) {
          return priorityGap;
        }

        return compareQueueItems(left[1][0]!, right[1][0]!);
      })[0]?.[1][0] ?? null;

  return {
    counts: {
      urgent: queues.urgent.length,
      renewal: queues.renewal.length,
      review: queues.review.length,
      research: queues.research.length,
    },
    queues,
    nextUp,
  };
}
