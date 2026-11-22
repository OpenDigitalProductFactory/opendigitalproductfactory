// Codex as a one-shot run (BI-A01B06F6): `codex exec` with the prompt on stdin
// and the final answer on stdout. Build Studio dispatch, Ideate and inference
// routing each built this command; this is the one copy, in the order they used,
// so each caller's command line is unchanged. Each caller keeps its own process
// envelope (user, working directory, runner, timeout, uncertainty handling).

/**
 * BI-F7D06E2D — `codex exec` is an agent with its own shell, apps, plugins,
 * browser and computer-use tools. When the platform's tools are described as
 * text, each of those is somewhere the model looks for them and does not find
 * them: TR-SCHED-AB4EF624 spent 120 s after one good call and ended "the
 * campaign action controls were unavailable". Text-tool mode switches them off,
 * as the bound read transport's config.toml does (codex-read-mcp.ts), so the
 * described JSON is the only way to act.
 */
export const CODEX_INFERENCE_ONLY_ARGS: readonly string[] = [
  "shell_tool", "unified_exec", "apps", "plugins", "browser_use", "computer_use",
  "multi_agent", "goals", "hooks", "image_generation",
].flatMap((feature) => ["-c", `features.${feature}=false`]).concat(["-c", 'web_search="disabled"']);

export type CodexExecOptions = {
  /** `bypass`: a coding run in the sandbox (Build Studio, Ideate). `read-only`: an answer with nothing committed (routing). */
  sandbox: "bypass" | "read-only";
  /** Read credentials from `$CODEX_HOME/auth.json` only, never the OS keychain. */
  fileCredentialStore?: boolean;
  /** Turn Codex's own tools off so platform tools described as text are the only way to act. */
  inferenceOnly?: boolean;
  /** `-i <file>` pairs for attached images. */
  imageArgs?: readonly string[];
  model?: string | null;
};

/** The arguments after `codex`. The prompt is read from stdin. */
export function codexExecArgs(options: CodexExecOptions): string[] {
  return [
    "exec",
    ...(options.fileCredentialStore ? ["-c", 'cli_auth_credentials_store="file"'] : []),
    ...(options.sandbox === "read-only" ? ["--sandbox", "read-only", "--ephemeral"] : ["--dangerously-bypass-approvals-and-sandbox"]),
    ...(options.inferenceOnly ? CODEX_INFERENCE_ONLY_ARGS : []),
    "--skip-git-repo-check",
    ...(options.imageArgs ?? []),
    ...(options.model ? ["-m", options.model] : []),
  ];
}
