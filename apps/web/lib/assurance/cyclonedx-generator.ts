import { createHash, randomUUID } from "node:crypto";
import { createBomComponentKey, createNpmPackageUrl } from "@dpf/db/bom-component-key";
import type { CycloneDxDocument, GeneratedBom, NormalizedBomComponent, NormalizedBomOccurrence } from "./bom-types";
import { parseImporterDependencies } from "./pnpm-lock-parser";

export interface BomModelProfileInput {
  providerId: string;
  modelId: string;
  modelStatus?: string | null;
}

export interface GenerateCycloneDxBomInput {
  workspacePath: string;
  packageJson: string;
  lockText: string;
  generatedAt: Date;
  gitRef: string;
  modelProfiles: BomModelProfileInput[];
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function packageComponent(name: string, version: string): NormalizedBomComponent {
  const packageUrl = version.startsWith("workspace:") ? null : createNpmPackageUrl(name, version);
  const componentType = name === "next" || name.startsWith("@dpf/") ? "framework" : "library";
  return {
    componentKey: createBomComponentKey({ componentType, ecosystem: "npm", name, version, packageUrl }),
    componentType,
    name,
    version,
    packageUrl,
    supplierName: null,
    licenseExpression: null,
    ecosystem: "npm",
    scope: "required",
    metadata: {},
  };
}

function modelComponent(profile: BomModelProfileInput): NormalizedBomComponent {
  return {
    componentKey: createBomComponentKey({
      componentType: "model",
      ecosystem: "ai-model",
      name: profile.modelId,
      version: profile.modelStatus ?? null,
      packageUrl: null,
    }),
    componentType: "model",
    name: profile.modelId,
    version: profile.modelStatus ?? null,
    packageUrl: null,
    supplierName: profile.providerId,
    licenseExpression: null,
    ecosystem: "ai-model",
    scope: "runtime",
    metadata: { providerId: profile.providerId },
  };
}

function cycloneDxType(component: NormalizedBomComponent): string {
  return component.componentType === "model" ? "machine-learning-model" : component.componentType;
}

function componentRef(component: NormalizedBomComponent): string {
  return component.packageUrl ?? component.componentKey;
}

export function generateCycloneDxBom(input: GenerateCycloneDxBomInput): GeneratedBom {
  const pkg = JSON.parse(input.packageJson) as { name?: string; version?: string };
  const deps = parseImporterDependencies(input.lockText, input.workspacePath);
  const components = [
    ...deps.map((dep) => packageComponent(dep.name, dep.resolvedVersion)),
    ...input.modelProfiles.map(modelComponent),
  ];
  const occurrences: NormalizedBomOccurrence[] = components.map((component) => ({
    occurrenceKey: createHash("sha256")
      .update([component.componentKey, input.workspacePath, component.scope ?? ""].join("::"))
      .digest("hex")
      .slice(0, 24),
    componentKey: component.componentKey,
    workspaceName: pkg.name ?? "web",
    workspacePath: input.workspacePath,
    dependencyKind: component.ecosystem === "npm" ? "dependencies" : "runtime-model",
    direct: true,
    evidence: { gitRef: input.gitRef },
  }));
  const cyclonedx: CycloneDxDocument = {
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: input.generatedAt.toISOString(),
      component: {
        type: "application",
        name: pkg.name ?? "web",
        version: pkg.version ?? "0.0.0",
        "bom-ref": pkg.name ?? "web",
      },
      properties: [
        { name: "dpf:gitRef", value: input.gitRef },
        { name: "dpf:workspacePath", value: input.workspacePath },
      ],
    },
    components: components.map((component) => ({
      "bom-ref": componentRef(component),
      type: cycloneDxType(component),
      name: component.name,
      version: component.version ?? undefined,
      purl: component.packageUrl ?? undefined,
      supplier: component.supplierName ? { name: component.supplierName } : undefined,
    })),
    dependencies: components.map((component) => ({ ref: componentRef(component) })),
  };

  return {
    cyclonedx,
    components,
    occurrences,
    sourceDigest: sha256({ lockText: input.lockText, packageJson: input.packageJson, modelProfiles: input.modelProfiles }),
    documentDigest: sha256(cyclonedx),
  };
}
