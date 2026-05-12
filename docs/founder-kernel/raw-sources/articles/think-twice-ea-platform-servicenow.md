---
sourceType: article
title: Think Twice When Integrating your EA Platform with ServiceNow
authors:
  - Bodman, Mark
url: https://www.linkedin.com/pulse/think-twice-when-integrating-your-ea-platform-mark-bodman
license: Apache-2.0
abstract: |
  Mark's sharpest published opinion on platform consolidation. Argues that
  third-party EA tools integrated with ServiceNow almost always fail, naming
  the failure pattern: Independent → Honeymoon → Ugly Reckoning. Notable
  analogy: dedicated EA tools vs ServiceNow APM is "like making an argument
  that using a dedicated camera over the one built-into your phone is better."
  Conflict-of-interest note: Mark is a ServiceNow employee; his read on this
  is shaped by 18 years of watching the integration pattern fail across Dell,
  Troux, HPE, and ServiceNow.
---

## Why it's cited

Foundational source for the **don't integrate the EA platform — consolidate on one data model** stance and the **reuse the camera in your pocket** heuristic. Apache-2.0 because Mark authored it.

## Key claims

- EA-platform-to-CMDB integration progresses through Independent → Honeymoon → Ugly Reckoning.
- Scope creep, semantic mismatches, and chicken-vs-egg ownership compound until the integration is "unachievable as originally intended."
- Pick one platform; CSDM is the canonical data spine.
- Best-of-breed loses on practicality even when it wins on feature depth (the camera-in-your-pocket analogy).

## See also

- Stance: `[[stances/dont-integrate-ea-platform]]`
- Heuristic: `[[heuristics/reuse-the-camera-in-your-pocket]]`
- Entity: `[[entities/csdm]]`
