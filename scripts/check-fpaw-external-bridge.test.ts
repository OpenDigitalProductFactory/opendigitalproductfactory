import { strict as assert } from "node:assert";
import test from "node:test";
import { hasSemanticContent } from "./lib/fpaw-semantic-content";
import {
  assertRejected,
  catalog,
  core,
  replaceRequired,
} from "./lib/fpaw-standard-test-fixtures";

test("semantic-content detection follows visible Markdown text without trusting markup deletion", () => {
  const semanticallyEmpty = [
    "",
    " \t\r\n",
    "<!-- hidden -->",
    "<!-- <script>alert(1)</script> -->",
    "<!-- unclosed hidden text",
    "<span></span>",
    "<script>",
    "<script",
    "<<script>",
    "<https://>",
    "&nbsp; &#160; &#xA0;",
    "&#8203; &#x200B; &ZeroWidthSpace;",
    "😀 —",
    "[](https://example.com)",
    "[](https://example.com/a_(b)tail)",
    "![](diagram.svg)",
    "[<!-- hidden -->](https://example.com)",
    "[<!-- ] -->](https://example.com)",
    "[`]`](https://example.com)",
    "[][hidden-reference]",
    "![][hidden-reference]",
    "[<!-- hidden -->][hidden-reference]",
  ];
  for (const value of semanticallyEmpty) {
    assert.equal(hasSemanticContent(value), false, `expected markup-only content to be empty: ${value}`);
  }

  const semanticallyPresent = [
    "visible",
    "<!-- hidden --><span>visible</span>",
    "<https://example.com>",
    "[label](https://example.com)",
    "![diagram](diagram.svg)",
    "<span>42</span>",
    "<script>visible</script>",
    "`<script>`",
    "\\<script>",
    "[]](visible)",
    "Ångström ١٢٣",
  ];
  for (const value of semanticallyPresent) {
    assert.equal(hasSemanticContent(value), true, `expected visible content to be semantic: ${value}`);
  }
});

test("the checker rejects comments and non-rendered normative bridge sections", () => {
  assertRejected(`<!--\n${core}`, catalog, /core: HTML comments are not permitted/);
  assertRejected(
    replaceRequired(
      core,
      "### 11.5 Source-validated IT4IT 3.0.1 lifecycle bridge",
      "<!--\n### 11.5 Source-validated IT4IT 3.0.1 lifecycle bridge",
    ),
    catalog,
    /core: HTML comments are not permitted/,
  );
  assertRejected(
    replaceRequired(
      replaceRequired(
        core,
        "### 11.5 Source-validated IT4IT 3.0.1 lifecycle bridge",
        "<!--\n### 11.5 Source-validated IT4IT 3.0.1 lifecycle bridge",
      ),
      "### 11.6",
      "-->\n### 11.6",
    ),
    catalog,
    /core: HTML comments are not permitted/,
  );
  assertRejected(
    replaceRequired(
      replaceRequired(
        core,
        "### 11.5 Source-validated IT4IT 3.0.1 lifecycle bridge",
        "```markdown\n### 11.5 Source-validated IT4IT 3.0.1 lifecycle bridge",
      ),
      "### 11.6",
      "```\n### 11.6",
    ),
    catalog,
    /IT4IT lifecycle.*header is missing|IT4IT lifecycle.*IDs must be exactly ordered/,
  );

  const start = core.indexOf("### 11.5 Source-validated IT4IT 3.0.1 lifecycle bridge");
  const end = core.indexOf("### 11.6", start);
  assert.ok(start >= 0 && end > start);
  const indented = `${core.slice(0, start)}${core.slice(start, end)
    .split(/\r?\n/)
    .map((line) => `    ${line}`)
    .join("\n")}${core.slice(end)}`;
  assertRejected(
    indented,
    catalog,
    /IT4IT lifecycle.*header is missing|IT4IT lifecycle.*IDs must be exactly ordered/,
  );
});

test("semantic-content detection remains bounded for malformed Markdown labels", () => {
  const started = performance.now();
  assert.equal(hasSemanticContent("[".repeat(16_000)), false);
  assert.ok(performance.now() - started < 1_500, "malformed labels exceeded the bounded scan budget");
});

