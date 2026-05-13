---
sourceType: article
title: Why We Ended Up Proposing Two Standards for AI Agents
authors:
  - Bodman, Mark
publishedAt: 2026-05-12
license: Apache-2.0
abstract: |
  Over the past few months, what began as a practical exercise inside the Open Digital Product Factory became something more serious. As we tried to govern real AI coworkers, specialist agents, tool access, prompts, memory, approval flows, and public-facing trust, it became increasingly clear that the industry still lacks a coherent standards answer. Existing work is important, but fragmented. The result of that journey is a pair of draft standards: TAK, the Trusted AI Kernel, for runtime governance, and GAID, the Global AI Agent Identification and Governance Framework, for identity, badging, assurance, and traceability.
---

## Why it's cited

This is Mark Bodman's own article draft introducing the `TAK` and `GAID` standards effort in the context of the practical research and platform work that led to it.

## Key claims

- The need for `TAK` and `GAID` emerged from practical governance work, not from abstract taxonomy-building.
- Runtime governance and agent identity are distinct concerns and should not be collapsed into one standard.
- The Open Digital Product Factory became the first proving ground for these ideas because implementation pressure exposed the gaps quickly.

## Full draft

# Why We Ended Up Proposing Two Standards for AI Agents

Over the past few months, I have been working through a problem that I suspect many others are beginning to encounter in earnest.

It started simply enough. The aim was to think more seriously about trustworthy AI coworkers inside the Open Digital Product Factory. What would it mean to inventory them properly? How should tools, prompts, skills, approvals, memory, and operating boundaries be governed? How should one distinguish a generalist coordinating agent from a narrow specialist? What should be made visible to a user, and what should remain governed but inspectable? What should be considered immutable? What should be logged? What should require human approval? How should an organization know, in a durable way, what an agent can really reach and under what authority?

These are not theoretical questions for long.

The moment AI agents begin to use tools, read sensitive context, delegate tasks, retain memory, and cross system boundaries, familiar concerns from identity, security, software governance, and operational control come rushing in. Yet the vocabulary in the market is still uneven. In practice, many organizations can describe their AI strategy in broad terms, but still struggle to answer much simpler operational questions:

- Which agents are public and which are private?
- Which tools and skills are exposed to each one?
- What approvals are required for consequential actions?
- What instructions are meant to be immutable?
- What data sensitivity is each agent expected to handle?
- What evidence exists when an action goes wrong?
- What identity should another system trust when an agent appears at its boundary?

This is the practical problem I have been trying to address.

The point was never to chase credit or to claim novelty for its own sake. The point was to respond proactively to concerns that are already visible. Enterprises are beginning to realize that AI agents cannot be governed as if they were just better prompts. They are becoming operational actors. Once that happens, the requirements change materially.

What became clear during this work is that the standards conversation is moving, but it is still fragmented.

That is not a criticism of the many important efforts already underway. Quite the opposite. The recent evolution of `MCP` and `A2A`, the work emerging through `OpenID AIIM`, the launch of the `W3C` Agent Identity Registry Protocol Community Group, the practical framing from `CoSAI`, and the increasing focus from `NIST` all point in the same direction: the world is beginning to take agent identity, authority, traceability, and interoperability seriously.

But those efforts are solving different parts of the problem.

Some are focused on interoperability. Some are focused on authorization. Some are focused on model governance. Some are focused on identity infrastructure. Some are focused on security threats and red-team practices. All of that is useful. None of it, on its own, yet provides a complete operational answer to what a trustworthy AI agent needs to look like in practice.

That is why I ended up concluding that one draft standard was not enough.

## The Realization

The first realization was that runtime governance and identity governance are related, but not the same.

An organization needs a way to govern how an agent operates at runtime. That includes authority mediation, tool execution, immutable instruction handling, approval posture, delegation narrowing, provider failover, queueing, backpressure, memory boundaries, and evidence. In other words, it needs a governed harness for operating AI agents safely and consistently.

It also needs a way to identify an agent as a durable subject. That includes internal and public identity, badging, assurance, fit-for-purpose claims, ownership, directory bindings, authorization classes, issuer trust, receipts, and chain-of-custody. In other words, it needs a governed identity and traceability model.

Those two concerns overlap, but they should not be collapsed.

That led to two companion drafts.

The first is `TAK`, the Trusted AI Kernel.

The aim of `TAK` is to define the standard harness on which trustworthy AI agents are built, operated, and evidenced. A key message of this document is that an agent runtime should not be treated as little more than model invocation plus prompt engineering. A trustworthy runtime needs explicit control surfaces. It needs a consistent and reviewable way to handle authority, approvals, tool calls, delegation, provider limits, failure states, and evidence.

The second is `GAID`, the Global AI Agent Identification and Governance Framework.

The aim of `GAID` is to define how AI agents are identified, described, badged, and validated across internal and external boundaries. It treats badging not as a decorative idea, but as part of identity. It addresses the difference between private and public identity, the need for accountable issuers, the distinction between enduring identity and current validated operating state, and the need for receipts and verifiable traceability.

