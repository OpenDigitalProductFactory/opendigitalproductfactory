---
status: active
---

# Typed relation vocabulary: no generic edge types (EP-5F6369AB)

Design for epic EP-5F6369AB. The anchor item is BI-85389A35 (registry and
guard). The successors are BI-28C22BE3, BI-E487F6D9, BI-52280538, BI-92804832
and BI-8007E50D. Each successor carries its own `## Acceptance` in its backlog
body. This file holds the objectives and acceptance for BI-85389A35 only,
because the baseline manifest reads every OBJ/AC row in a file.

## 1. Problem

DPF stores relations in several places. None of them has a governed type
vocabulary:

- `graph_edge.rel_type` is free `text`. `upsertGraphEdge` takes `relType: string`
  (`packages/db/src/graph-sync.ts:70`).
- `EaRelationshipType` is seeded per notation. Its generic `associated_with`
  type bypasses every relationship rule (`packages/db/src/ea-validation.ts:25`).
- Tables such as `InventoryRelationship`, `DiscoveredRelationship`,
  `ProductDependency` and `DocumentReference` each hold relation names as
  their own strings, in their own casing.

A generic label such as "associated with" or "relates to" says that two things
are connected but not how. At scale it tells an analyst, human or AI, almost
nothing. An analysis cannot tell a foreign key from a governance obligation,
or a dependency from a mention. The founder asked for generic relation terms
to be banned and replaced with a typed schema.

## 2. Evidence: the live inventory

Dev install `dpf`, 2026-10-27, `origin/main` b57f87e598b.

### 2.1 `graph_edge` (84,258 edges, 20 types)

| `rel_type` | Count | Source → target labels | Writer | Verdict |
|---|---:|---|---|---|
| DEFINES | 28,225 | CodeFile → CodeSymbol | code-graph | typed |
| IMPORTS | 23,206 | CodeFile → CodeFile / ExternalModule | code-graph | typed |
| HAS_FIELD | 11,793 | PrismaModel → PrismaField | code-graph | typed |
| TESTED_BY | 9,124 | CodeFile → TestFile | code-graph | typed |
| BELONGS_TO | 2,172 | InfraCI / DigitalProduct → Portfolio | graph-sync | typed by range |
| **ASSOCIATED_WITH** | **2,123** | EaElement(data_object) → EaElement(data_object) | EA data-model mirror | **generic** |
| DEPENDS_ON | 1,411 | DigitalProduct → InfraCI (1,410), InfraCI → InfraCI (1) | graph-sync | typed |
| **RELATES_TO** | **1,205** | PrismaModel → PrismaModel | code-graph prisma extractor | **generic** |
| IMPACTS | 1,031 | CodeFile / DocImpactSource / CodeRoute → DocPage | doc-impact graph | typed |
| IMPLEMENTS_ROUTE | 703 | CodeFile → CodeRoute | code-graph | typed |
| CATEGORIZED_AS | 693 | DigitalProduct → TaxonomyNode | graph-sync | typed |
| MEMBER_OF | 670 | InfraCI → InfraCI | inventory | typed |
| LINKS_TO | 657 | Wiki page → Wiki page (all kinds) | wiki link sync | navigational, untyped |
| CHILD_OF | 484 | TaxonomyNode → TaxonomyNode / Portfolio | graph-sync | typed |
| HOSTS | 426 | InfraCI → InfraCI | inventory | typed, direction suspect (§4.4) |
| RUNS_ON | 226 | InfraCI → InfraCI | inventory | typed, direction suspect (§4.4) |
| CONNECTS_TO | 69 | InfraCI → InfraCI | inventory | typed |
| MONITORS | 30 | InfraCI → InfraCI | inventory | typed |
| ROUTES_THROUGH | 6 | InfraCI → InfraCI | inventory | typed |
| DOC_REFERENCES | 4 | Document → Document | graph-sync | **generic unless `refType` set** |

The two generic types hold **3,328 edges**. That is 3.9% of all edges and
**27.9%** of the 11,910 edges outside the four bulk code-structure types.

Both generic types project the **same Prisma relations**, and each one stores
both ends of every relation:

- `RELATES_TO`: 591 one-to-many, 549 many-to-one, 65 one-to-one.
- `associated_with`: 1,005 many-to-one, 1,004 one-to-many, 109 one-to-one.
  Four rows are flagged `mirrorRemoved=true` but are still present.

The meaning is already in the edge props (`fieldName`, `fkFields`,
`references`, `cardinality`). Only the type is generic, so retyping loses
nothing.

