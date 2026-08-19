// Taxonomy & archetype tool pack — EP-8DC217EB BET-4.
//
// Drains the "taxonomy & archetype" domain out of the mcp-tools.ts executeTool
// switch: the tools a coworker uses to place a feature build in the portfolio
// taxonomy (suggest / confirm), to author a custom storefront archetype and
// assess how a live storefront has diverged from its template, and to pre-fill
// the regulation onboarding wizard. Each handler reproduces the former switch
// case verbatim, so behaviour is identical when a tool is invoked over MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source. The
// build-resolution helpers (extractBuildIdHint / resolveActiveBuildId /
// updateBuildHappyPathState / TERMINAL_BUILD_PHASES) are broadly shared by many
// inline build tools, so local copies are replicated here and the originals are
// left inline in mcp-tools.ts.

import { prisma } from "@dpf/db";
import { slugify } from "@/lib/shared/slugify";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";
import {
  resolveActiveBuildId,
  extractBuildIdHint,
  updateBuildHappyPathState,
} from "@/lib/mcp/build-tool-helpers";

const definitions: ToolDefinition[] = [
  {
    name: "generate_custom_archetype",
    description: "Generate a custom business archetype from a description of the business, its offerings, and customer interaction patterns. Creates a new StorefrontArchetype record.",
    inputSchema: {
      type: "object",
      properties: {
        businessName: { type: "string", description: "Name of the business type (e.g. 'Co-working Space')" },
        businessDescription: { type: "string", description: "What the business does" },
        offerings: { type: "array", items: { type: "string" }, description: "List of products/services offered" },
        primaryCtaType: { type: "string", enum: ["booking", "purchase", "inquiry", "donation", "mixed"], description: "How customers primarily interact" },
        stakeholderLabel: { type: "string", description: "What to call the customers (Members, Clients, Patients, etc.)" },
        portalLabel: { type: "string", description: "What to call the portal (Member Portal, Client Portal, etc.)" },
        closestCategory: { type: "string", description: "Closest existing archetype category or 'custom'" },
      },
      required: ["businessName", "businessDescription", "offerings", "primaryCtaType"],
    },
    requiredCapability: "view_storefront",
    sideEffect: true,
  },
  {
    name: "assess_archetype_refinement",
    description: "Compare the current storefront configuration against the original archetype template and return a structured refinement diff showing what items, sections, and categories have changed",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    requiredCapability: "view_storefront",
    sideEffect: false,
  },
  {
    name: "suggest_taxonomy_placement",
    description: "Analyze the current feature brief and suggest where it belongs in the portfolio taxonomy. Returns ranked candidates with match scores. Call after saving the feature brief.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    buildPhases: ["ideate"],
  },
  {
    name: "confirm_taxonomy_placement",
    description: "Confirm or override the taxonomy placement for the current feature build. Either confirm an existing node or propose a new one.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "Confirmed taxonomy node ID (e.g. 'foundational/platform_services/api_management_platform'). Null if proposing new." },
        proposeNew: {
          type: "object",
          description: "Propose a new taxonomy node when nothing fits",
          properties: {
            parentNodeId: { type: "string", description: "Parent node ID to create under" },
            name: { type: "string", description: "Proposed node name" },
            description: { type: "string", description: "What this capability area covers" },
            rationale: { type: "string", description: "Why existing nodes don't fit" },
          },
          required: ["parentNodeId", "name", "description", "rationale"],
        },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate", "plan", "ship"],
  },
  {
    name: "prefill_onboarding_wizard",
    description: "Pre-fill the regulation onboarding wizard with AI-drafted data. Stores a draft and returns the wizard URL for human review.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Full regulation/standard name" },
        shortName: { type: "string", description: "Abbreviation (e.g., GDPR, WCAG)" },
        sourceType: { type: "string", enum: ["external", "standard", "framework", "internal"], description: "Type of regulation/standard" },
        jurisdiction: { type: "string", description: "Geographic scope (e.g., EU, UK, Global)" },
        industry: { type: "string", description: "Industry applicability" },
        sourceUrl: { type: "string", description: "URL to official text" },
        obligations: {
          type: "array",
          description: "Extracted obligations",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              reference: { type: "string" },
              category: { type: "string" },
              frequency: { type: "string" },
              applicability: { type: "string" },
              description: { type: "string" },
            },
            required: ["title"],
          },
        },
        suggestedControls: {
          type: "array",
          description: "Suggested control mappings",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              controlType: { type: "string", enum: ["preventive", "detective", "corrective"] },
              linkedObligationIndices: { type: "array", items: { type: "number" } },
            },
            required: ["title", "controlType"],
          },
        },
      },
      required: ["name", "shortName", "sourceType"],
    },
    requiredCapability: "manage_compliance",
    sideEffect: true,
  },
];

