/**
 * Seeds the "UX Accessibility — Color & Theme Standards" policy.
 * Safe to re-run — skips if policy with this title already exists.
 *
 * Run: npx tsx packages/db/scripts/seed-accessibility-policy.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

const POLICY_CONTENT = `## 1. Minimum Standard: WCAG 2.2 AA

All platform-generated color palettes must meet WCAG 2.2 Level AA contrast ratios. Normal text requires 4.5:1 contrast against its background. Large text (18pt+ or 14pt bold) and UI components require 3:1. This is enforced algorithmically at palette generation time.

## 2. OS Preference Respected

The platform respects the user's operating system color scheme preference via the CSS \`prefers-color-scheme\` media query. No manual toggle is provided. Light mode is the default for clients that do not report a preference.

## 3. Color Never Conveys Meaning Alone

Per WCAG 1.4.1, color must not be the sole means of conveying information. All color-coded elements (status badges, alerts, chart segments) must include supplementary indicators: icons, labels, patterns, or positional cues.

## 4. Both Modes Are First-Class

Every UI component must render correctly in both light and dark modes. Components that reference theme tokens via CSS variables (\`--dpf-*\`) satisfy this automatically. Custom colors or hardcoded hex values are prohibited in component styles.

## 5. Algorithmic Enforcement

Contrast validation runs at palette generation time, not as a manual review step. The \`deriveThemeTokens()\` function guarantees all critical color pairs meet the minimum ratios before tokens are stored.

## 6. Future Enhancements (Not Yet Implemented)

- \`prefers-contrast\` media query for high-contrast mode
- \`prefers-reduced-motion\` for animation preferences
- WCAG AAA compliance (7:1 text, 4.5:1 large text)

## 7. Standards Referenced

- WCAG 2.2 (W3C Recommendation)
- EN 301 549 (European ICT Accessibility Standard)
- Section 508 (US Federal Accessibility)
- CSS Media Queries Level 5 (\`prefers-color-scheme\`)
- Material Design 3 Dark Theme Guidelines (surface luminance)`;

async function main() {
  const existing = await prisma.policy.findFirst({
    where: { title: "UX Accessibility — Color & Theme Standards" },
  });

  if (existing) {
    console.log("[skip] Policy already exists:", existing.policyId);
    return;
  }

  const policyId = generateId("POL");
  const requirementId = generateId("PREQ");

  await prisma.policy.create({
    data: {
      policyId,
      title: "UX Accessibility — Color & Theme Standards",
      description: POLICY_CONTENT,
      category: "it",
      lifecycleStatus: "published",
      version: 1,
      publishedAt: new Date(),
      reviewFrequency: "annual",
      reviewDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      requirements: {
        create: {
          requirementId,
          requirementType: "acknowledgment",
          frequency: "once",
          applicability: "All developers",
          description: "Acknowledge that you have read and will follow the color and theme accessibility standards when building UI components.",
        },
      },
    },
  });

  console.log(`[created] Policy ${policyId} with requirement ${requirementId}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
