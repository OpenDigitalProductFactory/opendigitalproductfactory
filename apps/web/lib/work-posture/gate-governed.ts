/**
 * BI-D0DFE502 / WWMD DI-EDAF65D71636 — which rooms' changes already pass a
 * governed gate chain before they land.
 *
 * A Build Studio room's change goes through CI, the merge queue, semantic
 * review and DCO; its "propose" is to those gates, not to a person. The same
 * executor predicate keeps the workroom drive out of these rooms (BI-B5751303).
 */
export function isGateGovernedExecutor(executorKind: string | null | undefined): boolean {
  return executorKind === "build-studio";
}
