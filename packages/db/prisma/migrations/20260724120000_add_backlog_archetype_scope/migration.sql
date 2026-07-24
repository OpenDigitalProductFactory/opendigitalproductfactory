-- Additive scope metadata for backlog/epic roadmapping and investment planning.
-- @migration-safety: data-safe: only nullable columns and empty-array defaults are added; no existing row can violate these additions.

ALTER TABLE "BacklogItem"
  ADD COLUMN "scopeKind" TEXT,
  ADD COLUMN "archetypeCategories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "archetypeIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "scopeRationale" TEXT,
  ADD COLUMN "lifecycleTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Epic"
  ADD COLUMN "scopeKind" TEXT,
  ADD COLUMN "archetypeCategories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "archetypeIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "scopeRationale" TEXT,
  ADD COLUMN "lifecycleTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "BacklogItem_scopeKind_idx" ON "BacklogItem"("scopeKind");
CREATE INDEX "Epic_scopeKind_idx" ON "Epic"("scopeKind");

CREATE INDEX "BacklogItem_archetypeCategories_gin_idx" ON "BacklogItem" USING GIN ("archetypeCategories");
CREATE INDEX "BacklogItem_archetypeIds_gin_idx" ON "BacklogItem" USING GIN ("archetypeIds");
CREATE INDEX "BacklogItem_lifecycleTags_gin_idx" ON "BacklogItem" USING GIN ("lifecycleTags");

CREATE INDEX "Epic_archetypeCategories_gin_idx" ON "Epic" USING GIN ("archetypeCategories");
CREATE INDEX "Epic_archetypeIds_gin_idx" ON "Epic" USING GIN ("archetypeIds");
CREATE INDEX "Epic_lifecycleTags_gin_idx" ON "Epic" USING GIN ("lifecycleTags");

-- Conservative backfill for already-known planning scope. Do not classify rows
-- when the title/id does not provide a durable signal.
UPDATE "Epic"
SET
  "scopeKind" = 'archetype-leaf',
  "archetypeCategories" = ARRAY['fabric-care-services']::TEXT[],
  "archetypeIds" = ARRAY['dry-cleaning-plant-network']::TEXT[],
  "scopeRationale" = COALESCE("scopeRationale", 'Fabric-care vertical readiness gap captured after the fabric-care-services archetype was added.'),
  "lifecycleTags" = ARRAY['claim-ticket','asset-custody','route','pickup-delivery','ready-promise']::TEXT[]
WHERE "epicId" = 'EP-FABRIC-CARE-OPS';

UPDATE "BacklogItem"
SET
  "scopeKind" = 'archetype-leaf',
  "archetypeCategories" = ARRAY['fabric-care-services']::TEXT[],
  "archetypeIds" = ARRAY['dry-cleaning-plant-network']::TEXT[],
  "scopeRationale" = COALESCE("scopeRationale", 'Linked to EP-FABRIC-CARE-OPS fabric-care vertical readiness.'),
  "lifecycleTags" = CASE
    WHEN "title" ILIKE '%claim-ticket%' OR "title" ILIKE '%garment custody%' THEN ARRAY['claim-ticket','asset-custody']::TEXT[]
    WHEN "title" ILIKE '%plant%' OR "title" ILIKE '%satellite%' OR "title" ILIKE '%route%' THEN ARRAY['route','asset-custody','work-order']::TEXT[]
    WHEN "title" ILIKE '%ready%' OR "title" ILIKE '%ETA%' OR "title" ILIKE '%notification%' THEN ARRAY['ready-promise','notification']::TEXT[]
    WHEN "title" ILIKE '%storefront%' OR "title" ILIKE '%pickup-delivery%' THEN ARRAY['pickup-delivery','service-menu']::TEXT[]
    WHEN "title" ILIKE '%cockpit%' OR "title" ILIKE '%exception%' THEN ARRAY['exception-management','owner-cockpit']::TEXT[]
    ELSE ARRAY['vertical-readiness']::TEXT[]
  END
WHERE "epicId" IN (SELECT "id" FROM "Epic" WHERE "epicId" = 'EP-FABRIC-CARE-OPS');

