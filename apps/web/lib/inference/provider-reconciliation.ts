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
