import { createHash } from "node:crypto";

export type BomComponentKeyInput = {
  componentType: "library" | "framework" | "application" | "container" | "model";
  ecosystem: string | null;
  name: string;
  version: string | null;
  packageUrl: string | null;
};

export function createBomComponentKey(input: BomComponentKeyInput): string {
  return createHash("sha256")
    .update([
      input.componentType,
      input.ecosystem ?? "",
      input.name.trim().toLowerCase(),
      input.version ?? "",
      input.packageUrl ?? "",
    ].join("::"))
    .digest("hex")
    .slice(0, 24);
}

export function createNpmPackageUrl(name: string, version: string): string {
  const encodedName = name.startsWith("@") ? `%40${name.slice(1)}` : name;
  return `pkg:npm/${encodedName}@${version}`;
}
