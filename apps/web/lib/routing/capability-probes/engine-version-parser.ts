export type EngineVersionParseConfig = {
  engineId: string;
  binary: string;
  versionRegex: string | RegExp;
};

function toRegExp(versionRegex: string | RegExp): RegExp {
  return typeof versionRegex === "string" ? new RegExp(versionRegex) : versionRegex;
}

export function extractEngineVersion(
  engine: EngineVersionParseConfig,
  stdout: string,
): string | null {
  const regex = toRegExp(engine.versionRegex);
  regex.lastIndex = 0;
  const match = regex.exec(stdout);
  if (match) return match[1] ?? match[0];

  if (engine.binary === "claude" || engine.engineId === "claude") {
    return (
      /\b(\d+\.\d+\.\d+)\s+\(Claude Code\)(?:\s|$)/i.exec(stdout)?.[1] ??
      /\bclaude-code\/(\d+\.\d+\.\d+)\b/i.exec(stdout)?.[1] ??
      null
    );
  }

  return null;
}
