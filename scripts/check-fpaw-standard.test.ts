import { strict as assert } from "node:assert";
import test from "node:test";
import { analyzeFPAW, currentInventory } from "./check-fpaw-standard";
import {
  assertRejected,
  catalog,
  core,
  replaceMatched,
  replaceRequired,
} from "./lib/fpaw-standard-test-fixtures";

test("the checked-in FPAW standard reconciles with every canonical invariant", () => {
  const result = analyzeFPAW(core, catalog, currentInventory());
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.metrics, {
    categories: 25,
    leaves: 107,
    itemTemplates: 574,
    matrixFamilies: 10,
    matrixCells: 250,
    deviations: 34,
    coreRequirements: 180,
    catalogRequirements: 18,
    totalRequirements: 198,
    profiles: 9,
    workedSpecimens: 7,
    sourceUseDecisions: 11,
    sourceCitations: 36,
    contributorAttestations: 2,
  });
});

test("the checker rejects duplicate and malformed requirement definitions", () => {
  assertRejected(
    core.replace("FPAW-PORT-016", "FPAW-PORT-015"),
    catalog,
    /duplicate requirement IDs/,
  );
  assertRejected(
    core.replace(
      "| `FPAW-CORE-001` | A conformance scope **MUST** identify its Organization, standard version, profiles, resolution depth, owner, and effective period. | `R0` |",
      "| `FPAW-CORE-001` | A conformance scope **MUST** identify its Organization, standard version, profiles, resolution depth, owner, and effective period. | depth-zero |",
    ),
    catalog,
    /requirement row\(s\) have malformed\/missing depth/,
  );
});

test("the checker rejects undefined requirement references", () => {
  assertRejected(`${core}\nUndefined reference: \`FPAW-CORE-999\`.\n`, catalog, /undefined requirement references/);
});

test("the checker rejects invalid or structurally collapsed matrix cells", () => {
  assertRejected(
    core,
    catalog.replace(
      "| `beauty-personal-care` | `required`",
      "| `beauty-personal-care` | `sometimes`",
    ),
    /invalid states sometimes/,
  );
  assertRejected(
    core,
    catalog.replace(
      "| `beauty-personal-care` | `required` | `required` |",
      "| `beauty-personal-care` | `required` |",
    ),
    /has 9 matrix cells, expected 10/,
  );
  assertRejected(
    core,
    catalog.replace(
      "| `beauty-personal-care` | `required` | `required` |",
      "| `beauty-personal-care` | `required` `required` |",
    ),
    /row has 10 Markdown cells, expected 11/,
  );
});

test("the checker reconciles the shared-family registry with the matrix header", () => {
  assertRejected(
    core,
    catalog.replace(
      "| `CW-DEMAND-MARKET` | research demand",
      "| `CW-FAKE-MARKET` | research demand",
    ),
    /matrix\/shared-family mismatch/,
  );
  assertRejected(
    core,
    catalog.replace(
      "`CW-DEMAND-MARKET` | `CC` `CW-CUSTOMER-CARE`",
      "`CW-DEMAND-MARKET` `CC` `CW-CUSTOMER-CARE`",
    ),
    /matrix header must contain Category plus 10 cells|exactly one shared family/,
  );
});

test("the checker rejects any AI-realization state outside the closed four-state set", () => {
  assertRejected(
    core,
    catalog.replace(
      "| `profile-bound` | AI participates",
      "| `experimental` | An ungoverned fifth state. |\n| `profile-bound` | AI participates",
    ),
    /AI-realization state set must be exactly/,
  );
});

test("the checker preserves canonical leaf-to-category grouping", () => {
  const swapped = catalog
    .replace("- `veterinary-clinic`", "- `__leaf-swap__`")
    .replace("- `hair-salon`", "- `veterinary-clinic`")
    .replace("- `__leaf-swap__`", "- `hair-salon`");
  assertRejected(core, swapped, /appears under .* canonical category is/);
});

test("the checker rejects duplicate canonical inventory leaves", () => {
  const inventory = currentInventory();
  inventory.leaves.push(inventory.leaves[0]);
  const result = analyzeFPAW(core, catalog, inventory);
  assert(result.errors.some((error) => error.includes("inventory: duplicate leaves")));
});

