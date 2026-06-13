---
title: Write Conventional Commits
pageKind: heuristic
status: published
abstract: Commit messages follow the Conventional Commits format so history is human- and machine-readable and maps directly onto Semantic Versioning increments.
professionCompetencyLevel: practitioner
sources:
  - conventional-commits/spec
---

## Heuristic

Write commit messages in the Conventional Commits 1.0.0 format:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

## Why

The convention adds human- and machine-readable meaning to history and is explicitly designed to align with [[professions/software-engineer/semantic-versioning]]:

- `feat:` introduces a feature — maps to a **MINOR** bump.
- `fix:` patches a bug — maps to a **PATCH** bump.
- A breaking change is flagged by a `!` after the type/scope or a `BREAKING CHANGE:` footer — maps to a **MAJOR** bump.

Because the mapping is mechanical, release tooling can derive the next version and changelog from the commit log without human bookkeeping.

## How To Apply

1. **Pick the type honestly.** `feat` and `fix` carry release meaning; do not label a feature as a fix.
2. **Flag breaking changes explicitly** with `!` or the footer — never let an incompatible change hide in a `feat`.
3. **Scope when it helps** readers locate the change; keep the description imperative and short.

## See Also

- [[professions/software-engineer/semantic-versioning]]