// ─── Handlers ───────────────────────────────────────────────────────────────

async function generateCustomArchetypeHandler(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const businessName = String(params["businessName"] ?? "Custom Business");
  const offerings = Array.isArray(params["offerings"]) ? params["offerings"] as string[] : [];
  const primaryCtaType = String(params["primaryCtaType"] ?? "inquiry");
  const stakeholderLabel = typeof params["stakeholderLabel"] === "string" ? params["stakeholderLabel"] : "Customers";
  const portalLabel = typeof params["portalLabel"] === "string" ? params["portalLabel"] : "Portal";
  const closestCategory = typeof params["closestCategory"] === "string" ? params["closestCategory"] : "professional-services";

  if (offerings.length === 0) {
    return { success: false, message: "At least one offering is required in the 'offerings' array." };
  }

  // Generate archetypeId
  const slug = slugify(businessName);
  const archetypeId = `custom-${slug}`;

  // Check for duplicate
  const existingArch = await prisma.storefrontArchetype.findUnique({ where: { archetypeId } });
  if (existingArch) {
    return { success: false, message: `Archetype "${archetypeId}" already exists. Choose a different name.` };
  }

  // Infer price type from CTA
  const defaultPriceType: Record<string, string> = {
    booking: "per-session", purchase: "fixed", inquiry: "quote", donation: "donation", mixed: "fixed",
  };

  // Generate item templates from offerings
  const itemTemplates = offerings.map((name) => ({
    name,
    description: "",
    priceType: defaultPriceType[primaryCtaType] ?? "quote",
    ...(primaryCtaType === "booking" ? { bookingDurationMinutes: 60 } : {}),
  }));

  // Generate section templates
  const sectionTemplates = [
    { type: "hero", title: "Welcome", sortOrder: 0 },
    { type: "items", title: offerings.length > 3 ? "What We Offer" : "Services", sortOrder: 1 },
    { type: "about", title: "About Us", sortOrder: 2 },
    { type: "gallery", title: "Gallery", sortOrder: 3 },
    { type: "testimonials", title: "Testimonials", sortOrder: 4 },
    { type: "contact", title: "Get in Touch", sortOrder: 5 },
  ];

  // Generate form schema
  const formSchema = [
    { name: "name", label: "Name", type: "text", required: true },
    { name: "email", label: "Email", type: "email", required: true },
    { name: "phone", label: "Phone", type: "tel", required: false },
    { name: "message", label: "Message", type: "textarea", required: false },
  ];

  // Generate tags from business name and offerings
  const tags = [
    ...businessName.toLowerCase().split(/\s+/),
    ...offerings.map((o) => o.toLowerCase()),
  ].slice(0, 15);

  const category = closestCategory === "custom" ? slug : closestCategory;

  const archetype = await prisma.storefrontArchetype.create({
    data: {
      archetypeId,
      name: businessName,
      category,
      ctaType: primaryCtaType === "mixed" ? "inquiry" : primaryCtaType,
      itemTemplates,
      sectionTemplates,
      formSchema,
      tags,
      isActive: true,
      isBuiltIn: false,
      customVocabulary: { portalLabel, stakeholderLabel },
    },
  });

  return {
    success: true,
    entityId: archetype.archetypeId,
    message: `Custom archetype "${businessName}" created as ${archetypeId}. You can now select it in the setup wizard.`,
    data: {
      archetypeId: archetype.archetypeId,
      name: archetype.name,
      category: archetype.category,
      ctaType: archetype.ctaType,
      itemCount: itemTemplates.length,
      sectionCount: sectionTemplates.length,
    },
  };
}

