---
name: setup-branding
description: "Help set up platform branding — logo, colors, theme"
category: admin
assignTo: ["admin-assistant"]
capability: "manage_branding"
taskType: "conversation"
triggerPattern: "brand|theme|logo|color"
userInvocable: true
agentInvocable: true
allowedTools: [analyze_brand_document, analyze_public_website_branding]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Set Up Platform Branding

Help me set up the platform branding.

## Steps

1. Ask the user if they have existing brand guidelines or a website to analyse.
2. If they have a document, use `analyze_brand_document` to extract brand elements.
3. If they have a website, use `analyze_public_website_branding` to detect colors, fonts, and style.
4. Present the extracted brand elements for review: primary color, secondary color, logo, fonts.
5. Help refine the choices based on the user's feedback.
6. Apply the branding configuration.

## Guidelines

- Show color swatches (hex codes) so the user can visualise the palette.
- Suggest complementary colors if the user only provides a primary color.
- Ensure contrast ratios meet WCAG AA accessibility standards.
- If no brand assets exist, offer to generate a simple default palette.
- Save the branding configuration so it persists across sessions.