Types that are declared in source but have no live rows: `REFERENCES`,
`EXPOSES_TOOL`, `USES_MODEL` and `USES_PROMPT` in `CodeGraphEdgeKind`
(`apps/web/lib/build/code-graph/types.ts`), plus `OVERRIDES` and
`EA_REPRESENTS` in `graph-sync.ts`. The planned knowledge-linking `REFERENCES`
edge (BI-A63A9476) is also not written yet.

### 2.2 `EaRelationship` (10,685 rows)

| Slug | Notation | Rows | Note |
|---|---|---:|---|
| contains | sysml2 | 4,423 | typed |
| traces | sysml2 | 2,459 | 1,893 carry `crossLayer: true`; SysML trace is its weakest dependency (§4.2) |
| **associated_with** | archimate4 | **2,123 (19.9%)** | all are data-model mirror FKs |
| connects | sysml2 | 1,448 | typed |
| satisfies, verifies, refines, realizes, flows | mixed | 172 | typed |

`associated_with` appears in about 20 archimate4 metamodel rules
(`seed-ea-archimate4.ts:136–215`), in three conformance rules that **require**
it (lines 285–304), and in six viewpoints (`seed-ea-viewpoints.ts`). No live row
uses those rules yet, so retyping them is a seed-only change.

Degrading code paths:

- `UNIVERSAL_REL_TYPE_SLUGS` (`ea-validation.ts:25`) accepts `associated_with`
  between any two elements.
- The ArchiMate importer maps `SpecializationRelationship` to `associated_with`.
  It maps `AggregationRelationship` to `composed_of`, but aggregation is not
  composition. It falls back to `associated_with` for any unknown type
  (`apps/web/lib/ea/archimate-xml.ts:49–59, 146`).
- `apps/web/lib/actions/ea.ts:899` falls back to `associated_with` when no rule
  matches.
- archimate4 has no `aggregates` or `specializes` slug.

### 2.3 Other relation stores

| Store | Values (count) | Issue |
|---|---|---|
| `InventoryRelationship.relationshipType` | MEMBER_OF 670, hosts 393, RUNS_ON 226, CONNECTS_TO 69, HOSTS 33, monitors 30, ROUTES_THROUGH 6, UPLINKS_TO 1 | casing split |
| `DiscoveredRelationship.relationshipType` | HOSTS 50,236, MEMBER_OF 17,551, hosts 11,622, ROUTES_THROUGH 2,668, … | casing split |
| `ProductDependency.relationType` | depends_on 45, part_of 9 | never projected to `graph_edge` |
| `DocumentReference.refType` | source-artifact 4, provided-rendered-input 4, capture-context 4, canonical-source 4, **source 2** | `source` is unqualified; the graph collapses all five into `DOC_REFERENCES` |
| `TaskNodeEdge.edgeType` (enum) | informs 9,208 | typed; maps to PROV-O `wasInformedBy` |
| `WorkroomRelation.relation` (enum) | contains, spawned_from, depends_on, blocks, contributes_to | typed; the model to follow |
| `WikiPageLink` | 657 rows, no type column | navigational (§4.1) |
| `AuthorityBindingSubject.relation` | allowed 68, coordinates 12 | typed |

`WorkroomRelationKind` (BI-662254C6) is the house precedent. Its comment says
the five kinds "are different facts". This design applies that rule to every
graph.

### 2.4 Doctrine and backlog checked

- `wiki_query` finds no page on relation vocabulary. Two neighbouring pages
  apply: `professions/enterprise-architecture/name-and-type-the-contract-canonically`
  (a categorical value gets an enumerated type) and
  `professions/enterprise-architecture/minimal-proven-associations`.
  `graph_edge.rel_type` breaks obligation 1 of the first page.
- No backlog item or epic covers relation-type governance (text search of
  `BacklogItem` and `Epic`, 2026-10-27). BI-86EF5900 (done) added code-graph
  structure and is the reason `RELATES_TO` exists.
- WWMD `principle_decide`, interaction DI-415EC6EDD266, profile
  `mark-dpf-platform`, platform-development scope. Result: kernel commandment
  12.42, core principle 11.15, extending the EA profession principle 8.08,
  guard only 4.33. Verdict proceed, confidence high, margin 1.27, no
  commandment conflict.

## 3. Doctrine: a kernel commandment

Publish `principles/relations-are-typed-never-generic` at commandment tier
(BI-8007E50D):

