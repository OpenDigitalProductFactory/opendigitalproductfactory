import { getErrorMessage } from "@/lib/shared/get-error-message";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";

type RegistrationEnvironment = Readonly<Record<string, string | undefined>> & Readonly<{
  APP_URL?: string;
  PORT?: string;
}>;

type RegistrationResponse = Readonly<{
  ok: boolean;
  status: number;
}>;

type RegistrationDependencies = Readonly<{
  endpoint: string;
  fetchRegistration(
    endpoint: string,
    init: { method: "PUT" },
  ): Promise<RegistrationResponse>;
  recordRegistration(ok: boolean, error: string | null): Promise<unknown>;
  reconcileAdmissions(): Promise<unknown>;
}>;

export type InngestSelfRegistrationResult = ActionResult<{
  status: number;
  reconciliationError?: string;
}>;

function listenerPort(port: string | undefined): string {
  if (!port || !/^\d+$/.test(port)) return "3000";
  const value = Number(port);
  return value >= 1 && value <= 65_535 ? port : "3000";
}

export function resolveInngestSelfRegistrationEndpoint(
  env: RegistrationEnvironment,
): string {
  const base = env.APP_URL?.trim() || `http://127.0.0.1:${listenerPort(env.PORT)}`;
  return new URL("api/inngest", `${base.replace(/\/+$/, "")}/`).toString();
}

export async function syncInngestSelfRegistration(
  dependencies: RegistrationDependencies,
): Promise<InngestSelfRegistrationResult> {
  let response: RegistrationResponse;
  try {
    response = await dependencies.fetchRegistration(dependencies.endpoint, { method: "PUT" });
  } catch (error) {
    const detail = getErrorMessage(error);
    await dependencies.recordRegistration(false, `Inngest re-sync failed: ${detail}`);
    return err(detail);
  }

  if (!response.ok) {
    const detail = `HTTP ${response.status}`;
    await dependencies.recordRegistration(false, `Inngest re-sync failed: ${detail}`);
    return err(detail);
  }

  await dependencies.recordRegistration(true, null);
  try {
    await dependencies.reconcileAdmissions();
    return ok({ status: response.status });
  } catch (error) {
    return ok({
      status: response.status,
      reconciliationError: getErrorMessage(error),
    });
  }
}