test("the checker reconciles every deviation with its inherited matrix state", () => {
  assertRejected(
    core,
    catalog.replace(
      "| `mobile-phlebotomy` | `CW-SUPPLY` | `recommended` |",
      "| `mobile-phlebotomy` | `CW-SUPPLY` | `required` |",
    ),
    /inherits required, matrix healthcare-wellness is recommended/,
  );
});

test("the checker requires an activity-authority-evidence rationale for every category", () => {
  assertRejected(
    core,
    catalog.replace(/^\| `healthcare-wellness` \| clinical intake[^\r\n]*\r?\n/m, ""),
    /category rationale coverage mismatch/,
  );
});

test("the checker rejects missing or empty deviation records", () => {
  assertRejected(
    core,
    catalog.replace(
      /^\| `mobile-phlebotomy` \| `CW-SUPPLY`[^\r\n]*\r?\n/m,
      "",
    ),
    /expected 34 leaf deviations, found 33/,
  );
});

test("the checker enforces an acyclic profile graph rooted in Core", () => {
  assertRejected(
    core.replace(
      "| `FPAW-Core-Semantic` | none |",
      "| `FPAW-Core-Semantic` | Core |",
    ),
    catalog,
    /profile dependency cycle|must not depend on another profile/,
  );
  assertRejected(
    core.replace(
      "| `FPAW-Four-Portfolio` | Core |",
      "| `FPAW-Four-Portfolio` | Missing-Profile |",
    ),
    catalog,
    /undefined profile dependency/,
  );
});

test("the checker derives profile minimum depth from requirement membership", () => {
  assertRejected(
    core.replace(
      "| `FPAW-Four-Portfolio` | Core | `R5` |",
      "| `FPAW-Four-Portfolio` | Core | `R0` |",
    ),
    catalog,
    /minimum R0 is below membership depth/,
  );
});

test("the checker requires complete, unique source-governance records", () => {
  assertRejected(
    core.replace(/^\| Attribution \/ trademark \|[^\r\n]*\r?\n/m, ""),
    catalog,
    /SUD-MB-FPAW-DIRECT-2026-08-01 omits attribution \/ trademark/,
  );
  assertRejected(
    `${core}\nUnresolved citation: \`SCIT-NOT-DEFINED\`.\n`,
    catalog,
    /SourceCitation: undefined references/,
  );
});

test("the checker requires seven non-empty worked specimens bound to canonical leaves", () => {
  assertRejected(
    core,
    catalog.replace(
      "#### `FPAW-EX-HVAC-CONTRACTOR@0.1.0`",
      "##### `FPAW-EX-HVAC-CONTRACTOR@0.1.0`",
    ),
    /expected 7 worked specimens, found 6/,
  );
  assertRejected(
    core,
    catalog.replace(
      "FPAW-EX-HVAC-CONTRACTOR@0.1.0",
      "FPAW-EX-NOT-A-CANONICAL-LEAF@0.1.0",
    ),
    /does not resolve to a canonical leaf/,
  );
  assertRejected(
    core,
    catalog.replace(
      "`trades-maintenance/hvac-contractor` repair",
      "`trades-maintenance/plumber` repair",
    ),
    /purpose does not bind `trades-maintenance\/hvac-contractor`/,
  );
});

test("the checker detects stale implementation inventory counts", () => {
  assertRejected(
    core.replace("107 unique leaf archetypes with 574 item", "107 unique leaf archetypes with 573 item"),
    catalog,
    /source inventory .* does not match 25\/107\/574/,
  );
});

test("the checker enforces the explicit runtime-to-exchange portfolio adapter", () => {
  assertRejected(
    core.replace(
      "| `manufactureAndDeliver` | `manufacturing_and_delivery` |",
      "| `manufactureAndDeliver` | `manufacture_and_delivery` |",
    ),
    catalog,
    /portfolio adapter mapping is incomplete or incorrect/,
  );
});

test("the checker reconciles every linked orientation URL to its SourceCitation locator", () => {
  assertRejected(
    core.replace(
      "[CMMN](https://www.omg.org/spec/CMMN)",
      "[CMMN](https://www.omg.org/cmmn/index.htm)",
    ),
    catalog,
    /orientation URL has no exact SourceCitation locator/,
  );
});

