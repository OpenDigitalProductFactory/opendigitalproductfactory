---
name: version-discovery
description: "Discover which products are missing version numbers and surface what version data exists"
category: inventory
assignTo: ["inventory-specialist"]
capability: "view_inventory"
taskType: "analysis"
triggerPattern: "version|version number|missing version|real version|discovery|version history"
userInvocable: true
agentInvocable: true
allowedTools: [query_version_history]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Product Version Discovery

Which products have version history and which are missing version data?

## Steps

1. Use PAGE DATA to get the list of all digital products.
2. For each product (or a sample if the list is large), use `query_version_history` to retrieve recorded versions.
3. Classify each product:
   - **Has versions** — show the latest version tag and ship date
   - **No versions recorded** — flag as needing attention
4. Present a summary table:
   - Product name | Lifecycle stage | Latest version | Last shipped | Status
5. Highlight products in `production` or `build` stage with no version history — these are the most critical gaps.
6. Recommend next steps: which products need version tracking set up, and how.

## Guidelines

- Focus on products in `production` and `build` stages first — concept/plan stage products rarely have versions.
- If a product has versions but no recent shipping activity, flag it as potentially stale.
- Do not invent version numbers — only report what `query_version_history` returns.
- End with a clear count: "X of Y products have version history. Z need attention."
