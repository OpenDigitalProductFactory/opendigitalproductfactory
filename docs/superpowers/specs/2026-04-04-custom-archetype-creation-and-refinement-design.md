# EP-STORE-007: Custom Archetype Creation & Refinement with Hive Mind Contribution

**Epic:** Storefront Foundation  
**Status:** Draft  
**Date:** 2026-04-04  
**Author:** AI-assisted (Claude)  
**IT4IT Alignment:** SS5.5 Release (service catalog evolution), SS5.6 Consume (customer delivery)  
**Dependencies:** EP-STORE-001, EP-STORE-005, EP-STORE-006, EP-HIVEMIND-001

---

## 1. Problem Statement

The platform ships with 30+ pre-defined business archetypes across 11 categories, but:

1. **Missing archetypes**: A user running a co-working space, a brewery taproom, a dog daycare with retail, or a medical aesthetics clinic has no matching template. They must pick the closest archetype and manually reconfigure after setup — losing the archetype-driven vocabulary, marketing playbook, and category suggestions.

2. **Stale archetypes**: Pre-defined archetypes are frozen in the `storefront-templates` package. A real dental practice discovers that the default items ("Check-up Exam", "Scale & Polish") don't match how UK dental practices actually categorise services (NHS Band 1/2/3, Private). The user fixes their items post-setup but that knowledge is lost — it doesn't flow back to improve the template for future users.

Both problems have the same solution: **make archetypes a living, community-evolved system** where custom archetypes can be created and refined archetypes can be contributed back via Hive Mind.

## 2. Design Overview

### Two Capabilities

**Capability A: Custom Archetype Creation ("Other" Option)**

When no pre-defined archetype fits, the user defines a new one through a guided process:
1. User selects "Other" in the setup wizard
2. AI coworker interviews the user about their business (name, what they sell/offer, how customers interact, stakeholders)
3. System generates an archetype definition (items, sections, CTA type, form schema, vocabulary)
4. User previews and refines
5. Custom archetype is saved with `isBuiltIn: false`
6. Setup continues as normal with the custom archetype

**Capability B: Archetype Refinement & Contribution**

After real-world use, users can refine their archetype:
1. User modifies items, sections, form fields, or vocabulary through normal admin operations
2. An "Improve template" action in settings compares current config against the original archetype
3. System generates a diff showing what changed (added items, removed sections, renamed categories)
4. If Hive Mind contribution mode is `selective` or `contribute_all`, user can contribute the refinement as an upstream PR
5. Contributed refinements improve the archetype for all future installations

## 3. Capability A: Custom Archetype Creation

### 3.1 Schema Change

Add `isBuiltIn` field to `StorefrontArchetype`:

```prisma
model StorefrontArchetype {
  // ... existing fields
  isBuiltIn   Boolean   @default(true)
}
```

**Migration**: Add column with default `true` (all existing rows are built-in).

**Seed script**: No change — existing upsert creates with `isBuiltIn: true` implicitly.

### 3.2 Setup Wizard: "Other" Option

**In Step 1** (archetype selection), add a card at the bottom of the grid:

```
+--------------------------------------------+
| Can't find your business?                  |
| Define a custom business model with AI     |
| assistance. Your template can also be      |
| contributed back to help others.           |
|                            [Define custom] |
+--------------------------------------------+
```

**When clicked**, the wizard transitions to a **Custom Definition Flow** (replaces Steps 1-2):

### 3.3 Custom Definition Flow

**Step C1: Business Interview**

The AI coworker (onboarding COO or marketing specialist) asks structured questions:

| Question | Purpose | Example Answers |
|---|---|---|
| What does your business do? | Core business description | "We run a co-working space with meeting rooms and hot desks" |
| What do you offer to customers? | Item templates | "Hot desks, dedicated desks, private offices, meeting rooms, virtual office" |
| How do customers interact with you? | CTA type detection | "They book desks and rooms online, or inquire about private offices" |
| Who are your main stakeholders? | Vocabulary | "Members, guests, corporate clients" |
| What would you call your portal? | Portal label | "Member Portal" |
| What industry/category is closest? | Category mapping | "Professional Services" or "New category: Co-working" |

**Implementation**: This is a **conversation-driven process** using the AI coworker panel on the `/storefront/setup` route. The agent uses the existing `onboarding-coo` agent with an extended skill for custom archetype definition.

**Step C2: AI Generates Archetype**

Based on the conversation, the system generates:

```typescript
{
  archetypeId: "custom-coworking-space",
  name: "Co-working Space",
  category: "professional-services",  // Closest match, or new custom category
  ctaType: "booking",                 // Dominant CTA
  itemTemplates: [
    { name: "Hot Desk", description: "Flexible daily desk", priceType: "fixed", ctaType: "booking", bookingDurationMinutes: 480 },
    { name: "Meeting Room", description: "Bookable meeting room", priceType: "per-hour", ctaType: "booking", bookingDurationMinutes: 60 },
    { name: "Private Office", description: "Dedicated office space", priceType: "from", ctaType: "inquiry" },
    { name: "Virtual Office", description: "Business address and mail handling", priceType: "fixed", ctaType: "purchase" },
  ],
  sectionTemplates: [
    { type: "hero", title: "Welcome", sortOrder: 0 },
    { type: "items", title: "Spaces & Services", sortOrder: 1 },
    { type: "about", title: "About Us", sortOrder: 2 },
    { type: "gallery", title: "Our Space", sortOrder: 3 },
    { type: "testimonials", title: "Member Stories", sortOrder: 4 },
    { type: "contact", title: "Get in Touch", sortOrder: 5 },
  ],
  formSchema: [
    { name: "name", label: "Name", type: "text", required: true },
    { name: "email", label: "Email", type: "email", required: true },
    { name: "phone", label: "Phone", type: "tel", required: false },
    { name: "company", label: "Company", type: "text", required: false },
    { name: "team_size", label: "Team size", type: "select", required: false, options: ["Just me", "2-5", "6-10", "11-25", "25+"] },
  ],
  tags: ["coworking", "shared office", "hot desk", "meeting room", "flexible workspace"],
  isBuiltIn: false,
}
```

**Step C3: Preview & Refine**

Same as existing Step 2 but with an "Edit" button on each generated item/section. User can:
- Add/remove/rename items
- Change CTA types per item
- Adjust section order
- Edit form fields

**Step C4: Save & Continue**

The custom archetype is saved to `StorefrontArchetype` with `isBuiltIn: false`. Setup continues to Step 3 (Business Identity) as normal.

### 3.4 MCP Tool: `generate_custom_archetype`

A new tool for the onboarding agent to generate archetype definitions from conversation context:

```typescript
{
  name: "generate_custom_archetype",
  description: "Generate a custom business archetype from a description of the business, its offerings, and customer interaction patterns",
  inputSchema: {
    type: "object",
    properties: {
      businessDescription: { type: "string", description: "What the business does" },
      offerings: { type: "array", items: { type: "string" }, description: "List of products/services offered" },
      primaryCtaType: { type: "string", enum: ["booking", "purchase", "inquiry", "donation", "mixed"] },
      stakeholderLabel: { type: "string", description: "What to call customers (Members, Clients, Patients, etc.)" },
      portalLabel: { type: "string", description: "What to call the portal (Member Portal, Client Portal, etc.)" },
      closestCategory: { type: "string", description: "Closest existing category, or 'custom'" },
      customCategoryName: { type: "string", description: "If closestCategory is 'custom', the name of the new category" },
    },
    required: ["businessDescription", "offerings", "primaryCtaType"],
  },
  requiredCapability: "view_storefront",
  sideEffect: true,
}
```

The tool handler:
1. Generates item templates from the offerings list (inferring priceType, ctaType, and duration from the description)
2. Generates section templates (always hero + items + about + contact; adds gallery, team, testimonials based on business type)
3. Generates form schema (always name + email; adds business-specific fields based on description)
4. Creates the `StorefrontArchetype` record with `isBuiltIn: false`
5. Returns the generated archetype for preview

### 3.5 Vocabulary Registration for Custom Archetypes

When a custom archetype is created, its vocabulary is derived from the `closestCategory` mapping. If the user specifies custom portal/stakeholder labels, these are stored in a new JSON field on `StorefrontArchetype`:

```prisma
model StorefrontArchetype {
  // ... existing
  isBuiltIn        Boolean   @default(true)
  customVocabulary Json?     // { portalLabel, stakeholderLabel, teamLabel, inboxLabel, agentName }
}
```

The `getVocabulary()` function checks `customVocabulary` first, then falls back to the category-based vocabulary.

## 4. Capability B: Archetype Refinement & Contribution

### 4.1 "Improve Template" Action

A new button in `/storefront/settings` (visible only to admins):

```
[Improve template]
"Your live configuration differs from the original template. 
 Review the changes and optionally contribute them back to improve 
 the template for future users."
```

### 4.2 Refinement Diff Generation

When clicked, the system compares:
- **Original**: The `StorefrontArchetype` record (item templates, section templates, form schema)
- **Current**: The live `StorefrontItem`, `StorefrontSection` records