> Every relation recorded in a DPF graph names what it means. It has a type from
> the governed registry, with a defined meaning, a direction, allowed source
> and target kinds, and an inverse label. A catch-all ("associated with",
> "related to", "linked to", an unqualified "references") is refused. Where a
> standard notation forces a weak relation, the edge carries a required
> qualifier that states the specific meaning.

The page cites ArchiMate 3.2 chapter 5 (relationships), W3C SKOS, W3C PROV-O
and schema.org. It extends the two EA profession principles in §2.4. It does
not replace them.

## 4. The vocabulary

### 4.1 Edge classes

Every registry entry has a **class**. Analyses filter on class, so a navigation
link is never read as a semantic fact.

| Class | Meaning | Default in analysis |
|---|---|---|
| `semantic` | a domain fact (depends on, complies with, is part of) | included |
| `structural` | a fact about code or data shape (defines, imports, foreign key) | included in code and data views |
| `navigational` | an authored hyperlink with no claim beyond "see this" | excluded unless asked for |
| `provenance` | where something came from (PROV-O) | included in lineage views |

`LINKS_TO` (a wiki `[[slug]]`) stays, as class `navigational`. Per RFC 8288
web linking, an untyped hyperlink is a legitimate fact. The defect is reading
it as a semantic relation, and the class tag prevents that.

### 4.2 Registry entries

Direction is always source → target. "Inverse" is the label read target →
source; it is a label, not a second stored edge.

**Portfolio, product and taxonomy**

| Key | Label / inverse | Source → target | Class | Standard mapping |
|---|---|---|---|---|
| BELONGS_TO | is in portfolio / contains | DigitalProduct, InfraCI → Portfolio | semantic | ArchiMate aggregation (inverse) |
| CATEGORIZED_AS | is categorized as / categorizes | DigitalProduct → TaxonomyNode | semantic | schema.org `category`; SKOS concept membership |
| CHILD_OF | has broader / has narrower | TaxonomyNode → TaxonomyNode, Portfolio | semantic | SKOS `broader` |
| DEPENDS_ON | depends on / is depended on by | DigitalProduct, InfraCI → InfraCI, DigitalProduct | semantic | ArchiMate serving (inverse); `role` prop required |
| PART_OF (new) | is part of / has part | DigitalProduct → DigitalProduct | semantic | schema.org `isPartOf`; ArchiMate aggregation |

**Infrastructure** (CSDM terms, ArchiMate technology layer)

| Key | Label / inverse | Source → target | Class | Standard mapping |
|---|---|---|---|---|
| HOSTS | hosts / is hosted on | InfraCI(host kinds) → InfraCI(hosted kinds) | semantic | ArchiMate assignment (node → system software) |
| RUNS_ON | runs on / runs | InfraCI(workload) → InfraCI(platform) | semantic | ArchiMate assignment (inverse) |
| MEMBER_OF | is member of / has member | InfraCI → InfraCI(cluster, segment) | semantic | ArchiMate aggregation (inverse) |
| CONNECTS_TO | connects to / connects to (symmetric) | InfraCI → InfraCI | semantic | ArchiMate communication network path |
| MONITORS | monitors / is monitored by | InfraCI(monitoring) → InfraCI | semantic | ArchiMate serving |
| ROUTES_THROUGH | routes through / carries route of | InfraCI → InfraCI | semantic | ArchiMate realization of a path |
| UPLINKS_TO | uplinks to / is uplink of | InfraCI → InfraCI | semantic | ArchiMate communication network |

The registry names the allowed `ciType` values on each side. That turns the
direction problem in §4.4 into a write-time refusal.

**Code and data structure**

| Key | Label / inverse | Source → target | Class |
|---|---|---|---|
| DEFINES | defines / is defined in | CodeFile → CodeSymbol | structural |
| IMPORTS | imports / is imported by | CodeFile → CodeFile, ExternalModule | structural |
| HAS_FIELD | has field / is field of | PrismaModel → PrismaField | structural |
| TESTED_BY | is tested by / tests | CodeFile → TestFile | structural |
| IMPLEMENTS_ROUTE | implements route / is implemented by | CodeFile → CodeRoute | structural |
| EXPOSES_TOOL, USES_MODEL, USES_PROMPT | as named | per `CodeGraphEdgeKind` | structural |
| **HAS_FOREIGN_KEY_TO** (replaces RELATES_TO) | has foreign key to / is foreign-key target of | PrismaModel → PrismaModel | structural |
| **USES_SYMBOL** (replaces code-graph REFERENCES) | uses symbol / is used by | CodeFile → CodeSymbol | structural |

