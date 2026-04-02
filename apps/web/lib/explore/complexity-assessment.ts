import type { ComplexityScores, ComplexityPath, ComplexityResult } from "./feature-build-types";

const SIMPLE_MAX = 10;
const MODERATE_MAX = 16;

export function assessComplexity(scores: ComplexityScores): ComplexityResult {
  const total = Object.values(scores).reduce((sum, s) => sum + s, 0);

  let path: ComplexityPath;
  if (total <= SIMPLE_MAX) {
    path = "simple";
  } else if (total <= MODERATE_MAX) {
    path = "moderate";
  } else {
    path = "complex";
  }

  return { total, path, scores };
}
