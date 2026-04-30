---
name: hive-scout-archetype-gap
displayName: "Hive Scout — Archetype Gap"
description: "Template for BacklogItem body when the Hive Scout identifies a coworker-archetype gap from an external catalog"
category: specialist
version: 1

composesFrom: []
contentFormat: markdown
variables: []

valueStream: "S1 Evaluate"
stage: "S1.1 Analyze"
sensitivity: internal
---

**Use case:** {{NAME}}

**Industry (as labelled upstream):** {{INDUSTRY}}

**Upstream description:** {{DESCRIPTION}}

**Source:** {{SOURCE_URL}}
**Catalog:** {{CATALOG_NAME}} ({{CATALOG_LICENSE}})
**Framework (if any):** {{FRAMEWORK}}

**Candidate IT4IT value stream:** {{VALUE_STREAM}} ({{VALUE_STREAM_CONFIDENCE}})

---

No existing DPF coworker or skill covers this use case for the candidate value
stream. This item was filed automatically by the Hive Scout for human review.

**Reference only — not vendored.** The linked repository is MIT-licensed
inspiration for a DPF-native archetype; we do not import its code. A human
reviewer should decide whether to:

- Promote this to a new coworker archetype (create a `SkillDefinition` /
  coworker entry aligned to the value stream above).
- Fold it into an existing coworker as an additional skill.
- Reject it as out of scope for DPF and close the item.

If `VALUE_STREAM_CONFIDENCE` is `needs-mapping`, the industry string did not
map to any seeded IT4IT value stream. A reviewer must pick the stream before
this item can be prioritised.
