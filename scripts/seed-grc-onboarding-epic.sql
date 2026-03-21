-- Seed GRC Onboarding epic
DO $$
DECLARE
  found_id TEXT;
  epic_id  TEXT;
BEGIN
  SELECT id INTO found_id FROM "Portfolio" WHERE slug = 'foundational';

  INSERT INTO "Epic" (id, "epicId", title, description, status, "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    'EP-' || gen_random_uuid()::text,
    'Regulation & Standards Onboarding',
    'Generic onboarding process for any regulation, standard, or framework. 4-step wizard, AI coworker entry point, sourceType extension, policy-obligation many-to-many, and critical UI enhancements.',
    'open', NOW(), NOW()
  ) RETURNING id INTO epic_id;

  IF found_id IS NOT NULL THEN
    INSERT INTO "EpicPortfolio" ("epicId", "portfolioId")
    VALUES (epic_id, found_id);
  END IF;
END $$;
