---
title: Reuse the camera in your pocket — platform-native usually wins
pageKind: heuristic
status: published
abstract: For most IT tooling decisions, the integrated platform-native capability wins on practicality even when the best-of-breed specialist wins on feature depth. The cost of integration is the silent killer.
sources:
  - articles/think-twice-ea-platform-servicenow
---

## The heuristic

> Choosing between a specialist best-of-breed tool and a platform-native capability that&#39;s already integrated? **Pick platform-native** unless the feature gap is large enough to justify the integration cost.
>
> *"Like making an argument that using a dedicated camera over the one built-into your phone is better."*

## When it applies

Tool consolidation decisions. EA platform vs. platform-native EA capability. Project portfolio management vs. platform-native PPM. Asset management vs. platform-native asset. Specialist analytics vs. platform-native reporting. And, for adopters, any "should we bolt a specialist tool onto DPF?" decision — the same question in DPF's own vocabulary.

## Why it works

The dedicated-camera-vs-phone-camera analogy works because everyone has lived it personally. The phone camera is worse on every spec sheet — but it&#39;s in your pocket, it shares the network with everything else, it&#39;s automatically backed up, the photos auto-tag with location and faces. Practicality dominates spec sheets for almost every use case.

The same logic applies to enterprise tooling. A specialist tool has features the incumbent platform lacks (or vice-versa) — I first drew this out for an EA platform against ServiceNow, but the shape is general. Those features cost feature-licence + integration build + ongoing reconciliation maintenance + the silent tax of two systems of record disagreeing. The platform-native version is in your pocket already.

For DPF this is not just an analogy — it is the product thesis. DPF exists to be the integrated whole: one data model, one platform, the coworkers reasoning off it. Reaching for a specialist tool and integrating it back in re-imports exactly the reconciliation cost DPF was built to remove. So the default is the strongest here: use what the platform already gives you, and make the integration argument earn its keep against the whole.

For the rare case where the feature gap *is* big enough — and it&#39;s rarer than vendors will admit — the right answer is to accept the cost honestly: the integration will go through Independent → Honeymoon → Ugly Reckoning. Plan for the Reckoning.

## Counterexamples

- Industry-specific capability that the platform genuinely doesn&#39;t cover (e.g., specialised regulatory modelling).
- Read-only specialist tools that don&#39;t need to write back to the platform — no integration risk to manage.
- Tools your customers/regulators require you to use regardless of your platform choice.

## See also

- Parent stance: `[[stances/dont-integrate-ea-platform]]`
- Related stance: `[[stances/trust-the-cmdb-or-rebuild-it]]` — the consolidation only works if the CMDB is trustworthy.
- Raw source: `[raw-sources/articles/think-twice-ea-platform-servicenow](../../raw-sources/articles/think-twice-ea-platform-servicenow.md)`
