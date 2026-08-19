import type { SandboxSourceCurrencySnapshot } from "./sandbox-source-currency";

/** Capture the immutable post-commit tree identity used by assembled review. */
export async function refreshCommittedSourceCurrency(args: {
  workspace: string;
  targetRef: string;
  exec(command: string): Promise<string>;
}): Promise<SandboxSourceCurrencySnapshot | null> {
  try {
    const {
      buildSandboxSourceCurrencyProbeCommand,
      parseSandboxSourceCurrencyProbeOutput,
    } = await import("./sandbox-source-currency");
    const probe = await args.exec(buildSandboxSourceCurrencyProbeCommand({
      workspace: args.workspace,
      targetRef: args.targetRef,
    }));
    return parseSandboxSourceCurrencyProbeOutput(probe, {
      targetRef: args.targetRef,
      workspace: args.workspace,
    });
  } catch (error) {
    console.warn(
      "[build-pipeline] post-capture source identity unavailable:",
      (error as Error)?.message,
    );
    return null;
  }
}