test("the IT4IT bridge preserves its exact source-validated streams and functional components", () => {
  assertRejected(
    replaceRequired(core, "`IT4IT-MAP-VS-OPERATE-001`", "`IT4IT-MAP-VS-FABRICATED-001`"),
    catalog,
    /IT4IT value-stream map IDs must be exactly ordered/,
  );
  assertRejected(
    replaceRequired(
      core,
      "Release Composition. Test: Test, Defect.",
      "Release Composition. Test: Test, Bug.",
    ),
    catalog,
    /IT4IT functional component set is incomplete/,
  );
  assertRejected(
    replaceRequired(core, "participationSpecified=false", "participationSpecified=true"),
    catalog,
    /IT4IT source relation\/cardinality tuples are not source-exact|IT4IT cardinality preservation contract is incomplete/,
  );
  assertRejected(
    replaceRequired(core, "Financial Management: Cost Modeling; Investment", "Fabricated Management"),
    catalog,
    /IT4IT supporting-function source names are not source-exact/,
  );
  assertRejected(
    replaceRequired(core, "Digital Product → Product Design, `1:n`", "Digital Product → Product Design, `n:m`"),
    catalog,
    /IT4IT source relation\/cardinality tuples are not source-exact/,
  );
  assertRejected(
    replaceRequired(
      core,
      "| `IT4IT-MAP-KDO-DIGITAL-PRODUCT-001` | Digital Product | Product Portfolio |",
      "| `IT4IT-MAP-KDO-DIGITAL-PRODUCT-001` | Digital Product | Fabricated Owner |",
    ),
    catalog,
    /IT4IT backbone KDO ownership tuples are not source-exact/,
  );
  assertRejected(
    replaceRequired(
      core,
      "| `IT4IT-MAP-FC-FULFILLMENT-ORCHESTRATION-001` | Request to Fulfill / Fulfill | Fulfillment Orchestration | Desired Product Instance |",
      "| `IT4IT-MAP-FC-FULFILLMENT-ORCHESTRATION-001` | Request to Fulfill / Fulfill | Fulfillment Orchestration | Fabricated Object |",
    ),
    catalog,
    /IT4IT functional-component\/KDO ownership registry is not source-exact/,
  );
  assertRejected(
    replaceRequired(
      core,
      "maps digital strategy/portfolio controls only; four FPAW portfolio roles remain the broader placement system",
      "[][hidden-reference]",
    ),
    catalog,
    /malformed IT4IT functional-group map row/,
  );
  assertRejected(
    replaceRequired(
      core,
      "maps digital strategy/portfolio controls only; four FPAW portfolio roles remain the broader placement system",
      "&#8203;",
    ),
    catalog,
    /malformed IT4IT functional-group map row/,
  );
  assertRejected(
    replaceRequired(core, "Detect Issue → Diagnose Issue → Resolve Issue", "Detect Issue → Resolve Issue"),
    catalog,
    /IT4IT lifecycle stage sequence|exactly 28 stages/,
  );
  assertRejected(
    replaceRequired(
      core,
      "exactly one BusinessProduct projection + `1..*` essential DigitalProduct realizations + `1..*` Offerings + economics + `0..*` contingent ConsumptionAgreements + `0..*` Desired/Actual instance lineage",
      "DigitalProduct",
    ),
    catalog,
    /IT4IT composite Digital Product mapping is incomplete/,
  );
});

test("the bridge prevents IT4IT Release, Product Release, and FPAW depth conflation", () => {
  assertRejected(
    replaceRequired(
      core,
      "IT4IT Release is the Service Offer lifecycle; it is not DigitalProductRelease authorization",
      "IT4IT Release authorizes DigitalProductRelease",
    ),
    catalog,
    /IT4IT Release\/Product Release separation is incomplete/,
  );
  assertRejected(
    replaceRequired(
      core,
      "The FPAW `R0`–`R5` resolution depths and IT4IT Levels 1–5 are orthogonal.",
      "The FPAW `R0`–`R5` resolution depths are equivalent to IT4IT Levels 1–5.",
    ),
    catalog,
    /FPAW and IT4IT level separation is incomplete/,
  );
  assertRejected(
    replaceRequired(
      core,
      "The Product Release-to-Service Offer seam is an explicit Release Blueprint relation.",
      "Product Release and Service Offer are one record.",
    ),
    catalog,
    /IT4IT Product Release Blueprint seam is incomplete/,
  );
  assertRejected(
    replaceRequired(
      core,
      "bounded private technical analysis and independently expressed structural/semantic mapping; `permitted-operator`",
      "bounded private technical analysis mentioning `permitted-operator`; `permitted-public`",
    ),
    catalog,
    /IT4IT bridge SourceUseDecision is incomplete/,
  );
});

