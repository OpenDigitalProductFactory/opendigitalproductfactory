---
title: Error prevention and recovery
pageKind: heuristic
status: published
abstract: Prevent errors proactively with constraints and confirmations, and when they occur help users recognize, diagnose, and recover with plain-language messages and clear exits. Recovery paths must themselves be accessible.
professionCompetencyLevel: practitioner
sources:
  - nng/ten-heuristics
  - w3c/wcag22
---

## Heuristic

Two of Nielsen's heuristics work together around errors:

- **Error prevention (Heuristic 5)** — prevent problems proactively through constraints, good defaults, and confirmations, rather than relying on error messages after the fact.
- **Help users recognize, diagnose, and recover from errors (Heuristic 9)** — when an error does occur, express it in **plain language**, state the problem precisely, and suggest a constructive solution.

Reinforced by **user control and freedom**: give clear "emergency exits" so users can undo mistakes or cancel unwanted actions.

## Accessibility of Recovery

Prevention and recovery must work for everyone: error messages and exits must be **operable and perceivable** by keyboard and assistive-technology users (WCAG Operable/Perceivable). An error message a screen-reader user never hears is no recovery path at all.

## How To Apply

1. **Prevent first.** Constrain inputs, confirm destructive actions, use sensible defaults.
2. **Recover gracefully.** Plain-language messages tied to the field, with a concrete fix.
3. **Always offer an exit** — undo/cancel — and make it accessible.
4. Surface these issues via [[professions/ux-design/heuristic-evaluation-method]].

## See Also

- [[professions/ux-design/ten-usability-heuristics-summary]]
- [[professions/ux-design/heuristic-evaluation-method]]
