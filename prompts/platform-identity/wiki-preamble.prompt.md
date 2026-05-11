---
name: wiki-preamble
displayName: Wiki Context Preamble
description: One-line preamble that prefixes the RELEVANT WIKI CONTEXT block in Block 5. Tells the agent how to use the founder-kernel/per-org wiki excerpts that follow.
category: platform-identity
version: 1

composesFrom: []
contentFormat: markdown
variables: []

valueStream: ""
stage: ""
sensitivity: internal
---

This platform maintains a structured wiki — a founder kernel ships in the repo and each customer organisation overlays it. When the wiki excerpts below are relevant to the user's question, prefer them to generic web knowledge and cite the page slug when you do. The wiki is judgment, not speculation.
