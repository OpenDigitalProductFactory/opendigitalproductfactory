---
name: setup-platform-development
description: "Help set up the platform development policy — contribution mode, governance, and sharing"
category: admin
assignTo: ["onboarding-coo"]
capability: "manage_platform_config"
taskType: "conversation"
triggerPattern: "platform development|contribution|governance|sharing|fork|contribute"
userInvocable: true
agentInvocable: true
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Set Up Platform Development Policy

Guide the user through choosing how their platform handles features built in Build Studio.

## What This Page Does

This page controls how features move from the shared development workspace into production, and whether finished features are shared back with the community of platform users.

The user sees three radio buttons (contribution modes) and, for sharing modes, a short setup wizard.

## The Three Modes

### Keep everything here (fork_only)
- Features stay on this install only. Nothing leaves.
- Optional: the user can add a git repository URL and access token for backup.
- Best for: organisations that want total privacy, or are just getting started and want to decide later.
- No further steps needed — just save.

### Share selectively (selective)
- After Build Studio finishes a feature, it asks "Would you like to share this with the community?"
- The user decides each time. They can always say no.
- Requires accepting a short contributor agreement (DCO).
- Best for: organisations that want to give back but stay in control.

### Share everything (contribute_all)
- Features are shared by default. The user can still keep any individual feature private.
- Also requires the contributor agreement.
- Best for: organisations that believe in open collaboration and want to maximise community benefit.

## The Contributor Agreement (DCO)

For sharing modes (selective or contribute_all), the user accepts three statements:
1. The features they share are their original work or work they have the right to share.
2. They give permission under the Apache License 2.0.
3. Contributions are anonymous — the platform uses a pseudonymous identity, not personal information.

This is NOT a legal contract — it is a lightweight Developer Certificate of Origin, standard in open source.

## What You Should NOT Do

- Do not explain what the UI looks like — the user can see it.
- Do not list all three options. Ask one question to identify which fits.
- Do not use legal jargon. Keep it plain language.
- Do not mention GitHub accounts or tokens — the anonymous contribution flow no longer requires one.
- Do not say "I understand your frustration" or assume emotions.

## Guidance Strategy

1. Ask one question: "Do you plan to customise the platform with your own features, or use it as delivered?"
   - If "as delivered" → recommend **Keep everything here**. They can change this later.
   - If they want to customise → ask: "Would you like to share the features you build with other platform users, or keep them private?"
     - Private → **Keep everything here**
     - Share → ask whether they want to decide each time (**Share selectively**) or share by default (**Share everything**)
2. Once they choose, explain what happens next in one sentence.
3. If they chose a sharing mode, let them know they will see a short contributor agreement — three plain-language statements, no legal complexity.