UPDATE "Epic"
SET
  "scopeKind" = CASE
    WHEN "title" = 'Industry Vertical Readiness - IT managed services (MSP)' THEN 'archetype-leaf'
    ELSE 'archetype-category'
  END,
  "archetypeCategories" = CASE
    WHEN "title" = 'Industry Vertical Readiness - IT managed services (MSP)' THEN ARRAY['professional-services']::TEXT[]
    WHEN "title" = 'Industry Vertical Readiness - Beauty and personal care' THEN ARRAY['beauty-personal-care']::TEXT[]
    WHEN "title" = 'Industry Vertical Readiness - Healthcare and wellness' THEN ARRAY['healthcare-wellness']::TEXT[]
    WHEN "title" = 'Industry Vertical Readiness - Software platform' THEN ARRAY['software-platform']::TEXT[]
    WHEN "title" = 'Industry Vertical Readiness - Pet services' THEN ARRAY['pet-services']::TEXT[]
    WHEN "title" = 'Industry Vertical Readiness - Food and hospitality' THEN ARRAY['food-hospitality']::TEXT[]
    WHEN "title" = 'Industry Vertical Readiness - Retail and goods' THEN ARRAY['retail-goods']::TEXT[]
    WHEN "title" = 'Industry Vertical Readiness - Fitness and recreation' THEN ARRAY['fitness-recreation']::TEXT[]
    WHEN "title" = 'Industry Vertical Readiness - Education and training' THEN ARRAY['education-training']::TEXT[]
    WHEN "title" = 'Industry Vertical Readiness - Professional services' THEN ARRAY['professional-services']::TEXT[]
    WHEN "title" = 'Industry Vertical Readiness - Nonprofit and community' THEN ARRAY['nonprofit-community']::TEXT[]
    WHEN "title" = 'Industry Vertical Readiness - HOA and property management' THEN ARRAY['hoa-property-management']::TEXT[]
    WHEN "title" = 'Industry Vertical Readiness - Banking and financial services' THEN ARRAY['banking-financial-services']::TEXT[]
    WHEN "title" = 'Industry Vertical Readiness - Public sector and civic' THEN ARRAY['public-sector']::TEXT[]
    WHEN "title" = 'Industry Vertical Readiness - Asset rental' THEN ARRAY['asset-rental']::TEXT[]
    WHEN "title" = 'Industry Vertical Readiness - Real estate and construction' THEN ARRAY['real-estate-construction']::TEXT[]
    WHEN "title" = 'Industry Vertical Readiness - Automotive services' THEN ARRAY['automotive-services']::TEXT[]
    WHEN "title" = 'Industry Vertical Readiness - Moving and logistics' THEN ARRAY['moving-and-logistics']::TEXT[]
    WHEN "title" = 'Industry Vertical Readiness - Security services' THEN ARRAY['security-services']::TEXT[]
    WHEN "title" = 'Industry Vertical Readiness - Media production' THEN ARRAY['media-production']::TEXT[]
    WHEN "title" = 'Industry Vertical Readiness - Live events and venues' THEN ARRAY['live-events-venues']::TEXT[]
    ELSE "archetypeCategories"
  END,
  "archetypeIds" = CASE
    WHEN "title" = 'Industry Vertical Readiness - IT managed services (MSP)' THEN ARRAY['it-managed-services']::TEXT[]
    ELSE "archetypeIds"
  END,
  "scopeRationale" = COALESCE("scopeRationale", 'Vertical readiness epic; title maps directly to an archetype category or leaf archetype.'),
  "lifecycleTags" = CASE WHEN cardinality("lifecycleTags") = 0 THEN ARRAY['vertical-readiness']::TEXT[] ELSE "lifecycleTags" END
WHERE "title" LIKE 'Industry Vertical Readiness - %';

UPDATE "BacklogItem"
SET
  "scopeKind" = e."scopeKind",
  "archetypeCategories" = e."archetypeCategories",
  "archetypeIds" = e."archetypeIds",
  "scopeRationale" = COALESCE("BacklogItem"."scopeRationale", 'Inherited from vertical readiness epic scope.'),
  "lifecycleTags" = CASE WHEN cardinality("BacklogItem"."lifecycleTags") = 0 THEN ARRAY['vertical-readiness']::TEXT[] ELSE "BacklogItem"."lifecycleTags" END
FROM "Epic" e
WHERE "BacklogItem"."epicId" = e."id"
  AND e."scopeKind" IN ('archetype-category', 'archetype-leaf')
  AND e."title" LIKE 'Industry Vertical Readiness - %';

UPDATE "Epic"
SET
  "scopeKind" = 'common',
  "scopeRationale" = COALESCE("scopeRationale", 'Common company capability used across archetypes, not specific to one vertical.'),
  "lifecycleTags" = CASE WHEN cardinality("lifecycleTags") = 0 THEN ARRAY['common-substrate']::TEXT[] ELSE "lifecycleTags" END
WHERE "epicId" IN (
  'EP-FINANCE-ACCOUNTING-CORE',
  'EP-QUICKBOOKS-ACCOUNTING-BRIDGE',
  'EP-PAYROLL-COMP-BENEFITS',
  'EP-WORKFORCE-OPS',
  'EP-PEOPLE-HCM-CORE',
  'EP-COMPANY-IAM-FOUNDATION',
  'EP-ENTERPRISE-SSO-DIRECTORY',
  'EP-COMPANY-AUTHZ-FGA',
  'EP-IAM-ADMIN-PORTAL-AUDIT',
  'EP-AGENT-AUTH-VAULT'
);

UPDATE "Epic"
SET
  "scopeKind" = 'platform',
  "scopeRationale" = COALESCE("scopeRationale", 'DPF platform/internal operating substrate rather than archetype-specific customer functionality.'),
  "lifecycleTags" = CASE WHEN cardinality("lifecycleTags") = 0 THEN ARRAY['platform-substrate']::TEXT[] ELSE "lifecycleTags" END
WHERE "epicId" IN (
  'EP-LIFECYCLE',
  'EP-UX-SYSTEM',
  'EP-UX-COGLOAD',
  'EP-UPGRADE-LIFECYCLE',
  'EP-WORKTREE-HYGIENE',
  'EP-BUILD-STUDIO',
  'EP-UNIFIED-TRACKING',
  'EP-DATA-GOVERNANCE',
  'EP-DATA-RETENTION'
);

UPDATE "BacklogItem"
SET
  "scopeKind" = e."scopeKind",
  "scopeRationale" = COALESCE("BacklogItem"."scopeRationale", 'Inherited from parent epic scope.'),
  "lifecycleTags" = CASE WHEN cardinality("BacklogItem"."lifecycleTags") = 0 THEN e."lifecycleTags" ELSE "BacklogItem"."lifecycleTags" END
FROM "Epic" e
WHERE "BacklogItem"."epicId" = e."id"
  AND e."scopeKind" IN ('common', 'platform')
  AND "BacklogItem"."scopeKind" IS NULL;