test("the CSDM bridge preserves source-verified maps, verified gaps, and anti-collapse boundaries", () => {
  assertRejected(
    replaceRequired(core, "`CSDM-MAP-FEDERATION-001`", "`CSDM-MAP-FABRICATED-001`"),
    catalog,
    /CSDM map IDs must be exactly ordered/,
  );
  assertRejected(
    replaceRequired(
      core,
      "| `CSDM-MAP-IDENTITY-GAP-001` | AI Application/AI Function and mentions of AI Agent | deployed runtime projection only | none | `absent` |",
      "| `CSDM-MAP-IDENTITY-GAP-001` | AI Application/AI Function and mentions of AI Agent | AgentSubjectReference | exact | `present-verified` |",
    ),
    catalog,
    /CSDM map state\/relation contract is incomplete/,
  );
  assertRejected(
    replaceRequired(
      core,
      "AgentSubject, AIProductOperatingBinding, WorkAssignment, and Evidence **MUST** retain distinct",
      "AgentSubject, AIProductOperatingBinding, WorkAssignment, and Evidence **MAY** share one identity and",
    ),
    catalog,
    /CSDM anti-collapse contract is incomplete/,
  );
  assertRejected(
    replaceRequired(
      core,
      "DigitalProductInstance/ServiceInstance and typed runtime-component projections",
      "generic AI Agent",
    ),
    catalog,
    /CSDM runtime projection contract is incomplete/,
  );
  assertRejected(
    replaceRequired(
      core,
      "discovery may refresh observed runtime topology only; it must not synthesize Product, Release, package, GAID AgentSubject, work, agreement, or conformance truth",
      "discovery may synthesize Product, Release, package, GAID AgentSubject, work, agreement, and conformance truth",
    ),
    catalog,
    /CSDM discovery boundary is incomplete/,
  );
  assertRejected(
    replaceRequired(core, "GAID AgentSubjectReference remains authoritative", "the CSDM CI remains authoritative"),
    catalog,
    /CSDM identity-gap boundary is incomplete/,
  );
  assertRejected(
    replaceRequired(
      core,
      "no release/profile/AgentSubject/deployment temporal uniqueness, compatibility, or TAK-JSI qualification contract",
      "supplies the complete release/profile/AgentSubject/deployment temporal binding",
    ),
    catalog,
    /CSDM operating-binding gap is incomplete/,
  );
  assertRejected(
    replaceRequired(core, "| `CSDM-MAP-REL-CATALOG-001`", "| `CSDM-MAP-REL-FABRICATED-001`"),
    catalog,
    /CSDM relation map IDs must be exactly ordered/,
  );
  assertRejected(
    replaceRequired(
      core,
      "Business/Technology Management Service has `1..*` Service Offerings; Offering derives from one parent service",
      "Business/Technology Management Service has `0..1` Service Offering",
    ),
    catalog,
    /CSDM\/AICT source relation and cardinality tuples are not source-exact/,
  );
  assertRejected(
    replaceRequired(
      core,
      "AI Digital Asset → Package (Artifact) → repeated operational deployment/CI, `1:m:n`",
      "AI Digital Asset → operational CI, `1:1`",
    ),
    catalog,
    /CSDM\/AICT source relation and cardinality tuples are not source-exact/,
  );
  assertRejected(
    replaceRequired(
      core,
      "bounded private technical analysis and independently expressed semantic/implementation mapping; `permitted-operator`",
      "bounded private technical analysis mentioning `permitted-operator`; `permitted-public`",
    ),
    catalog,
    /CSDM bridge SourceUseDecision is incomplete/,
  );
});

test("mapping envelopes and state axes remain complete and independent", () => {
  assertRejected(
    replaceRequired(core, "| confidence | `high` for the source identifier", "| fabricated confidence | `high` for the source identifier"),
    catalog,
    /IT4IT common mapping envelope fields are incomplete or out of order/,
  );
  let relocatedUri = replaceRequired(
    core,
    "The Open Group; *IT4IT Standard, Version 3.0.1*; publication `C24A`",
    "The Open Group; *IT4IT Standard, Version 3.0.1*; publication `C24A`; <https://publications.opengroup.org/c24a>",
  );
  relocatedUri = replaceRequired(
    relocatedUri,
    "<https://publications.opengroup.org/c24a>; source-reviewed 2026-08-01",
    "fabricated resolver; source-reviewed 2026-08-01",
  );
  assertRejected(
    relocatedUri,
    catalog,
    /IT4IT common mapping envelope field canonical URI \/ access date is incomplete/,
  );
  assertRejected(
    replaceRequired(
      core,
      "The identical tokens\ndo not make the axes interchangeable",
      "The identical tokens\nmake the axes interchangeable",
    ),
    catalog,
    /StandardMapState, implementation BindingState, and AI operating-binding state are not independently defined/,
  );
});
