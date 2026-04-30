// apps/web/lib/orchestration/assert-never.ts
// Exhaustiveness helper for discriminated-union pattern matching.

export function assertNever(x: never, ctx?: string): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(x)}${ctx ? ` (${ctx})` : ""}`);
}
