/**
 * A clone cannot share one transaction with pg_dump/psql child processes.
 * Clear the disposable destination before publication and again on failure.
 */
export async function runWithDestinationCleanup<T>(
  resetDestination: () => Promise<void>,
  clone: () => Promise<T>,
): Promise<T> {
  await resetDestination();
  try {
    return await clone();
  } catch (cloneError) {
    try {
      await resetDestination();
    } catch (cleanupError) {
      throw new AggregateError(
        [cloneError, cleanupError],
        "Sanitized clone failed and destination cleanup also failed",
      );
    }
    throw cloneError;
  }
}

export async function runSourceCheckedClone<T>(
  resetDestination: () => Promise<void>,
  checkSource: () => Promise<void>,
  clone: () => Promise<T>,
): Promise<T> {
  return runWithDestinationCleanup(resetDestination, async () => {
    await checkSource();
    return clone();
  });
}
