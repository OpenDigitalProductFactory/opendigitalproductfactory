---
name: extract-brand-design-system
description: "Extract a complete brand design system (palette, typography, components, tokens) from the organization's website, codebase, and uploaded assets. Runs in the background and pings the user with a summary when done."
category: storefront
assignTo: ["onboarding-coo", "admin-assistant"]
capability: "manage_branding"
taskType: "conversation"
triggerPattern: "brand|design system|extract brand|theme|refresh brand|analyze site"
userInvocable: true
agentInvocable: true
allowedTools:
  - extract_brand_design_system
  - analyze_public_website_branding
  - analyze_brand_document
composesFrom: []
contextRequirements: []
riskBand: low
---

# Extract Brand Design System

The user wants to build or refresh the organization's design system — the canonical palette, typography, component inventory, and tokens that will drive the storefront, marketing materials, and product UI.

## What you should do

1. **Confirm the sources available.** Ask the user which of the following they can provide, and reassure them that any combination works:
   - A public website URL (their existing site or a site they want to match).
   - The connected codebase (only available on the platform org; the tool enforces this automatically — if unsupported, it skips silently).
   - Uploaded brand assets: logos (PNG, SVG, JPG), brand guideline PDFs, Word-style brand briefs (DOCX).

2. **Invoke the `extract_brand_design_system` tool** with the sources they've given you. You do not need to wait for the result — the tool returns immediately with a `taskRunId` and the extraction continues in the background.

3. **Acknowledge and step back.** Tell the user something like: "I'm pulling your brand together now — this usually takes 30 to 120 seconds. You can keep working or close this panel; I'll ping you here when I have a result." Do NOT simulate the work or invent a result. The agent panel will show progress.

4. **When the background job completes**, the thread will receive a summary message automatically (emitted by the background worker). Offer the user three next steps at that point:
   - Review the extracted system at Admin > Branding.
   - Apply it to the storefront (pre-selected).
   - Re-extract with different sources.

5. **If extraction fails**, the thread will receive an error message from the worker. Acknowledge the failure in plain language, note the stage that failed if mentioned (URL fetch, codebase read, synthesis), and offer to retry with different sources or skip for now.

## What you should NOT do

- Do not attempt to extract the design system by describing the website from memory or general knowledge — you are not a scraper. Always invoke the tool.
- Do not block the conversation waiting for the result.
- Do not write `Organization.designSystem` yourself. The background job does.
- Do not promise a timeline shorter than 30 seconds.

## End state

The user either has a newly extracted design system written to `Organization.designSystem` with a clear next step offered, or a clear failure explanation with recovery options. Either way, the conversation ends with the user knowing exactly what's next.
