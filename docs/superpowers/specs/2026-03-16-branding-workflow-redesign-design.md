# EP-BRANDING-001: Branding Workflow Redesign

**Status:** Draft
**Date:** 2026-03-16
**Epic:** Branding Workflow Redesign
**Scope:** Admin page restructure, branding UX overhaul, runtime theme injection, AI coworker integration, agent instruction updates

---

## Problem Statement

The current admin branding page exposes 33+ raw theme tokens (palette colors, surface colors, state colors, spacing, radii, shadows, fonts) in a flat form. This is overwhelming for customers who just want to apply their brand. Additionally:

- **Logos don't display** — CSS variables are hardcoded in `globals.css` and never dynamically applied from database tokens
- **No brand import** — customers must manually configure every field; there's no way to provide a URL or document and have the system extract brand assets
- **No progressive disclosure** — the same complex interface is shown to first-time users and power users alike
- **Admin page lacks sub-sections** — branding, user management, and platform keys are all on one page, inconsistent with the tab-nav pattern used elsewhere (EA, AI Workforce, Ops)

## Goals

1. Customer can establish their brand in under 2 minutes via URL import, document upload, or preset selection
2. Branding actually works end-to-end: saved tokens apply as runtime CSS variables across the platform
3. Admin page follows the established tab-nav sub-route pattern
4. AI coworker is the interface for advanced theme adjustments — no raw token fields in the default UI
5. Agent instructions updated with design principles for consistent future development
6. All agent welcome messages follow a consistent, helpful format

## Non-Goals

- Light/dark mode toggle (single dark theme for now)
- Per-portfolio branding (organization scope only)
- Multi-tenant brand isolation

---

## Design

### 1. Admin Page Restructure

Follow the established tab-nav pattern used by EA Modeler (`/ea` + `/ea/models`), AI Workforce (`/platform/ai` + `/platform/ai/providers` + `/platform/ai/history`), and Ops (`/ops` + `/ops/improvements`).

**Route structure:**

```
/admin              → Users & Access (existing content, cleaned up)
/admin/branding     → Branding (new sub-route)
/admin/settings     → Platform Settings (API keys, moved from current page)
```

**Implementation:**
- Update `AdminTabNav` with three tabs: Access, Branding, Settings (keeping existing "Access" label which covers user listing + role assignment)
- Create `app/(shell)/admin/branding/page.tsx`
- Create `app/(shell)/admin/settings/page.tsx`
- Move `PlatformKeysPanel` to the Settings tab
- Clean up `app/(shell)/admin/page.tsx` to only contain user management

### 2. Three Branding Interaction Layers

The branding page (`/admin/branding`) supports three complementary interaction modes:

#### Layer A: Setup Wizard (first-time)

Shown when no `BrandingConfig` with scope `"organization"` exists in the database.

**Step 1 — Choose source:**
- **Import from URL** — paste company website URL. System calls existing `analyze_public_website_branding` tool to scrape logo, colors, and fonts. Requires external access toggle. If external access is disabled, this option is grayed out with tooltip: "Enable external access in Settings to use this feature."
- **Upload brand document** — PDF or image with brand guidelines. System extracts brand assets (logo, colors, fonts). See Section 6 for detailed tool specification.
- **Pick a preset** — grid of generic OOTB presets (see Section 5).

**Step 2 — Preview & confirm:**
- Live preview panel showing header, sidebar, card, and button samples with the extracted/selected brand applied via scoped CSS variable overrides
- Tokens not directly extracted (surfaces, states, etc.) are algorithmically derived from the accent color — same approach used for OOTB presets. The `analyze_public_website_branding` tool currently returns only `companyName`, `logoUrl`, `paletteAccent`, and `notes`; the remaining token set is generated from the accent color to produce a cohesive theme.
- Editable summary: company name, logo, accent color
- Actions: "Looks good" (save) / "Let me adjust" (go to step 3)

**Step 3 — Fine-tune (optional):**
- Simple fields only: company name, logo (URL or upload), accent color, font family
- AI coworker available via the floating panel + skills dropdown for advanced changes
- No explicit "ask the AI" button — the panel is always accessible

On completion, saves to `BrandingConfig` with scope `"organization"` and CSS variables apply on next page load.

#### Layer B: Quick Edit Form (day-to-day)

Shown when a `BrandingConfig` with scope `"organization"` already exists.

**Fields:**
- Company name
- Logo (URL input or file upload with preview)
- Accent color (color picker)
- Font family (dropdown with common options)
- Live preview panel

