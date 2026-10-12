export function requireVerificationEnvironment(value: unknown): void {
  if (value !== "development" && value !== "test") {
    throw new Error("Projection verification requires a development or test installation.");
  }
}

/** The database rejects our private sentinel only after rolling back. Other
 * errors, including transaction timeout/connection errors, remain failures. */
export async function observeWithRollback<Tx, Result>(
  transaction: (work: (tx: Tx) => Promise<never>) => Promise<never>,
  observe: (tx: Tx) => Promise<Result>,
): Promise<Result> {
  const sentinel = new Error("projection-verification-rollback");
  let observed: { value: Result } | undefined;
  try {
    await transaction(async tx => {
      observed = { value: await observe(tx) };
      throw sentinel;
    });
  } catch (error) {
    if (error === sentinel && observed) return observed.value;
    throw error;
  }
  throw new Error("Rollback was not confirmed; verification has no passing result.");
}
