---
title: Use semantic HTML first
pageKind: principle
status: published
abstract: Choose HTML elements for their meaning, not their appearance. Native semantic elements carry built-in behavior and accessibility that assistive technology understands for free — reach for them before generic divs and ARIA.
principleTier: commandment
principleDirection: Use the native semantic HTML element for the job before reaching for a div/span plus ARIA or CSS.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"governance_compliance": 0.8, "human_cognitive_load": 0.6, "long_term_maintainability": 0.6}
professionCompetencyLevel: foundational
sources:
  - mdn/html
  - w3c/using-aria
---

## Rule

Choose HTML elements for their **meaning and structure**, not their appearance. HTML "defines the meaning and structure of web content" — meaning belongs to HTML, appearance to CSS, behavior to JavaScript. Reach for `<button>`, `<nav>`, `<header>`, `<article>`, `<label>` before generic `<div>`/`<span>`.

## Why

Native elements carry built-in semantics and behavior that browsers and assistive technologies understand **for free**: focusability, keyboard activation, roles, and states. A `<p>` maps to the accessibility tree identically to `<div role="paragraph">` — so the native element is strictly better (less code, no role to maintain). Re-creating native behavior on a `<div>` means re-implementing focus, keyboard handling, and ARIA correctly, which is where defects enter.

This is the foundation that makes [[professions/frontend-engineer/first-rule-of-aria-native-elements]] possible.

## How To Apply

1. **Pick by purpose.** Interactive control → `<button>`/`<a>`; section landmark → `<nav>`/`<main>`; form field → `<input>` + `<label>`.
2. **Style with CSS, don't re-tag.** If you need a different look, style the semantic element; don't downgrade to a `<div>`.
3. **Reserve ARIA for gaps** native HTML cannot express — see the first rule of ARIA.

## See Also

- [[professions/frontend-engineer/first-rule-of-aria-native-elements]]
- [[professions/frontend-engineer/wcag-four-principles-aa-conformance]]