test("the Stage guard protects the controlled table without rejecting historical prose", () => {
  const withHistory = `${core}\nHistorical retired key: \`attract-discover\`.\n`;
  assert.deepEqual(analyzeFPAW(withHistory, catalog, currentInventory()).errors, []);
  assertRejected(
    core.replace("| `attract` | Attract & Discover |", "| `attract-discover` | Attract & Discover |"),
    catalog,
    /canonical Stage keys must be exactly/,
  );
});

test("the checker enforces each profile's exact dependency and family contract", () => {
  assertRejected(
    replaceRequired(
      core,
      "| `FPAW-Four-Portfolio` | Core | `R5` | `FPAW-PORT-*`, `FPAW-PROD-*`, `FPAW-CONF-*` |",
      "| `FPAW-Four-Portfolio` | Core | `R5` | `FPAW-CONF-*` |",
    ),
    catalog,
    /FPAW-Four-Portfolio requirement families must be exactly/,
  );
  assertRejected(
    replaceRequired(
      core,
      "| `FPAW-Workforce-AI` | Core, Operational-Work, Assurance-Evidence |",
      "| `FPAW-Workforce-AI` | Core, Operational-Work |",
    ),
    catalog,
    /FPAW-Workforce-AI dependencies must be exactly/,
  );
  assertRejected(
    replaceRequired(
      core,
      "| `FPAW-Business-Offering-Value` | Core, Four-Portfolio |",
      "| `FPAW-Business-Offering-Value` | Core, Core, Four-Portfolio |",
    ),
    catalog,
    /FPAW-Business-Offering-Value has duplicate dependencies/,
  );
  assertRejected(
    replaceRequired(
      core,
      "`FPAW-PORT-*`, `FPAW-PROD-*`, `FPAW-CONF-*`",
      "`FPAW-PORT-*`, `FPAW-PORT-*`, `FPAW-PROD-*`, `FPAW-CONF-*`",
    ),
    catalog,
    /FPAW-Four-Portfolio has duplicate requirement families/,
  );
});

test("the checker enforces the exact Candidate source-record identities", () => {
  assertRejected(
    replaceRequired(
      core,
      "#### 20.2.6 `SUD-W205-2026-08-01`",
      "#### 20.2.6 `SUD-FABRICATED-2026-08-01`",
    ),
    catalog,
    /SourceUseDecision set must be exactly/,
  );
  assertRejected(
    replaceRequired(
      core,
      "#### 20.3.2 `CA-MB-2026-08-01-CSDM-PROVENANCE`",
      "#### 20.3.2 `CA-FABRICATED-2026-08-01`",
    ),
    catalog,
    /ContributorAttestation set must be exactly/,
  );
  assertRejected(
    replaceRequired(core, "`SCIT-W3C-DCAT3`", "`SCIT-W3C-FABRICATED`"),
    catalog,
    /SourceCitation set must be exactly/,
  );
  assertRejected(
    replaceRequired(
      core,
      "#### 20.2.6 `SUD-W205-2026-08-01`",
      "#### 20.2.6 `SUD-G252-COMPILED-2026-08-01`",
    ),
    catalog,
    /SourceUseDecision: duplicate definitions/,
  );
});

test("the checker requires valid SUD status and per-action dispositions", () => {
  assertRejected(
    replaceMatched(
      core,
      /^\| Intended use \/ status \|[^\r\n]*`permitted-contributor` \|$/m,
      (line) => line.replace("`permitted-contributor`", "`pending-review`"),
    ),
    catalog,
    /has invalid intended-use status/,
  );
  assertRejected(
    replaceMatched(
      core,
      /^\| Action permissions \|[^\r\n]*AI processing: yes[^\r\n]*\|$/m,
      (line) => line.replace("AI processing: yes", "AI processing yes"),
    ),
    catalog,
    /action permissions lack a disposition for ai processing/,
  );
});

