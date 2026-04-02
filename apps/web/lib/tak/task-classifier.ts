import { TASK_TYPES } from "@/lib/task-types";

export type ClassificationResult = {
  taskType: string;
  confidence: number;
  requiresCodeExecution?: boolean;
  requiresWebSearch?: boolean;
  requiresComputerUse?: boolean;
};

// EP-INF-008b: Message-level capability detection
function detectCapabilityHints(message: string): Pick<ClassificationResult, "requiresCodeExecution" | "requiresComputerUse"> {
  const hints: Pick<ClassificationResult, "requiresCodeExecution" | "requiresComputerUse"> = {};

  if (
    /\b(run|execute|eval)\b.*\b(code|script|program|python|javascript)\b/i.test(message)
    || /\b(run (this|that|it|the code))\b/i.test(message)
  ) {
    hints.requiresCodeExecution = true;
  }

  if (
    /\b(click|navigate|fill (out|in)|browse|open (the |a )?(site|page|url|form))\b/i.test(message)
    || /\b(computer use|browser (control|automation))\b/i.test(message)
  ) {
    hints.requiresComputerUse = true;
  }

  return hints;
}

export function classifyTask(
  message: string,
  conversationContext: string[],
): ClassificationResult {
  const combinedText = [message, ...conversationContext.slice(0, 3)].join(" ");

  // EP-INF-008b: Detect capability hints from message text (applies to all return paths)
  const msgCapHints = detectCapabilityHints(message);

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
    return { taskType: "unknown", confidence: 0, ...msgCapHints };
  }

  // Sort by matchCount descending, then by match ratio (specificity) as tiebreaker
  scores.sort((a, b) => {
    if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
    return b.matchCount / b.totalPatterns - a.matchCount / a.totalPatterns;
  });

  const top = scores[0]!;
  const second = scores[1];

  // Merge task-type-level capability hints for the top match
  const topTaskType = TASK_TYPES.find((t) => t.id === top.id);
  const capHints = {
    ...msgCapHints,
    ...(topTaskType?.capabilityHints ?? {}),
  };

  // Single clear winner
  if (
    scores.length === 1 ||
    (second && top.matchCount > second.matchCount * 1.5)
  ) {
    return { taskType: top.id, confidence: 0.8, ...capHints };
  }

  // Ambiguous — multiple types match
  if (second && top.matchCount <= second.matchCount * 1.5) {
    if (top.matchCount >= 2) {
      return { taskType: top.id, confidence: 0.4, ...capHints };
    }
    // When tied at low counts, use match ratio to pick the more specific type
    const topRatio = top.matchCount / top.totalPatterns;
    const secondRatio = second.matchCount / second.totalPatterns;
    if (topRatio > secondRatio) {
      return { taskType: top.id, confidence: 0.5, ...capHints };
    }
    return { taskType: "unknown", confidence: 0.3, ...capHints };
  }

  return {
    taskType: top.id,
    confidence: top.matchCount / top.totalPatterns,
    ...capHints,
  };
}
