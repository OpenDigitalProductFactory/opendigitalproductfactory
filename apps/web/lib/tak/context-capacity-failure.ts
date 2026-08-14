/** Turn a fail-closed routing context shortfall into actionable coworker guidance. */
export function describeContextCapacityFailure(message: string): string | null {
  const shortfall = message.match(/Context window too small:\s*(\d+)\s*<\s*(\d+)/i);
  if (!/No eligible endpoints/i.test(message) || !shortfall) return null;
  const served = Number(shortfall[1]).toLocaleString("en-US");
  const required = Number(shortfall[2]).toLocaleString("en-US");
  return (
    `No AI model can handle this request because the available model serves ${served} context tokens, ` +
    `while this turn requires ${required}. Raise the local served context in Platform > AI Operations > ` +
    "Providers & Routing, reduce this coworker's active prompt/tool surface, or add a larger-context model. " +
    "Retrying unchanged will not clear this limit."
  );
}