test("the checker rejects semantically empty source-record fields", () => {
  assertRejected(
    replaceMatched(
      core,
      /^\| Source\/title\/owner\/version\/locator\/access \|[^\r\n]+\|$/m,
      () => "| Source/title/owner/version/locator/access | <!-- hidden --> |",
    ),
    catalog,
    /has empty source\/title\/owner\/version\/locator\/access/,
  );
  assertRejected(
    replaceMatched(
      core,
      /^\| Contributor \/ authentication \|[^\r\n]+\|$/m,
      () => "| Contributor / authentication | <!-- hidden --> |",
    ),
    catalog,
    /has empty contributor \/ authentication/,
  );
});

test("the checker requires canonical HTTPS citation locators and orientation links", () => {
  assertRejected(
    replaceMatched(
      core,
      /^\| `SCIT-SNOW-CSDM-RESOURCES`[^\r\n]+\|$/m,
      (line) => line.replace(/<https:\/\/[^>]+>/, "ServiceNow site search"),
    ),
    catalog,
    /must have a canonical HTTPS locator/,
  );
  assertRejected(
    replaceRequired(
      core,
      "[CMMN](https://www.omg.org/spec/CMMN)",
      "[CMMN](http://www.omg.org/spec/CMMN)",
    ),
    catalog,
    /orientation URL must use HTTPS/,
  );
});

test("the checker enforces ordered Stage, portfolio-root, and adapter contracts", () => {
  assertRejected(
    replaceRequired(
      core,
      "| `attract` | Attract & Discover |\n| `capture` | Capture Demand |",
      "| `capture` | Capture Demand |\n| `attract` | Attract & Discover |",
    ),
    catalog,
    /canonical Stage contract must be exactly ordered/,
  );
  assertRejected(
    replaceRequired(
      core,
      "| `products_and_services_sold` | Goods and Services for Sale |",
      "| `products_sold` | Goods and Services for Sale |",
    ),
    catalog,
    /canonical four-portfolio root keys must be exactly ordered/,
  );
  assertRejected(
    replaceRequired(
      core,
      "| `productsAndServicesSold` | `products_and_services_sold` |\n| `forEmployees` | `for_employees` |",
      "| `forEmployees` | `for_employees` |\n| `productsAndServicesSold` | `products_and_services_sold` |",
    ),
    catalog,
    /portfolio adapter contract must be exactly ordered/,
  );
});

test("the checker validates critical GFM delimiters and escaped pipes", () => {
  assertRejected(
    core,
    replaceRequired(
      catalog,
      "| Shared family | Reusable activity core | Common profile facets | Specialize or split when |\n|---|---|---|---|",
      "| Shared family | Reusable activity core | Common profile facets | Specialize or split when |\n|---|---|",
    ),
    /shared-family registry delimiter must contain 4 columns/,
  );
  assertRejected(
    replaceRequired(
      core,
      "| Canonical key | Default display label |\n|---|---|",
      "| Canonical key | Default display label |\n|---|",
    ),
    catalog,
    /Stage table delimiter must contain 2 columns/,
  );
  assertRejected(
    replaceRequired(
      core,
      "| ID | Owner / title and version | Canonical locator or reproducible resolver | Orientation scope |\n|---|---|---|---|",
      "| ID | Owner / title and version | Canonical locator or reproducible resolver | Orientation scope |\n|---|---|---|",
    ),
    catalog,
    /SourceCitation delimiter must contain 4 columns/,
  );
  assertRejected(
    replaceRequired(
      core,
      "| Profile | Required profiles | Minimum claimable depth | Requirement membership |\n|---|---|---:|---|",
      "| Profile | Required profiles | Minimum claimable depth | Requirement membership |\n|---|---|---|",
    ),
    catalog,
    /conformance-profile dependency table delimiter must contain 4 columns/,
  );
  assertRejected(
    replaceRequired(
      core,
      "| ID | Requirement | Minimum depth |\n|---|---|---|",
      "| ID | Requirement | Minimum depth |\n|---|---|",
    ),
    catalog,
    /requirement delimiter must contain 3 columns/,
  );
  assertRejected(
    core,
    replaceRequired(
      catalog,
      "| Required field | Value |\n|---|---|",
      "| Required field | Value |\n|---|",
    ),
    /specimen table delimiter must contain 2 columns/,
  );
  assertRejected(
    core,
    replaceMatched(
      catalog,
      /^\| Category \| `DM`[^\r\n]*\r?\n\|[-:|]+\|$/m,
      (block) => block.replace(/\r?\n[^\r\n]+$/, "\n|---|"),
    ),
    /category applicability matrix delimiter must contain 11 columns/,
  );
  assertRejected(
    core,
    replaceRequired(
      catalog,
      "| Category | Decisive activity | Authority ceiling or specialization anchor | Minimum category evidence |\n|---|---|---|---|",
      "| Category | Decisive activity | Authority ceiling or specialization anchor | Minimum category evidence |\n|---|---|---|",
    ),
    /activity-authority-evidence rationale delimiter must contain 4 columns/,
  );
  assertRejected(
    core,
    replaceRequired(
      catalog,
      "| State | Deterministic meaning |\n|---|---|",
      "| State | Deterministic meaning |\n|---|",
    ),
    /activity-applicability state table delimiter must contain 2 columns/,
  );
  assertRejected(
    core,
    replaceRequired(
      catalog,
      "| Leaf | Family | Category state | Leaf state | Semantic trigger and minimum evidence |\n|---|---|---|---|---|",
      "| Leaf | Family | Category state | Leaf state | Semantic trigger and minimum evidence |\n|---|---|---|---|",
    ),
    /leaf-deviation register delimiter must contain 5 columns/,
  );

  const escapedPipeCatalog = replaceRequired(
    catalog,
    "research demand, qualify inquiries",
    "research demand \\| qualify inquiries",
  );
  assert.deepEqual(
    analyzeFPAW(core, escapedPipeCatalog, currentInventory()).errors,
    [],
  );
});