**Additional controls:**
- "Re-run setup wizard" link — shows Layer A pre-populated with current BrandingConfig values. On completion, updates the existing record. User can cancel to return to Layer B.
- Save button applies changes immediately

#### Layer C: AI Coworker (power user, always available)

The System Admin agent on `/admin/branding` handles advanced branding via natural language:

- "Make the sidebar darker"
- "Use warmer tones"
- "Match our brand from ourcompany.com"
- "Change the heading font to Montserrat"

Uses expanded form assist to update any token. No raw token fields exposed in the UI — the AI coworker IS the advanced interface.

**State logic:**
```
IF no BrandingConfig with scope="organization" exists:
  → Show Setup Wizard (Layer A)
ELSE:
  → Show Quick Edit Form (Layer B)
  → "Re-run setup wizard" link available
ALWAYS:
  → AI Coworker (Layer C) available via floating panel
```

### 3. Runtime CSS Token Injection

**Current state:** CSS variables hardcoded in `globals.css`, never updated from database.

**Fix:** Server-side style injection in the shell layout.

`app/(shell)/layout.tsx` already fetches `BrandingConfig` with scope `"organization"`. Extend it to:

1. Read stored tokens from `BrandingConfig.tokens`
2. Map token fields to CSS variable names (e.g., `palette.accent` → `--dpf-accent`)
3. Render a `<style>` tag with `:root { ... }` overrides after the `globals.css` defaults

**Key properties:**
- Server-rendered, no client-side JS required for initial paint
- `globals.css` defaults remain as baseline fallback when no BrandingConfig exists
- Page navigations within the shell pick up the injected styles automatically
- Live preview in wizard/form uses a scoped wrapper with inline CSS variable overrides (client component)

**Token-to-CSS mapping (8 variables currently defined and consumed by components):**
```
palette.bg         → --dpf-bg
palette.surface1   → --dpf-surface-1
palette.surface2   → --dpf-surface-2
palette.accent     → --dpf-accent
palette.muted      → --dpf-muted
palette.border     → --dpf-border
typography.fontFamily        → --dpf-font-body
typography.headingFontFamily → --dpf-font-heading
```

**Scope note:** Only these 8 CSS variables are currently defined in `globals.css` and referenced by components. The remaining tokens (surfaces, states, spacing, radius, shadows) are stored in the database but have no corresponding CSS variable usage in components today. The initial implementation injects only these 8 variables. As components are built or updated to reference additional `--dpf-*` variables, the injection mapping and `globals.css` baseline should be extended to match. The form assist adapter (Section 6) exposes all tokens to the AI coworker regardless, so the system is forward-compatible.

### 4. Logo Fix

**Problems:**
1. OOTB preset SVGs reference `/logos/*.svg` — these files may not all exist in `public/logos/`
2. The `analyze_public_website_branding` tool may return relative URLs that don't resolve

**Fixes:**
- Verify all preset logo SVGs exist in `public/logos/`; add missing ones
- New generic presets use the Open Digital Product Factory logo (`/logos/open-digital-product-factory-logo.svg`) as default
- URL import path: ensure scraped logo URLs are stored as absolute HTTPS URLs
- File upload path: save uploaded logo to `upload_storage_path`, reference as local path
- Add logging when Header component falls back to initials (logo src 404)

**Logo URL utilities need consolidation:** `normalizeLogoUrl()` currently lives as a local function inside `BrandingConfigurator.tsx` (client-side only). `resolveBrandingLogoUrl()` in `lib/branding.ts` is a near-no-op (trims whitespace). Extract `normalizeLogoUrl` to `lib/branding.ts` as a shared utility so the wizard, quick-edit, and server-side code can all use it. Enhance `resolveBrandingLogoUrl()` to handle edge cases (relative URLs, missing protocols).

**No schema changes needed** — `BrandingConfig.logoUrl` already supports HTTPS URLs, app-local paths, and data URLs.

### 5. Generic OOTB Presets

Replace the 13 company-branded presets with generic style presets:

| Preset | Accent | Vibe |
|--------|--------|------|
| Corporate Blue | `#2563eb` | Professional, subdued |
| Warm Earth | `#d97706` | Earthy, amber/terracotta |
| Modern Dark | `#8b5cf6` | High contrast, violet |
| Clean Minimal | `#6b7280` | Near-black, neutral gray |
| Ocean Teal | `#0d9488` | Deep navy, teal |
| Forest Green | `#16a34a` | Dark greens, emerald |