`HAS_FOREIGN_KEY_TO` maps to SQL `FOREIGN KEY … REFERENCES`. It is written once,
from the side that holds the key. Required props: `fkFields`, `references`,
`cardinality`, `onDelete`, `fieldName`.

**Documents, knowledge and provenance**

| Key | Label / inverse | Source → target | Class | Standard mapping |
|---|---|---|---|---|
| IMPACTS | can make stale / is made stale by | CodeFile, CodeRoute, DocImpactSource → DocPage | semantic | ArchiMate influence |
| LINKS_TO | links to / is linked from | Wiki page → Wiki page | navigational | RFC 8288 link |
| OVERRIDES | overrides in org / is overridden by | overlay wiki page → kernel wiki page | provenance | PROV-O `wasRevisionOf` (org-scoped) |
| **MENTIONS** (proposed name for knowledge-linking REFERENCES) | mentions / is mentioned in | any body → any entity | navigational | schema.org `mentions` |
| WAS_DERIVED_FROM | was derived from / derived | Document → Document | provenance | PROV-O `wasDerivedFrom` |
| HAD_PRIMARY_SOURCE | had primary source / is primary source of | Document → Document | provenance | PROV-O `hadPrimarySource` |
| USED | used as input / was input to | Document → Document | provenance | PROV-O `used` |
| WAS_INFORMED_BY | was informed by / informed | Document, TaskNode → Document, TaskNode | provenance | PROV-O `wasInformedBy` |
| EA_REPRESENTS | models / is modelled by | EaElement → DigitalProduct, Portfolio, TaxonomyNode | semantic | ArchiMate realization (model → instance) |

`DOC_REFERENCES` is retired. The `DocumentReference.refType` values map to the
four PROV-O keys: `canonical-source` → HAD_PRIMARY_SOURCE, `source-artifact` →
WAS_DERIVED_FROM, `provided-rendered-input` → USED, `capture-context` →
WAS_INFORMED_BY. The unqualified `source` must resolve to one of them.

**EA notations.** The EA graph projects each `EaRelationshipType.neoType`, so
the registry includes every ArchiMate 3.2 relationship:

- structural: composition, aggregation, assignment, realization;
- dependency: serving, access, influence, association;
- dynamic: triggering, flow;
- other: specialization.

It also includes the BPMN 2.0 and SysML v2 types already seeded. The
archimate4 notation gains `aggregates` and `specializes` (BI-E487F6D9).
ArchiMate calls association its weakest relationship, but it allows a
directed, named association. DPF keeps it only in that form, quarantined
(§4.3).

The metamodel rules that use `associated_with` today are retyped as follows
(BI-52280538):

| From → to | Today | Typed |
|---|---|---|
| digital_product → ea_control | associated_with | `complies_with` / inverse `governs` (ArchiMate realization of a Constraint) |
| information_object → ea_control | associated_with | `complies_with` |
| ea_control → event_evidence | associated_with | `evidenced_by` / inverse PROV-O `wasGeneratedBy` |
| event_evidence → business_actor, ai_coworker | associated_with | PROV-O `wasAttributedTo` |
| ai_coworker → digital_product | associated_with | ArchiMate `serves` |
| business_actor → ai_coworker | associated_with | ArchiMate `assigned_to` (accountable for) |
| ai_coworker → ea_control, event_evidence | associated_with | `complies_with`; PROV-O `wasAttributedTo` (inverse) |
| stakeholder → driver | associated_with | ArchiMate `influences` (with sign) |
| work_package → goal / deliverable | associated_with | ArchiMate `realizes` |
| plateau, value_stream, application_component → business_capability | associated_with | ArchiMate `realizes` / `serves` |
| gap → plateau | associated_with | ArchiMate association, qualifier `role=gap-of` (ArchiMate itself defines gap–plateau this way) |
| service_offering → contract | associated_with | ArchiMate aggregation (an offering aggregates its contract) |
| data_object → data_object | associated_with | `composed_of` or qualified association (§4.3) |

The 1,893 SysML `traces` edges marked `crossLayer`, written by
`apps/web/lib/ea/ai-routing-architecture-extract.ts:368`, are quarantined in
the same way. Each one needs a `traceKind` qualifier
(`allocates | refines | implements`), or it is retyped to the matching SysML
v2 relationship (`allocate`, `refine`). This is in BI-52280538's scope.

### 4.3 Quarantine: weak relations that must carry a qualifier

Two weak relations stay because a standard notation requires them:

- ArchiMate association;
- SysML trace.

Each is **quarantined**. The registry entry sets
`quarantine: { requiredQualifier: "role" | "traceKind" }`. The writer refuses
the edge when the qualifier is missing or empty. The qualifier is free text
only for `role`, which carries a domain-specific name such as a Prisma
`fieldName`. `traceKind` is a closed enum.

Under this rule, the data-model mirror (BI-28C22BE3) writes:

- `composed_of` for a required foreign key with `onDelete: Cascade`, because
  the child cannot outlive its parent (ArchiMate composition);
- for every other foreign key, an association with `role=<fieldName>`,
  directed from the side that holds the key.

### 4.4 Banned terms

The guard refuses these names for a new relation type, case-insensitively:
`associated(_with)?`, `association` (outside the quarantined ArchiMate and BPMN
types), `relates?(_to)?`, `related(_to)?`, `linked(_to)?`, `link`,
`connected(_to)?` (`CONNECTS_TO` is allowed because its range is fixed),
`references` and `refers_to` without a qualifier, `misc`, `other`, `generic`,
`has` and `is` used alone.

In `HOSTS` and `RUNS_ON` the direction is suspect:

- 382 `HOSTS` edges run service → container;
- 226 `RUNS_ON` edges run server → docker_host.

The registry's `ciType` domain and range would refuse both. BI-92804832
verifies them against the discovery source, then corrects the projection.

## 5. Registry shape (BI-85389A35)

`packages/db/src/relation-vocabulary.ts` is the single source:

```ts
export type RelationClass = "semantic" | "structural" | "navigational" | "provenance";

export type RelationTypeDef = {
  key: string;               // UPPER_SNAKE, unique
  label: string;             // "depends on"
  inverseLabel: string;      // "is depended on by"
  meaning: string;           // one sentence, testable
  relationClass: RelationClass;
  symmetric?: boolean;
  domain: readonly string[]; // allowed graph_node labels (or ciType refinements)
  range: readonly string[];
  standard?: { vocabulary: "archimate-3.2" | "skos" | "prov-o" | "schema.org" | "sysml-v2" | "bpmn-2.0" | "sql"; term: string };
  requiredProps?: readonly string[];
  quarantine?: { requiredQualifier: string; allowed?: readonly string[] };
  retired?: { replacedBy: string };   // RELATES_TO, ASSOCIATED_WITH, DOC_REFERENCES
};

export const RELATION_TYPES = [ /* §4.2 */ ] as const satisfies readonly RelationTypeDef[];
export type RelationType = (typeof RELATION_TYPES)[number]["key"];
```

- `upsertGraphEdge(src, dst, relType: RelationType, props)` checks the registry
  at run time. It refuses a retired type, a type that is not registered, a
  missing required prop and a missing quarantine qualifier. Endpoint labels are
  checked only where the caller supplies them, so the hot code-graph path
  costs nothing extra.
- `graph_relation_type(key PK, relation_class, label, inverse_label)` is seeded
  from the registry. The foreign key from `graph_edge.rel_type` is added
  `NOT VALID`, then validated once the retype items have cleared the retired
  types. This additive migration follows
  `professions/enterprise-architecture/evolve-schema-additively`.
- `EaRelationshipType` keeps its own table: the EA notations are already
  governed rows. The guard checks that every seeded slug's `neoType` is a
  registry key.
- `explorer-vocabulary.ts` builds `REL_TYPE_LABELS` from the registry. This
  removes the drift (`CLASSIFIED_AS` / `PARENT_OF` labels that nothing writes,
  and missing labels for IMPACTS, LINKS_TO, OVERRIDES and EA_REPRESENTS).

**Delivered (BI-85389A35).** The registry is split in two:
`relation-vocabulary.ts` holds the shape and the checks, and
`relation-vocabulary-entries.ts` holds 66 entries. The source scan is in
`relation-vocabulary-guard.ts`, and the lookup is created by migration
`20261028060000_graph_relation_type`.

Two details differ from the sketch above:

- A third status, `deprecated`, keeps a legacy type writable until its owning
  item retypes the writer. `retired` is refused.
- Rows are added by migration, not by seed. `relation-vocabulary.test.ts`
  checks that the migrations cover every registry key.

The one-model raise of `prismaModelCount` is owed back by BI-7F47B63C.

## 6. Enforcement