test("the checker enforces exact and meaningful controlled-state definitions", () => {
  assertRejected(
    core,
    replaceMatched(catalog, /^\| `recommended` \|[^\r\n]+\|\r?$/m, () => ""),
    /activity-applicability state set must be exactly/,
  );
  assertRejected(
    core,
    replaceMatched(
      catalog,
      /^\| `profile-bound` \|[^\r\n]+\|$/m,
      () => "| `profile-bound` | <!-- hidden --> |",
    ),
    /profile-bound has an empty AI-realization definition/,
  );
});

test("the checker enforces exact Candidate deviation identities and states", () => {
  assertRejected(
    core,
    replaceMatched(
      catalog,
      /^\| `mobile-phlebotomy` \| `CW-SUPPLY`[^\r\n]+\|$/m,
      (line) => line.replace("`mobile-phlebotomy`", "`hair-salon`"),
    ),
    /Candidate 0\.1\.0 deviation identities must be exactly/,
  );
  assertRejected(
    core,
    replaceMatched(
      catalog,
      /^\| `optician` \| `CW-SUPPLY`[^\r\n]+\|$/m,
      (line) => line.replace("| `required` |", "| `specialized-profile-required` |"),
    ),
    /optician::CW-SUPPLY states must be recommended -> required/,
  );
});

test("the checker requires semantically non-empty requirement, deviation, and worked values", () => {
  assertRejected(
    replaceMatched(
      core,
      /^\| `FPAW-CORE-001` \|[^\r\n]+\| `R0` \|$/m,
      () => "| `FPAW-CORE-001` | <!-- hidden --> | `R0` |",
    ),
    catalog,
    /FPAW-CORE-001 has an empty requirement statement/,
  );
  assertRejected(
    core,
    replaceMatched(
      catalog,
      /^\| `mobile-phlebotomy` \| `CW-SUPPLY`[^\r\n]+\|$/m,
      () => "| `mobile-phlebotomy` | `CW-SUPPLY` | `recommended` | `specialized-profile-required` | <!-- hidden --> |",
    ),
    /mobile-phlebotomy::CW-SUPPLY has empty evidence/,
  );
  assertRejected(
    core,
    replaceMatched(
      catalog,
      /^\| purpose \/ applicability \|[^\r\n]+\|$/m,
      () => "| purpose / applicability | <!-- hidden --> |",
    ),
    /has empty purpose \/ applicability/,
  );
});

