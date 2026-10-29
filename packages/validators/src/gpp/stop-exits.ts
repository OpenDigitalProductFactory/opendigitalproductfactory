/** The same stop-exit conformance rule read by the host and GPP soundness S-6. */
export function validateStopExits(shape: { key: string; stopConditions: readonly { kind: string }[] }): string[] {
  const issues: string[] = [];
  if (!shape.stopConditions.some(stop => stop.kind === "failure")) {
    issues.push(`${shape.key}: no failure exit — only a successful one`);
  }
  if (!shape.stopConditions.some(stop => stop.kind === "budget")) {
    issues.push(`${shape.key}: no budget stop — a self-starting shape without a spend ceiling is unbounded`);
  }
  return issues;
}
