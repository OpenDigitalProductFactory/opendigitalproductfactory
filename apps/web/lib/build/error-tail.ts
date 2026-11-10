import { getErrorMessage } from "@/lib/shared/get-error-message";

/**
 * The end of a failed command's message, where git states why. A failed
 * docker exec message starts with the whole command line, so its head says
 * nothing (BI-76BD65E6: both 2026-10-13 ship-refresh failures recorded only that).
 */
export function errorTail(err: unknown, max = 400): string {
  const text = getErrorMessage(err);
  return text.length <= max ? text : `…${text.slice(-max)}`;
}
