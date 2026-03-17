import { TASK_TYPES } from "./task-types";

export type ClassificationResult = {
  taskType: string;
  confidence: number;
};

export function classifyTask(
  message: string,
  conversationContext: string[],
): ClassificationResult {
  const combinedText = [message, ...conversationContext.slice(0, 3)].join(" ");

  // Score each task type by pattern matches
  const scores: Array<{
    id: string;
    matchCount: number;
    totalPatterns: number;
  }> = [];

  for (const taskType of TASK_TYPES) {
    let matchCount = 0;
    for (const pattern of taskType.heuristicPatterns) {
      if (pattern.test(message)) {
        matchCount++;
      } else if (
        conversationContext.length > 0 &&
        pattern.test(combinedText)
      ) {
        matchCount += 0.5;
      }
    }
    if (matchCount > 0) {
      scores.push({
        id: taskType.id,
        matchCount,
        totalPatterns: taskType.heuristicPatterns.length,
      });
    }
  }

  if (scores.length === 0) {
    return { taskType: "unknown", confidence: 0 };
  }

  // Sort by matchCount descending, then by match ratio (specificity) as tiebreaker
  scores.sort((a, b) => {
    if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
    return b.matchCount / b.totalPatterns - a.matchCount / a.totalPatterns;
  });

  const top = scores[0]!;
  const second = scores[1];

  // Single clear winner
  if (
    scores.length === 1 ||
    (second && top.matchCount > second.matchCount * 1.5)
  ) {
    return { taskType: top.id, confidence: 0.8 };
  }

  // Ambiguous — multiple types match
  if (second && top.matchCount <= second.matchCount * 1.5) {
    if (top.matchCount >= 2) {
      return { taskType: top.id, confidence: 0.4 };
    }
    // When tied at low counts, use match ratio to pick the more specific type
    const topRatio = top.matchCount / top.totalPatterns;
    const secondRatio = second.matchCount / second.totalPatterns;
    if (topRatio > secondRatio) {
      return { taskType: top.id, confidence: 0.5 };
    }
    return { taskType: "unknown", confidence: 0.3 };
  }

  return {
    taskType: top.id,
    confidence: top.matchCount / top.totalPatterns,
  };
}
