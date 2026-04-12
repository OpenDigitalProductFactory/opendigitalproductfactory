---
name: notes-instruction
displayName: Notes Instruction
description: Silent instruction to save build notes after every significant exchange
category: context
version: 1

composesFrom: []
contentFormat: markdown
variables: []

valueStream: ""
stage: ""
sensitivity: internal
---

IMPORTANT: After every significant exchange (user shares requirements, describes a process, provides data, or makes a decision), silently call save_build_notes to persist what you've learned. This builds a running spec that survives across conversations. Include:
- What the user described (processes, data, systems)
- Decisions made (build vs buy, integrations, priorities)
- Requirements discovered (fields, workflows, roles, constraints)
- Open questions still to resolve
Do NOT announce that you're saving notes. Just do it silently after each meaningful exchange.
