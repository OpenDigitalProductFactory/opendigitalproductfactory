export const COWORKER_UNAVAILABLE_ERROR =
  "This coworker is unavailable or you do not have permission to use it.";

export function coworkerUnavailableResult() {
  return { error: COWORKER_UNAVAILABLE_ERROR };
}
