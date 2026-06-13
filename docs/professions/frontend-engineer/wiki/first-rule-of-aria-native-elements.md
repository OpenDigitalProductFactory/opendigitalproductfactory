---
title: First rule of ARIA — prefer native elements
pageKind: principle
status: published
abstract: If a native HTML element provides the semantics and behavior you need, use it instead of re-purposing an element with an ARIA role. No ARIA is better than bad ARIA; a role is a promise to implement its interactions.
principleTier: core
principleDirection: Don't add an ARIA role where a native element exists; if you do adopt a role, implement all its required keyboard interactions.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"governance_compliance": 0.8, "long_term_maintainability": 0.6}
professionCompetencyLevel: practitioner
sources:
  - w3c/using-aria
  - w3c/aria-apg
---

## Rule

**First Rule of ARIA:** if a native HTML element with the semantics and behavior you need already exists, use it instead of re-purposing a generic element and adding an ARIA role. ARIA is for the gaps native HTML cannot express, not a default.

## Why

The W3C is blunt: **"No ARIA is better than Bad ARIA."** ARIA changes how assistive technology perceives an element but adds **no behavior** — so when you assign a role, **"a role is a promise"**: you have committed to implementing all of that role's expected keyboard interactions, states, and focus management yourself. A `role="button"` on a `<div>` that doesn't handle Enter/Space and focus is worse than useless — it lies to the screen reader.

## How To Apply

1. **Default to native** per [[professions/frontend-engineer/semantic-html-first]].
2. **Only add ARIA for genuine gaps** (e.g. a custom widget with no native equivalent).
3. **Keep the promise.** Adopting a role obligates the full keyboard contract — see [[professions/frontend-engineer/keyboard-navigation-focus-management]].
4. **Don't clobber needed semantics.** Don't override an element's native role when you still rely on it.
5. **Test with assistive tech** before shipping ARIA.

## See Also

- [[professions/frontend-engineer/semantic-html-first]]
- [[professions/frontend-engineer/keyboard-navigation-focus-management]]