**Generates a structured diff:**

```typescript
type ArchetypeRefinement = {
  archetypeId: string;
  changes: {
    itemsAdded: Array<{ name: string; ctaType: string; priceType: string }>;
    itemsRemoved: string[];      // Names of template items that were deactivated/deleted
    itemsRenamed: Array<{ from: string; to: string }>;
    categoriesUsed: string[];    // Categories the user actually uses
    sectionsAdded: Array<{ type: string; title: string }>;
    sectionsRemoved: string[];
    vocabularyOverrides?: Partial<ArchetypeVocabulary>;
  };
  summary: string;               // Human-readable description of changes
};
```

### 4.3 Contribution via Hive Mind

If the user's `contributionMode` is `selective` or `contribute_all`:

1. **Assessment**: The system evaluates the refinement:
   - Is it generalizable? (renamed "Check-up" to "NHS Band 1 Check" — UK-specific but valuable)
   - Does it contain proprietary data? (item names with brand-specific terms)
   - Would it improve the template for future users?

2. **Packaging**: If approved, the system:
   - Generates a patch to the archetype definition file (e.g., `packages/storefront-templates/src/archetypes/healthcare-wellness.ts`)
   - Creates a FeaturePack with the archetype refinement
   - Submits as a GitHub PR titled: `refine(archetype): dental-practice — add NHS band categories`

3. **PR Content**: The PR includes:
   - Updated item templates reflecting real-world usage
   - Updated category suggestions
   - Updated vocabulary if changed
   - A note: "This refinement is based on real-world usage by a dental practice in the UK"

### 4.4 MCP Tool: `assess_archetype_refinement`

```typescript
{
  name: "assess_archetype_refinement",
  description: "Compare the current storefront configuration against the original archetype template and generate a structured refinement diff",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
  requiredCapability: "view_storefront",
  sideEffect: false,
}
```

### 4.5 Refinement Contribution Flow (Agent-Guided)

The marketing specialist agent (on `/storefront`) gains a new skill:

```
Label: "Improve template"
Description: "Review how your configuration differs from the original template and contribute improvements"
Prompt: "Compare my current storefront configuration against the original archetype template. 
         Show me what I've changed (added items, removed sections, new categories). 
         Then ask if I'd like to contribute these improvements back to help future users 
         of the same business type."
```

## 5. Schema Changes Summary

```prisma
model StorefrontArchetype {
  // ... existing fields unchanged
  isBuiltIn        Boolean   @default(true)     // NEW: distinguishes pre-defined vs custom
  customVocabulary Json?                         // NEW: custom portal/stakeholder labels
}
```

**Migration**: Single migration adding two nullable columns with sensible defaults.

## 6. Files to Create or Modify

### New Files

| File | Purpose |
|---|---|
| `apps/web/components/storefront-admin/CustomArchetypeFlow.tsx` | AI-guided custom archetype creation UI |
| `apps/web/app/api/storefront/admin/archetypes/route.ts` | POST: Create custom archetype |
| `apps/web/app/api/storefront/admin/archetypes/refinement/route.ts` | GET: Generate refinement diff |

### Modified Files

| File | Change |
|---|---|
| `packages/db/prisma/schema.prisma` | Add `isBuiltIn` and `customVocabulary` to StorefrontArchetype |
| `apps/web/components/storefront-admin/SetupWizard.tsx` | Add "Other" card + custom definition flow |
| `apps/web/lib/storefront/archetype-vocabulary.ts` | Check `customVocabulary` before category fallback |
| `apps/web/lib/mcp-tools.ts` | Add `generate_custom_archetype` and `assess_archetype_refinement` tools |
| `apps/web/lib/tak/route-context-map.ts` | Add "Improve template" skill to /storefront route |
| `apps/web/app/(shell)/storefront/settings/page.tsx` | Add "Improve template" button |

## 7. Integration with Existing Systems

### Hive Mind Integration

Custom archetypes and refinements follow the same contribution pipeline as Build Studio features:

| Step | Custom Archetype | Archetype Refinement |
|---|---|---|
| Assessment | `assess_contribution` with archetype-specific criteria | `assess_archetype_refinement` (built-in diff) |
| Packaging | `contribute_to_hive` wrapping the archetype definition | `contribute_to_hive` wrapping the template patch |
| PR target | `packages/storefront-templates/src/archetypes/{category}.ts` | Same file, modifying existing archetype |
| PR label | `archetype-new`, `ai-contributed` | `archetype-refinement`, `ai-contributed` |
| DCO | Required (same as any contribution) | Required |

### Vocabulary Integration