Each preset includes:
- The Open Digital Product Factory logo as default
- A sensible font pairing
- A fully derived token set (surfaces, states, etc. algorithmically derived from the accent color)
- Stored with scope `theme-preset:{slug}` pattern (same as current)

The old company-branded presets are removed from code entirely.

### 6. AI Coworker Branding Integration

#### Expanded form assist

Current `branding-form-assist.ts` handles 5 fields. Expand to cover all theme tokens so the AI coworker can adjust anything via natural language.

**New fields added to form assist adapter:**
- All palette colors (6)
- All surface colors (5)
- All state colors (8)
- Typography (2)
- Spacing (5)
- Radius (4)
- Shadows (3)

Total: ~33 fields exposed to the AI, hidden from the manual UI.

#### System Admin agent updates

**New skills added to `/admin` route agent:**
- "Set up branding" — triggers the wizard flow guidance
- "Import brand from URL" — prompts for URL, uses `analyze_public_website_branding` tool
- "Adjust theme colors" — opens form assist context for color adjustments

**System prompt update:** Add branding context awareness to the System Admin agent so it understands the theme token structure and can make intelligent adjustments (e.g., "make it warmer" → shift accent and surface hues toward warm tones).

#### Document upload path

New tool: `analyze_brand_document`

**Input schema:**
```
{
  fileName: string       // original filename
  fileContent: string    // base64-encoded file content
  fileType: "pdf" | "png" | "jpg" | "svg"
}
```

**Output schema:**
```
{
  companyName: string | null
  logoDataUrl: string | null    // base64 data URL if logo extracted
  colors: string[]              // hex colors found (max 6)
  fonts: string[]               // font names found
  notes: string                 // AI's summary of what was extracted
}
```

**Execution:** Immediate mode, requires `manage_branding` capability. Does NOT require external access (file is local).

**Implementation:** Send the document to the AI model with vision capabilities. For PDFs, extract text first; if structured brand guidelines are detected, parse colors and fonts from text. For images, use vision to identify logo regions, dominant colors, and any text mentioning fonts.

**Fallback:** If extraction fails or produces no usable results, return empty fields with a `notes` message explaining what went wrong. The wizard Step 2 falls back to a manual entry form with the message: "We couldn't extract brand assets automatically. You can enter them manually or try a different file."

**File handling:** Document upload on the branding page does NOT use the existing thread-scoped `file-upload.ts` system. Instead, the file is read client-side as base64 and passed directly to the tool. No server-side file storage needed — the tool processes the file and returns extracted assets. If a logo is extracted, it's stored as a data URL in `BrandingConfig.logoUrl`.

### 7. Agent Instruction Updates

#### Design Principles (added to AGENTS.md or platform preamble)

```
DESIGN PRINCIPLES:
- Section organization: Tab-nav with sub-routes (e.g., /admin, /admin/branding, /admin/settings)
- Progressive disclosure: Simple defaults for most users, AI coworker for advanced control
- Setup flows: Wizard-first for initial configuration, quick-edit form for returning users
- Welcome messages: Complete sentence greeting + what I can help with + mention skills dropdown
- Consistency: Follow established patterns — check existing TabNav components, page layouts, and route structure before creating new patterns
```

#### Welcome message format (all agents)

Update the empty-thread welcome state across all agents to follow a consistent format:

1. **Greeting line** — complete sentence describing what this agent does (not just noun phrases)
2. **Context line** — what the agent can see on this page
3. **Skills hint** — "You can also explore more actions in the skills menu above."

**Example for HR Director (currently broken):**
```
Current:  "People, roles, accountability chains, and governance compliance"
Updated:  "I'm your HR Director. I can help you understand role structures,
           review team assignments, and navigate the organizational hierarchy.
           You can also explore more actions in the skills menu above."
```

**All 10 agents updated to this format:**

