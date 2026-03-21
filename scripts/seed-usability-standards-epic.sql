-- Seed UI/UX Usability Standards epic
-- Run: cd packages/db && npx prisma db execute --file ../../scripts/seed-usability-standards-epic.sql
--
-- Architecture notes:
--   • Platform-wide WCAG 2.1 AA compliance as baseline for all UI surfaces
--   • Codifies contrast, typography, interactive element, and form usability standards
--   • Branding configuration must validate against these standards before save
--   • Applies to admin shell, storefront, portal, and all public-facing pages
--   • Standards enforced at theme derivation time (branding-presets.ts) and at save time
DO $$
DECLARE
  found_id    TEXT;
  mfg_id      TEXT;
  epic_id     TEXT;
BEGIN
  SELECT id INTO found_id FROM "Portfolio" WHERE slug = 'foundational';
  SELECT id INTO mfg_id   FROM "Portfolio" WHERE slug = 'manufacturing_and_delivery';

  INSERT INTO "Epic" (id, "epicId", title, description, status, "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    'EP-' || gen_random_uuid()::text,
    'UI/UX Usability Standards',
    'Establish and enforce platform-wide usability standards based on WCAG 2.1 AA. All UI surfaces (admin shell, storefront, portal, public pages) must meet minimum contrast ratios, readable typography, accessible interactive elements, and theme-aware color usage. Branding configuration must validate against these standards — rejecting or warning on non-compliant color combinations. Standards are enforced at theme derivation time and audited via automated tests. This prevents the class of bugs where hardcoded dark-mode-only styles (e.g. text-white) render unreadable in light mode, and ensures user-configured brand colors produce accessible interfaces.',
    'open', NOW(), NOW()
  ) RETURNING id INTO epic_id;

  -- Link to portfolios if they exist (seeded via seed.ts bootstrap)
  IF found_id IS NOT NULL AND mfg_id IS NOT NULL THEN
    INSERT INTO "EpicPortfolio" ("epicId", "portfolioId")
    VALUES (epic_id, found_id), (epic_id, mfg_id);
  END IF;

  INSERT INTO "BacklogItem" (id, "itemId", title, type, status, priority, "epicId", "createdAt", "updatedAt")
  VALUES
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Audit all admin shell components for hardcoded color values (text-white, bg-[#xxx], etc.) and replace with theme-aware CSS variables (--dpf-text, --dpf-surface-1, --dpf-border, --dpf-muted). Every text element must use --dpf-text or --dpf-muted, never literal white/black. Covers Header, sidebar, tab navs, form inputs, cards, modals, and all admin pages.',
     'portfolio', 'open', 1, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Audit storefront and portal layouts for hardcoded colors. Replace inline style objects using literal hex values with CSS variable references. Storefront layout, StorefrontNav, portal layout, sign-in forms, and all customer-facing components must respect the active branding theme in both light and dark modes.',
     'portfolio', 'open', 2, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Add WCAG AA contrast validation to branding save flow. When a user saves brand configuration, validate that: (1) text color vs background meets 4.5:1 ratio, (2) accent color vs surface backgrounds meets 3:1 for large text and 4.5:1 for body text, (3) muted/secondary text meets 4.5:1 vs all surface backgrounds. Return warnings for near-misses (3:1–4.5:1) and block saves that produce sub-3:1 contrast on any text/background pair.',
     'product', 'open', 3, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Extend deriveThemeTokens() to auto-correct accent colors that fail WCAG AA contrast. When a user-chosen accent would produce sub-4.5:1 contrast on light backgrounds, darken it to the nearest compliant shade while preserving hue. When it would fail on dark backgrounds, lighten it. The contrastRatio() utility already exists — wire it into the derivation pipeline. Add unit tests for edge-case accents (very light yellows, very dark blues).',
     'portfolio', 'open', 4, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Form element usability standards: all <input>, <select>, <textarea> elements must have (1) visible focus indicator with minimum 3:1 contrast against adjacent colors, (2) placeholder text meeting 4.5:1 contrast, (3) selected/active state visually distinct from default state, (4) disabled state clearly distinguishable. Create a shared CSS class or Tailwind utility layer for form elements that enforces these rules across admin, storefront, and portal.',
     'portfolio', 'open', 5, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Automated visual regression tests: add Playwright or Vitest screenshot tests that render key pages (branding config, storefront homepage, portal dashboard) in both light and dark mode. Assert no text-on-background pair falls below 3:1 contrast ratio. Run as part of CI on PRs that touch CSS, theme, or branding code paths.',
     'portfolio', 'open', 6, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Select/dropdown usability: <option> elements must have explicit background and text colors matching the active theme. Selected option must have a distinct visual indicator (background highlight using --dpf-accent at reduced opacity, or checkmark). Ensure cross-browser consistency on Windows, macOS, and Linux for both Chromium and Firefox.',
     'product', 'open', 7, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Document platform usability standards in /docs as a living reference. Cover: minimum contrast ratios per element type, required CSS variables for each surface/text role, form element patterns, button states, focus management, and the validation rules enforced at branding save time. This document is the source of truth for all UI development and is referenced by AI agents when generating or reviewing UI code.',
     'portfolio', 'open', 8, epic_id, NOW(), NOW());

END $$;
