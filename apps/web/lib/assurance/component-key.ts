import { createHash } from "node:crypto";
import type { BomComponentType } from "./bom-types";

export interface ComponentKeyInput {
  componentType: BomComponentType;
  ecosystem: string | null;
  name: string;
  version: string | null;
  packageUrl: string | null;
}

export function createComponentKey(input: ComponentKeyInput): string {
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