Custom archetypes provide vocabulary through `customVocabulary` JSON:

```typescript
export function getVocabulary(category: string | null | undefined, customVocab?: Record<string, string> | null): ArchetypeVocabulary {
  const base = VOCABULARY[category ?? ""] ?? DEFAULT_VOCABULARY;
  if (!customVocab) return base;
  return { ...base, ...customVocab };
}
```

### Marketing Playbook Integration

Custom archetypes mapped to an existing category inherit that category's marketing playbook. Custom categories (truly novel business types) get the CTA-type fallback playbook until a category-specific one is contributed.

## 8. User Experience Walkthroughs

### Walkthrough A: Brewery Taproom (Custom Archetype)

1. User reaches Step 1 of setup, doesn't see "Brewery" in any category
2. Clicks "Define custom business model"
3. AI coworker asks: "What does your business do?"
4. User: "We're a craft brewery with a taproom. People come to drink beer, buy cans to take home, and book the space for private events."
5. AI generates:
   - CTA type: mixed (booking + purchase)
   - Items: "Taproom Table" (booking, 2hr), "Can Collection" (purchase), "Tasting Flight" (purchase), "Private Event" (inquiry), "Brewery Tour" (booking, 90min)
   - Sections: hero, items ("Taproom & Shop"), about ("Our Story"), gallery ("The Brewery"), contact
   - Vocabulary: portalLabel="Taproom", stakeholderLabel="Visitors", teamLabel="Staff"
6. User previews, adds "Gift Voucher" item, adjusts to Step 3
7. Custom archetype `custom-brewery-taproom` saved with `isBuiltIn: false`

### Walkthrough B: Dental Practice Refinement

1. Practice was set up with `dental-practice` archetype (default items: "Check-up Exam", "Scale & Polish", "Teeth Whitening", etc.)
2. Over 3 months, practice admin:
   - Renamed "Check-up Exam" → "NHS Band 1 Examination"
   - Added "NHS Band 2 Treatment" and "NHS Band 3 Treatment" items
   - Deactivated "Teeth Whitening" (they don't offer it)
   - Added category "NHS" and "Private" to organise items
3. Admin clicks "Improve template" in settings
4. System shows diff:
   - Items renamed: "Check-up Exam" → "NHS Band 1 Examination"
   - Items added: "NHS Band 2 Treatment", "NHS Band 3 Treatment"
   - Items removed: "Teeth Whitening"
   - Categories introduced: "NHS", "Private"
5. AI assesses: "These changes reflect UK NHS dental banding — valuable for UK dental practices. Recommend contributing as a UK-specific variant."
6. User approves contribution
7. PR created: `refine(archetype): dental-practice — add NHS band categorisation`

### Walkthrough C: HOA Refinement

1. HOA set up with `hoa-management` archetype
2. Board discovers they need "Architectural Review Request" (inquiry) and "Guest Pass" (booking) items not in the template
3. They add these items and categorise them under "Governance" and "Amenities"
4. After 2 months, board clicks "Improve template"
5. Diff shows 2 items added, categories refined
6. Contribution assessment: "Architectural review and guest passes are common HOA needs — high community value"
7. PR: `refine(archetype): hoa-management — add governance and amenity items`

## 9. Verification Plan

1. **Custom "Other" flow**: Select "Other" in wizard, complete AI interview, verify custom archetype is created with `isBuiltIn: false`
2. **Custom vocabulary**: Verify custom portalLabel/stakeholderLabel render in layout heading and tab nav
3. **Refinement diff**: Modify items/sections from built-in archetype, click "Improve template", verify diff is accurate
4. **Contribution flow**: In `selective` mode, approve a refinement contribution, verify PR is created targeting the archetype file
5. **Custom + contribution**: Create a custom archetype, use it for a while, then contribute it as a new archetype definition
6. **Vocabulary fallback**: Custom archetype with `closestCategory: "professional-services"` inherits professional services vocabulary, overridden by `customVocabulary` fields
7. **Re-seeding safety**: Run seed script, verify custom archetypes (`isBuiltIn: false`) are NOT overwritten

## 10. Out of Scope

- **Archetype marketplace**: Browseable catalog of community-contributed archetypes (future epic)
- **Archetype versioning**: Tracking multiple versions of the same archetype (v1, v2)
- **Automatic archetype migration**: When an upstream archetype improves, automatically applying changes to existing storefronts
- **Archetype preview from URL**: Auto-detecting archetype from a competitor's website (extends EP-SETUP-001 branding detection)
- **Custom category creation for marketing playbooks**: Custom categories get CTA-type fallback; a category-specific playbook requires a separate contribution
