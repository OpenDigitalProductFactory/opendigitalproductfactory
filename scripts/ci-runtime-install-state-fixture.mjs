// Fresh CI databases have no installed host. Declare their fixture explicitly;
// production bootstrap still requires its mounted canonical install state.
import { readFile } from "node:fs/promises";
import { computeCapabilityStateVersion } from "./lib/capability-state-hash.mjs";
import { validateInstallState } from "./installer/validate-install-state.mjs";

const catalog = JSON.parse(await readFile(new URL("./capability-service-catalog.generated.json", import.meta.url), "utf8"));
const enabledRuntimeCapabilities = ["runtime:core"];
const state = {
  schemaVersion: 2, installerVersion: "ci-fixture", platform: "linux", arch: "amd64",
  enabledRuntimeCapabilities, capabilityCatalogHash: catalog.catalogHash,
  capabilityStateVersion: computeCapabilityStateVersion(catalog.catalogHash,
    enabledRuntimeCapabilities, catalog.capabilities.map(c => c.capabilityId)),
};
const validation = await validateInstallState(state);
if (!validation.valid) throw new Error(`invalid_ci_host_fixture:${validation.errors.join(", ")}`);
console.log(JSON.stringify(state));
