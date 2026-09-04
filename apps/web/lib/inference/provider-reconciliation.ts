const INTERFACE_DRIFT_PATTERNS = [
  /unsupported parameter/i,
  /unknown parameter/i,
  /unrecognized parameter/i,
  /unexpected parameter/i,
  /invalid request/i,
  /tool_choice/i,
  /response_format/i,
  /structured output/i,
  /json schema/i,
  /function calling/i,
  /tool(?:s| use| calling)?[^.]*not supported/i,
  /does not support[^.]*tool/i,
  /does not support[^.]*response/i,
];

/** Signals that model discovery changed the candidate pool and routing may retry once. */
export class ProviderReconciliationRequiredError extends Error {
  readonly providerIds: string[];

  constructor(providerIds: Iterable<string>, attempts: unknown) {
    const ids = [...new Set(providerIds)];
    super(`Provider model inventory changed for ${ids.join(", ")}. Attempts: ${JSON.stringify(attempts)}`);
    this.name = "ProviderReconciliationRequiredError";
    this.providerIds = ids;
  }
}

export function isProviderReconciliationRequiredError(
  error: unknown,
): error is ProviderReconciliationRequiredError {
  return error instanceof ProviderReconciliationRequiredError
    || (typeof error === "object" && error !== null
      && "name" in error && error.name === "ProviderReconciliationRequiredError");
}

export async function withProviderReconciliationRetry<T>(
  attempt: () => Promise<T>,
  beforeRetry: () => void,
): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (!isProviderReconciliationRequiredError(error)) throw error;
    beforeRetry();
    return attempt();
  }
}

export function shouldDegradeModelForInterfaceDrift(
  code: string,
  message: string,
): boolean {
  if (code !== "provider_error") return false;
  return INTERFACE_DRIFT_PATTERNS.some((pattern) => pattern.test(message));
}

export function shouldReconcileProviderAfterError(
  code: string,
  message: string,
): boolean {
  if (code === "model_not_found") return true;
  return shouldDegradeModelForInterfaceDrift(code, message);
}
