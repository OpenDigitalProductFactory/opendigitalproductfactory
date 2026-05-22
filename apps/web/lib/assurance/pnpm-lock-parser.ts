export interface PnpmImporterDependency {
  name: string;
  specifier: string;
  resolvedVersion: string;
  dependencyKind: "dependencies" | "devDependencies" | "optionalDependencies";
}

function normalizeVersion(raw: string, specifier: string): string {
  const trimmed = raw.trim().replace(/^['"]|['"]$/g, "");
  if (trimmed.startsWith("link:") || trimmed.startsWith("workspace:")) return specifier;
  return trimmed.split("(")[0] ?? trimmed;
}

export function parseImporterDependencies(lockText: string, importerPath: string): PnpmImporterDependency[] {
  const lines = lockText.replace(/\r\n/g, "\n").split("\n");
  const importerHeader = `  ${importerPath}:`;
  const start = lines.findIndex((line) => line === importerHeader);
  if (start < 0) return [];

  const result: PnpmImporterDependency[] = [];
  let currentKind: PnpmImporterDependency["dependencyKind"] | null = null;
  let currentName: string | null = null;
  let currentSpecifier: string | null = null;

  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (/^  \S/.test(line)) break;

    const kindMatch = line.match(/^    (dependencies|devDependencies|optionalDependencies):$/);
    if (kindMatch) {
      currentKind = kindMatch[1] as PnpmImporterDependency["dependencyKind"];
      currentName = null;
      currentSpecifier = null;
      continue;
    }
    if (!currentKind) continue;

    const nameMatch = line.match(/^      (.+):$/);
    if (nameMatch) {
      currentName = nameMatch[1]!.replace(/^['"]|['"]$/g, "");
      currentSpecifier = null;
      continue;
    }

    const specifierMatch = line.match(/^        specifier: (.+)$/);
    if (specifierMatch) {
      currentSpecifier = specifierMatch[1]!.trim().replace(/^['"]|['"]$/g, "");
      continue;
    }

    const versionMatch = line.match(/^        version: (.+)$/);
    if (versionMatch && currentName && currentSpecifier && currentKind === "dependencies") {
      result.push({
        name: currentName,
        specifier: currentSpecifier,
        resolvedVersion: normalizeVersion(versionMatch[1]!, currentSpecifier),
        dependencyKind: currentKind,
      });
    }
  }

  return result;
}