The point is not to create parallel worlds that duplicate all existing standards work.

The point is to connect layers that are currently fragmented:

- `TAK` for governed runtime operation
- `GAID` for identity, assurance, and traceability
- companion receipts to connect the two

## Why This Had to Be Grounded in a Real Platform

Another realization from the last few months was that these ideas become much sharper when exercised inside a real platform.

The Open Digital Product Factory did not begin as a standards project. It began as a practical environment for managing digital products, AI coworkers, and increasingly, governed execution. Over time, that platform started to expose the exact seams that the standards conversation often leaves implicit.

Once you have route-specific specialists, coordinator agents, tool grants, approval modes, memory layers, prompt assembly blocks, and real enterprise concerns around sensitivity and authorization, abstract debates start becoming concrete design decisions.

That changed the nature of the work.

The platform became a proving ground. It also became a forcing function. It revealed what was already strong, what was missing, and which ideas held up only as theory until implementation pressure tested them.

In that sense, the standards work and the platform work began to reinforce each other.

`TAK` could be drafted more credibly because there was already a practical runtime that exposed authority intersection, proposal-mode execution, tool governance, and audit behavior. `GAID` could be drafted more credibly because the platform already had internal agent registries, model bindings, memory declarations, delegation relationships, and emerging identity and governance structures that could be pushed further.

That is also why I am more confident in these drafts now than I would have been a few months ago.

They are not complete in the sense that every global governance question is solved. They are not presented as final answers to every accreditation, registration, or public trust problem. But they are now concrete enough to invite serious feedback because they have already had to answer to implementation pressure.

## Why the Timing Matters

The timing is not accidental.

The public conversation has shifted materially. `NIST` is treating agent standards as a serious concern. The `NCCoE` has put software and AI agent identity and authorization on the table explicitly. National and regional governance activity is moving beyond generic AI discussion and into more operational concerns. The market itself is also maturing. Large platform vendors are converging on agent frameworks and governance language, even if the answers remain incomplete.

That means the standards window is open.

It also means that the quality bar is rising. A proposal in this space needs to do more than express concern. It needs to be implementable. It needs to reuse what already exists where that is sensible. It needs to be explicit about what remains unresolved. It needs to be able to survive comparison with other draft efforts, not simply declare itself necessary.

That is why the recent work on these drafts has focused so much on fidelity.

The standards now include stronger normative language, clearer pseudocode, more explicit conformance criteria, companion threat-model and conformance-test artifacts, stronger alignment to adjacent work, and a clearer story about what can be implemented now versus what depends on broader ecosystem evolution.

In other words, the objective was not simply to say that AI agents need better governance. The objective was to write something that could plausibly be used.

## What I Am Hoping For Now

At this point, I believe these drafts are ready for real public feedback.

That is an important transition.

There is a difference between private design work and public standards work. Private work can live comfortably with a few unresolved edges and a lot of tacit context. Public work has to withstand comparison, criticism, and alternative proposals. It has to be clear about what it adds. It has to be humble enough to acknowledge the active work around it, and firm enough to explain why a gap still remains.

That is where I think these drafts now stand.

I am not presenting them as the only possible answer. I am presenting them as a serious, practical answer to a set of concerns that I believe many organizations are about to encounter more directly:

- how to inventory AI agents properly
- how to govern them consistently
- how to express trust and fit-for-purpose clearly
- how to preserve traceability and accountability
- how to avoid mistaking interoperability alone for governance

The documents are now live in draft form on the Open Digital Product Factory site:

- `TAK`: [Trusted AI Kernel](https://opendigitalproductfactory.com/architecture/trusted-ai-kernel/)
- `GAID`: [Global AI Agent Identification and Governance Framework](https://opendigitalproductfactory.com/architecture/GAID/)
- `White paper`: [Trusted AI Agent Governance White Paper](https://opendigitalproductfactory.com/architecture/2026-04-18-trusted-ai-agent-governance-white-paper/)
- `DPF conformance view`: [Agent Standards Conformance Assessment](https://opendigitalproductfactory.com/architecture/agent-standards-dpf-conformance/)

What I would value most now is thoughtful feedback from people working in adjacent problem spaces:

- enterprise architecture
- identity and access management
- agent interoperability
- AI governance
- software supply chain security
- digital trust and assurance
- public-sector standards work

If the central claim is wrong, I would rather learn that through open criticism now.

If the central claim is right, then the work ahead is not to defend authorship. It is to improve the standards, connect them responsibly to adjacent efforts, and make them useful.

That is the stage I believe this work has now reached.

## See also

- Related standards draft: [docs/architecture/trusted-ai-kernel.md](D:/DPF/docs/architecture/trusted-ai-kernel.md)
- Related standards draft: [docs/architecture/GAID.md](D:/DPF/docs/architecture/GAID.md)
- Related white paper: [docs/architecture/2026-04-18-trusted-ai-agent-governance-white-paper.md](D:/DPF/docs/architecture/2026-04-18-trusted-ai-agent-governance-white-paper.md)