async function assessArchetypeRefinementHandler(): Promise<ToolResult> {
  const config = await prisma.storefrontConfig.findFirst({
    include: { archetype: true },
  });

  if (!config) {
    return { success: false, message: "No storefront configured." };
  }

  const archetype = config.archetype;
  const originalItems = (archetype.itemTemplates as Array<{ name: string }>) ?? [];
  const originalSections = (archetype.sectionTemplates as Array<{ type: string; title: string }>) ?? [];

  const [liveItems, liveSections] = await Promise.all([
    prisma.storefrontItem.findMany({
      where: { storefrontId: config.id },
      select: { name: true, category: true, ctaType: true, priceType: true, isActive: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.storefrontSection.findMany({
      where: { storefrontId: config.id },
      select: { type: true, title: true, isVisible: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  const originalItemNames = new Set(originalItems.map((i) => i.name));
  const liveItemNames = new Set(liveItems.map((i) => i.name));

  const itemsAdded = liveItems.filter((i) => !originalItemNames.has(i.name) && i.isActive)
    .map((i) => ({ name: i.name, ctaType: i.ctaType, priceType: i.priceType, category: i.category }));
  const itemsRemoved = originalItems.filter((i) => !liveItemNames.has(i.name)).map((i) => i.name);
  const itemsDeactivated = liveItems.filter((i) => originalItemNames.has(i.name) && !i.isActive).map((i) => i.name);
  const categoriesUsed = [...new Set(liveItems.map((i) => i.category).filter(Boolean))];

  const originalSectionTypes = new Set(originalSections.map((s) => s.type));
  const sectionsAdded = liveSections.filter((s) => !originalSectionTypes.has(s.type) && s.isVisible)
    .map((s) => ({ type: s.type, title: s.title }));
  const sectionsHidden = liveSections.filter((s) => originalSectionTypes.has(s.type) && !s.isVisible)
    .map((s) => s.type);

  const hasChanges = itemsAdded.length > 0 || itemsRemoved.length > 0 || itemsDeactivated.length > 0 ||
    sectionsAdded.length > 0 || sectionsHidden.length > 0 || categoriesUsed.length > 0;

  const summaryParts: string[] = [];
  if (itemsAdded.length > 0) summaryParts.push(`${itemsAdded.length} item(s) added`);
  if (itemsRemoved.length > 0) summaryParts.push(`${itemsRemoved.length} template item(s) removed`);
  if (itemsDeactivated.length > 0) summaryParts.push(`${itemsDeactivated.length} template item(s) deactivated`);
  if (sectionsAdded.length > 0) summaryParts.push(`${sectionsAdded.length} section(s) added`);
  if (sectionsHidden.length > 0) summaryParts.push(`${sectionsHidden.length} section(s) hidden`);
  if (categoriesUsed.length > 0) summaryParts.push(`categories: ${categoriesUsed.join(", ")}`);

  return {
    success: true,
    message: hasChanges
      ? `Your ${archetype.name} configuration has diverged from the original template: ${summaryParts.join("; ")}. These refinements could improve the template for future users of this business type.`
      : `Your configuration matches the original ${archetype.name} template — no refinements to contribute.`,
    data: {
      archetypeId: archetype.archetypeId,
      archetypeName: archetype.name,
      isBuiltIn: archetype.isBuiltIn,
      hasChanges,
      changes: { itemsAdded, itemsRemoved, itemsDeactivated, categoriesUsed, sectionsAdded, sectionsHidden },
    },
  };
}

async function suggestTaxonomyPlacementHandler(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build", message: "No active build found" };
  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { brief: true },
  });
  if (!build?.brief) return { success: false, error: "No brief saved", message: "Save the feature brief first before requesting taxonomy placement." };
  const briefData = build.brief as Record<string, unknown>;
  const { attributeFeatureBuild, formatAttributionRecommendation } = await import("@/lib/build/feature-attribution");
  const attribution = await attributeFeatureBuild(buildId, {
    title: String(briefData.title ?? ""),
    description: String(briefData.description ?? ""),
    portfolioContext: String(briefData.portfolioContext ?? ""),
    acceptanceCriteria: Array.isArray(briefData.acceptanceCriteria) ? briefData.acceptanceCriteria.map(String) : [],
    targetRoles: Array.isArray(briefData.targetRoles) ? briefData.targetRoles.map(String) : [],
    dataNeeds: String(briefData.dataNeeds ?? ""),
  });
  // Persist attribution result on the build
  await prisma.featureBuild.update({
    where: { buildId },
    data: { taxonomyAttribution: attribution as unknown as import("@dpf/db").Prisma.InputJsonValue },
  });
  const recommendation = formatAttributionRecommendation(attribution);
  return {
    success: true,
    entityId: buildId,
    message: recommendation,
    data: {
      method: attribution.method,
      confidence: attribution.confidence,
      invalidPortfolioContext: attribution.invalidPortfolioContext ?? null,
      validPortfolioOptions: attribution.validPortfolioOptions ?? [],
      topCandidate: attribution.topCandidate,
      candidates: attribution.candidates,
    },
  };
}

async function confirmTaxonomyPlacementHandler(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  try {
    const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
    if (!buildId) return { success: false, error: "No active build", message: "No active build found" };
    const { confirmFeatureTaxonomy } = await import("@/lib/build/feature-attribution");
    const nodeId = params["nodeId"] ? String(params["nodeId"]) : null;
    // Validate proposeNew structure before passing to Prisma.
    // Models often send proposeNew with empty strings alongside a valid nodeId
    // (filling in the schema shape). Ignore proposeNew when fields are empty —
    // only treat it as a real proposal when parentNodeId and name are non-empty.
    let proposeNew: { parentNodeId: string; name: string; description: string; rationale: string } | undefined;
    if (params["proposeNew"] && typeof params["proposeNew"] === "object") {
      const raw = params["proposeNew"] as Record<string, unknown>;
      const parentNodeId = typeof raw["parentNodeId"] === "string" ? raw["parentNodeId"].trim() : "";
      const name = typeof raw["name"] === "string" ? raw["name"].trim() : "";
      const description = typeof raw["description"] === "string" ? raw["description"] : "";
      const rationale = typeof raw["rationale"] === "string" ? raw["rationale"] : "";
      if (parentNodeId && name) {
        proposeNew = { parentNodeId, name, description, rationale };
      }
      // When parentNodeId/name are empty, silently ignore proposeNew — fall through to nodeId path
    }
    const result = await confirmFeatureTaxonomy(buildId, nodeId, proposeNew);
    if (result.success && result.confirmedNodeId) {
      await updateBuildHappyPathState(userId, {
        intake: {
          taxonomyNodeId: result.confirmedNodeId,
        },
      }, buildId);
    }
    return {
      success: result.success,
      entityId: buildId,
      message: result.message,
      data: {
        confirmedNodeId: result.confirmedNodeId ?? null,
        proposalId: result.proposalId ?? null,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[confirm_taxonomy_placement] Error:`, msg);
    return { success: false, error: msg, message: `Taxonomy placement failed: ${msg}` };
  }
}

async function prefillOnboardingWizardHandler(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  const data = {
    name: String(params["name"] ?? ""),
    shortName: String(params["shortName"] ?? ""),
    sourceType: String(params["sourceType"] ?? "external"),
    jurisdiction: String(params["jurisdiction"] ?? ""),
    industry: params["industry"] ? String(params["industry"]) : null,
    sourceUrl: params["sourceUrl"] ? String(params["sourceUrl"]) : null,
    obligations: Array.isArray(params["obligations"]) ? params["obligations"] : [],
    suggestedControls: Array.isArray(params["suggestedControls"]) ? params["suggestedControls"] : [],
  };

  const draft = await prisma.onboardingDraft.create({
    data: {
      data: data as any,
      createdBy: userId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  const wizardUrl = `/compliance/onboard?draft=${draft.id}`;
  return {
    success: true,
    message: `Onboarding draft created. Navigate to ${wizardUrl} to review and commit.`,
    data: { wizardUrl, draftId: draft.id },
  };
}

const handlers: Record<string, ToolPackHandler> = {
  generate_custom_archetype: (params) => generateCustomArchetypeHandler(params),
  assess_archetype_refinement: () => assessArchetypeRefinementHandler(),
  suggest_taxonomy_placement: (params, userId) => suggestTaxonomyPlacementHandler(params, userId),
  confirm_taxonomy_placement: (params, userId) => confirmTaxonomyPlacementHandler(params, userId),
  prefill_onboarding_wizard: (params, userId) => prefillOnboardingWizardHandler(params, userId),
};

export const taxonomyArchetypePack: ToolPack = {
  packId: "taxonomy-archetype",
  definitions,
  handlers,
  grants: {
    generate_custom_archetype: ["marketing_write"],
    assess_archetype_refinement: ["marketing_read"],
    suggest_taxonomy_placement: ["registry_read"],
    confirm_taxonomy_placement: ["backlog_write"],
    prefill_onboarding_wizard: ["data_governance_validate"],
  },
};