test("the checker requires shared deviation and worked-specimen metadata", () => {
  assertRejected(
    core,
    replaceMatched(
      catalog,
      /Every row inherits `profileVersion = 0\.1\.0`[\s\S]+?fields are part of each deviation record, not optional commentary\.\r?\n/,
      () => "",
    ),
    /shared deviation metadata contract is incomplete/,
  );
  assertRejected(
    core,
    replaceMatched(
      catalog,
      /For comparison, each specimen uses the same design metadata:[\s\S]+?profile fields or evidence of completeness\.\r?\n/,
      () => "",
    ),
    /shared worked-specimen metadata contract is incomplete/,
  );
});

test("worked specimens cannot claim a bound AI profile before one is published", () => {
  assertRejected(
    core,
    replaceMatched(
      catalog,
      /^\| allocation \/ AI realization \|[^\r\n]+\|$/m,
      (line) => line.replace("`implementation-gap`", "`profile-bound`"),
    ),
    /allocation must remain implementation-gap until a complete versioned profile is published/,
  );
});

test("a Gap cannot substitute for a mandatory profile anchor", () => {
  assertRejected(
    replaceRequired(
      core,
      "but it is not\nthe anchor and cannot make the scope non-empty.",
      "but it may act as\nthe anchor and make the scope non-empty.",
    ),
    catalog,
    /Gap cannot substitute for mandatory profile anchors/,
  );
  assertRejected(
    replaceMatched(
      core,
      /^\| `FPAW-Workforce-AI` \| one AI Performer[^\r\n]+\|\r?$/m,
      () => "",
    ),
    catalog,
    /mandatory-anchor profile set must be exactly/,
  );
});

test("execution media and physical field-group keys remain closed and non-empty", () => {
  assertRejected(
    replaceRequired(
      core,
      "declare a non-empty `executionMedia` set",
      "declare an optional `executionMedia` set",
    ),
    catalog,
    /executionMedia must be declared as a non-empty set/,
  );
  assertRejected(
    replaceRequired(
      core,
      "\n`hybrid` is a derived label only",
      "\n- `hybrid` — hides the underlying media\n\n`hybrid` is a derived label only",
    ),
    catalog,
    /executionMedia values must be exactly/,
  );
  assertRejected(
    replaceRequired(core, "| `PHY-SITE` |", "| `PHY-PLACE` |"),
    catalog,
    /physical field-group keys must be exactly ordered/,
  );
});

test("AI operating bindings retain their exact states, assignments, and evidence links", () => {
  assertRejected(
    replaceRequired(
      core,
      "`bindingState` uses exactly `candidate | approved | active | suspended | retired`",
      "`bindingState` uses exactly `candidate | approved | active | suspended | archived`",
    ),
    catalog,
    /AI binding states must be exactly/,
  );
  assertRejected(
    replaceMatched(
      core,
      /Every\r?\nAI-Performer WorkAssignment references exactly one active\r?\nAIProductOperatingBinding/,
      (clause) => clause.replace("references exactly one active", "may reference zero or one"),
    ),
    catalog,
    /AI binding assignment contract is incomplete/,
  );
  assertRejected(
    replaceRequired(
      core,
      "Every Evidence record that supports an AI\nWorkAssignment or an `operated` implementation-state claim references exactly one binding",
      "Every Evidence record that supports an AI\nWorkAssignment or an `operated` implementation-state claim may reference a binding",
    ),
    catalog,
    /AI binding evidence contract is incomplete/,
  );
  assertRejected(
    replaceRequired(
      core,
      "AIProductBindingCompatibility.disposition uses exactly `compatible | segregated | incompatible |\nundetermined`. It is a pairwise relation, not one scalar field on a binding.",
      "bindingCompatibility uses exactly `compatible | segregated | incompatible |\nundetermined`. It is one scalar field on a binding.",
    ),
    catalog,
    /pairwise AI binding compatibility contract is incomplete/,
  );
});

test("a closed Gap reopens for stale same-target evidence while changed identity creates a successor", () => {
  assertRejected(
    replaceMatched(
      core,
      /A `closed` Gap returns to `open` when its closure evidence\r?\nexpires or is invalidated while the target\/requirement version and scope identity are unchanged/,
      (clause) => clause.replace("returns to `open`", "remains `closed`"),
    ),
    catalog,
    /closed-Gap reopening contract is incomplete/,
  );
});
