import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(scriptDirectory, "..");

function source(root, path) {
  return readFileSync(join(root, path), "utf8");
}

export function inspectPlatformCompositionSingleHome(root = defaultRoot) {
  const failures = [];
  const opsNav = source(root, "apps/web/components/ops/ops-nav.ts");
  const productNav = source(root, "apps/web/components/product/ProductTabNav.tsx");
  const productDependencies = source(root, "apps/web/app/(shell)/portfolio/product/[id]/inventory/page.tsx");
  const stackRedirect = source(root, "apps/web/app/(shell)/ops/stack-currency/page.tsx");
  const supplyChainRedirect = source(root, "apps/web/app/(shell)/portfolio/product/[id]/supply-chain/page.tsx");
  const seed = source(root, "packages/db/src/seed.ts");
  const platformSeed = source(root, "packages/db/src/platform-sbom-seed.ts");
  const buildBomGenerator = source(root, "apps/web/lib/assurance/cyclonedx-generator.ts");
  const dockerfile = source(root, "Dockerfile");

  if (opsNav.includes("Stack Currency") || opsNav.includes("/ops/stack-currency")) {
    failures.push("Operations navigation still publishes Stack Currency.");
  }
  if (!opsNav.includes("Workrooms")) {
    failures.push("The unrelated Workrooms navigation entry was removed.");
  }
  if (productNav.includes("Supply Chain") || productNav.includes("/supply-chain")) {
    failures.push("Product navigation still publishes a separate Supply Chain destination.");
  }
  if (!productDependencies.includes("ProductRelationshipsSection") || !productDependencies.includes("ProductSoftwareCompositionPanel")) {
    failures.push("The product Dependencies page does not compose relationships, estate, and SBOM.");
  }
  for (const requiredSummary of ["Product relationships", "Estate items", "SBOM components", "Currency attention"]) {
    if (!productDependencies.includes(requiredSummary)) {
      failures.push(`The Dependencies first viewport is missing the ${requiredSummary} summary.`);
    }
  }
  if (!productDependencies.includes("deriveCurrency") || !productDependencies.includes("deriveSupportEndDate")) {
    failures.push("The product summary does not derive currency attention from the canonical lifecycle helpers.");
  }
  if (!stackRedirect.includes("/inventory#software-composition") || !stackRedirect.includes("redirect(")) {
    failures.push("The legacy Stack Currency route does not redirect to product software composition.");
  }
  if (stackRedirect.includes("ProductSoftwareCompositionPanel") || stackRedirect.includes("platform-stack")) {
    failures.push("The legacy Stack Currency compatibility route still owns presentation or component facts.");
  }
  if (!supplyChainRedirect.includes("/inventory#software-composition") || !supplyChainRedirect.includes("redirect(")) {
    failures.push("The legacy Supply Chain route does not redirect to product software composition.");
  }
  if (!seed.includes("persistPlatformSbom") || !seed.includes('step("platformSbom"')) {
    failures.push("The governed seed does not invoke canonical platform SBOM persistence.");
  }
  if (!platformSeed.includes('from "./bom-component-key"') || !platformSeed.includes("createBomComponentKey(")) {
    failures.push("Platform SBOM ingestion does not use the canonical BOM component identity contract.");
  }
  if (!buildBomGenerator.includes('from "@dpf/db/bom-component-key"') || !buildBomGenerator.includes("createBomComponentKey(")) {
    failures.push("Build SBOM generation does not use the canonical BOM component identity contract.");
  }
  if (!dockerfile.includes("COPY scripts/sbom/generate-platform-sbom.mjs ./scripts/sbom/")) {
    failures.push("The runtime init image does not package the canonical platform SBOM generator.");
  }
  if (!dockerfile.includes("COPY --from=init /app/.github ./.github")) {
    failures.push("The runtime image does not package the platform image manifest used by the SBOM generator.");
  }

  for (const retiredPath of [
    "apps/web/components/ops/StackCurrencyTable.tsx",
    "apps/web/lib/operate/platform-stack.ts",
    "apps/web/lib/operate/platform-stack.test.ts",
    "apps/web/lib/assurance/component-key.ts",
    "apps/web/lib/assurance/component-key.test.ts",
    "apps/web/lib/ux-budget/purpose-contracts/stack-currency.ts",
  ]) {
    if (existsSync(join(root, retiredPath))) failures.push(`Retired duplicate substrate remains: ${retiredPath}`);
  }

  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = inspectPlatformCompositionSingleHome();
  if (failures.length > 0) {
    console.error(failures.map((failure) => `- ${failure}`).join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Platform software composition has one canonical product home.");
  }
}