| Layer | Mechanism | Catches |
|---|---|---|
| Type system | `RelationType` union on `upsertGraphEdge` and `CodeGraphEdgeKind` | a literal not in the registry, at compile time |
| Runtime | registry check in `upsertGraphEdge` | dynamic types (EA `neoType`, inventory `relationshipType`), missing qualifiers |
| Database | `graph_edge.rel_type` FK to `graph_relation_type` | any writer that bypasses `upsertGraphEdge` (raw SQL, scripts) |
| CI | `relation-vocabulary` guard in pregate preflight | a new type or EA slug that is not registered, or a banned name in the registry, in seeds or in `*RelationKind` enums |
| Doctrine | commandment §3 via `wiki_query` / `principle_decide` | design-time proposals |

The guard uses the existing ratchet pattern. It fails on new violations and
reports the known retired types until the backfill items remove them.

## 7. Migration and backfill

1. **BI-85389A35**: add the registry, the runtime check and the guard, with
   the retired types allowed as listed debt. Add the FK `NOT VALID`.
2. **BI-E487F6D9**: fix the EA validator and the importer, and add
   `aggregates` and `specializes`.
3. **BI-52280538**: retype the seed rules, conformance rules and viewpoints.
   Quarantine the SysML cross-layer traces.
4. **BI-28C22BE3**: backfill the Prisma relations. Delete the `RELATES_TO` and
   mirror `associated_with` rows and rewrite them from the FK side. The
   backfill is idempotent and has a dry-run. Its expected deltas:
   −1,205 RELATES_TO, −2,123 ASSOCIATED_WITH, and about +1,160 typed edges per
   graph.
5. **BI-92804832**: normalize casing, correct directions, project the product
   dependencies and map the PROV-O document references.
6. Validate the FK and drop the debt list from the guard.
7. **BI-8007E50D**: publish the commandment. It can land at any point. It is
   independent of steps 1–6.

Projections are rebuilt from their relational sources, so every graph-side
backfill is a re-projection, not a hand edit. No data outside `graph_edge` is
lost: each relational source keeps its row, and only the type it projects as
changes.

## 8. Coordination with EP-0237A305 (knowledge linking)

The knowledge-linking design (§3.3) plans a `REFERENCES` edge for "an entity id
in any body". Under this vocabulary, that edge is schema.org `mentions`. This
design proposes the key `MENTIONS` with class `navigational` and inverse "is
mentioned in", so that "Referenced by" panels keep their UI wording while the
stored type says what it is. No `REFERENCES` row exists yet, so renaming it
costs nothing now and grows more expensive after BI-A63A9476 ships. The owner
of BI-A63A9476 decides. If `REFERENCES` is kept, it must be registered with
the same class and meaning.

## 9. Non-goals

- Typing each wiki `[[link]]` (for example `[[supersedes::slug]]`) is out of
  scope. `LINKS_TO` stays navigational.
- Relational FK names in Prisma are out of scope. The schema already types
  them.
- Changing `TaskNodeEdgeType`, `WorkroomRelationKind` or
  `AuthorityBindingSubject.relation` is out of scope. They are typed already;
  they are only registered.

## 10. Objectives and acceptance (BI-85389A35)

**OBJ-TRV-1:** Every relation type written to `graph_edge` comes from one
governed registry that gives its meaning, direction, domain and range, inverse
label and class.

**OBJ-TRV-2:** A generic or unregistered relation type cannot enter the
platform through code, seed or raw SQL without a check failing.

| Acceptance | Objectives | Statement |
|------------|------------|-----------|
| AC-TRV-1 | OBJ-TRV-1 | `relation-vocabulary.ts` registers all 20 live `graph_edge` types and the declared-but-unused types listed in §2.1. Each entry has a label, inverse label, meaning, class, domain and range. A unit test asserts that every key matches `^[A-Z][A-Z0-9_]*$` and is unique. |
| AC-TRV-2 | OBJ-TRV-2 | `upsertGraphEdge` refuses an unregistered type, a retired type and a quarantined type without its qualifier. Unit tests cover each case. |
| AC-TRV-3 | OBJ-TRV-2 | The `relation-vocabulary` guard fails a fixture that adds `RELATED_TO` to a seed or registry, and passes on the current tree with the retired types listed as debt. |
| AC-TRV-4 | OBJ-TRV-2 | A migration adds `graph_relation_type`, seeded from the registry, and a `NOT VALID` FK from `graph_edge.rel_type`. It applies cleanly on the dev install. |
| AC-TRV-5 | OBJ-TRV-1 | The graph explorer's relationship labels come from the registry. Every live `rel_type` shows its registry label, and no label exists for a type the registry lacks. |
