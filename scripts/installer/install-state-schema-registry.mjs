import { readFile } from "node:fs/promises";

const schemaUrls = new Map([
  [1, new URL("./install-state.v1.schema.json", import.meta.url)],
  [2, new URL("./install-state.v2.schema.json", import.meta.url)],
]);

export const currentSchemaVersion = 2;
export const migrationEdges = new Map([
  ["1->2", { addedRequiredFields: ["enabledRuntimeCapabilities", "capabilityCatalogHash", "capabilityStateVersion"] }],
]);
export const schemasByVersion = new Map(
  await Promise.all([...schemaUrls].map(async ([version, url]) => [version, JSON.parse(await readFile(url, "utf8"))])),
);

export function getInstallStateSchema(version) {
  return schemasByVersion.get(version);
}