| Agent | Route | Proposed Welcome Message |
|-------|-------|--------------------------|
| Portfolio Analyst | `/portfolio` | "I'm your Portfolio Analyst. I can help you explore portfolio health, review budget allocations, and understand product groupings. You can also explore more actions in the skills menu above." |
| Product Manager | `/inventory` | "I'm the Product Manager. I can help you review product lifecycles, check stage-gate readiness, and explore the digital product inventory. You can also explore more actions in the skills menu above." |
| Enterprise Architect | `/ea` | "I'm your Enterprise Architect. I can help you create architecture views, map relationships between components, and navigate ArchiMate models. You can also explore more actions in the skills menu above." |
| HR Director | `/employee` | "I'm the HR Director. I can help you understand role structures, review team assignments, and navigate the organizational hierarchy. You can also explore more actions in the skills menu above." |
| Customer Success Mgr | `/customer` | "I'm the Customer Success Manager. I can help you review customer journeys, identify friction points, and track adoption metrics. You can also explore more actions in the skills menu above." |
| Scrum Master | `/ops` | "I'm the Scrum Master. I can help you manage the backlog, track epic progress, and prioritize work items. You can also explore more actions in the skills menu above." |
| AI Ops Engineer | `/platform` | "I'm the AI Ops Engineer. I can help you configure AI providers, review token spend, and optimize the AI workforce. You can also explore more actions in the skills menu above." |
| Software Engineer | `/build` | "I'm your Software Engineer. I can help you build features, review code, and guide you through the build process. You can also explore more actions in the skills menu above." |
| System Admin | `/admin` | "I'm the System Admin. I can help with user management, branding configuration, and platform settings. You can also explore more actions in the skills menu above." |
| COO | `/workspace` | "I'm the COO. I can help you get oriented across the platform — from portfolio health to backlog priorities to workforce status. You can also explore more actions in the skills menu above." |

The existing multi-response rotation pattern (`CANNED_RESPONSES` with `default` and `restricted` arrays) is replaced with a single canonical greeting per agent. The `restricted` variant remains as a separate, simpler message for users without full permissions.

---

## Data Model

No schema changes required. Existing models support the full design:

- `BrandingConfig` — stores tokens, logo URL, company name per scope
- `PlatformConfig` — stores platform keys (moved to Settings tab)
- `AgentMessage` / thread model — supports the AI coworker conversation

## Files Affected

**New files:**
- `app/(shell)/admin/branding/page.tsx` — branding sub-route (server component, fetches BrandingConfig)
- `app/(shell)/admin/settings/page.tsx` — settings sub-route (server component, fetches PlatformConfig)
- `components/admin/BrandingWizard.tsx` — setup wizard component ("use client" — manages wizard state, form inputs, preview)
- `components/admin/BrandingQuickEdit.tsx` — simple edit form ("use client" — form inputs, color picker, live preview)
- `components/admin/BrandingPreview.tsx` — live preview panel ("use client" — applies scoped CSS variable overrides from props)

**Modified files:**
- `components/admin/AdminTabNav.tsx` — add Branding and Settings tabs
- `app/(shell)/admin/page.tsx` — remove branding and platform keys, keep users only
- `app/(shell)/layout.tsx` — add runtime CSS variable injection from BrandingConfig tokens
- `components/admin/branding-form-assist.ts` — expand to all token fields
- `lib/agent-routing.ts` — update System Admin agent (skills, system prompt, welcome messages); update all 10 agent welcome messages
- `lib/branding.ts` — extract `normalizeLogoUrl` here as shared utility, enhance `resolveBrandingLogoUrl`
- `lib/mcp-tools.ts` — add `analyze_brand_document` tool definition
- `app/globals.css` — ensure CSS variable names align with injection mapping
- `AGENTS.md` — add design principles section
- `components/admin/BrandingConfigurator.tsx` — deprecate/remove (replaced by wizard + quick edit)

**Removed:**
- 13 company-branded presets from `app/(shell)/admin/page.tsx`
- Raw token editor fields from branding UI
- Unused preset logo SVGs from `public/logos/` (company-branded ones only; verify none are referenced elsewhere before deleting)

## Testing Strategy

- Verify wizard completes end-to-end: URL import → preview → save → tokens applied
- Verify quick edit form loads existing brand and saves changes
- Verify CSS variables are injected server-side and override `globals.css` defaults
- Verify logo displays correctly for: HTTPS URL, local path, uploaded file, data URL
- Verify AI coworker can adjust any token via form assist
- Verify all agent welcome messages display correctly with skills hint
- Verify admin tab navigation works across all three sub-routes
- Verify fallback: no BrandingConfig → defaults from globals.css apply

## Demo Story

With a prospect: navigate to `/admin/branding`, paste their company URL, system scrapes their brand assets, preview shows their logo and colors applied across the platform. Confirm → their brand is live. Under 2 minutes, zero manual configuration. For refinement, open the AI coworker: "Make the accent color a bit more saturated" — done live.
