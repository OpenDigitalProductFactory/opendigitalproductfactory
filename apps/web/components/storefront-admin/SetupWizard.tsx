"use client";
import { useState } from "react";
import { FinancialSetupStep } from "./FinancialSetupStep";

type Archetype = {
  archetypeId: string;
  name: string;
  category: string;
  ctaType: string;
  tags: unknown;
  itemTemplates: unknown;
  sectionTemplates: unknown;
  isBuiltIn?: boolean;
};

type Step = 1 | 2 | 3 | 4 | "custom";

type SetupWizardProps = {
  archetypes: Archetype[];
  orgNameFromDb?: string | null;
  suggestedArchetypeId?: string | null;
  suggestedArchetypeName?: string | null;
  archetypeConfidence?: "high" | "medium" | null;
  suggestedCompanyName?: string | null;
  suggestedCurrency?: string | null;
};

// Map storefront archetype category to finance profile slug
function financeSlugFromCategory(category: string): string {
  const map: Record<string, string> = {
    "healthcare-wellness": "healthcare_wellness",
    "beauty-personal-care": "beauty_personal",
    "trades-maintenance": "trades_construction",
    "professional-services": "professional_services",
    "education-training": "education_training",
    "pet-services": "pet_services",
    "food-hospitality": "food_hospitality",
    "retail-goods": "retail",
    "fitness-recreation": "fitness_recreation",
    "nonprofit-community": "nonprofit",
  };
  return map[category] ?? "professional_services";
}

const CATEGORY_OPTIONS = [
  { value: "healthcare-wellness", label: "Healthcare & Wellness" },
  { value: "beauty-personal-care", label: "Beauty & Personal Care" },
  { value: "trades-maintenance", label: "Trades & Maintenance" },
  { value: "professional-services", label: "Professional Services" },
  { value: "education-training", label: "Education & Training" },
  { value: "pet-services", label: "Pet Services" },
  { value: "food-hospitality", label: "Food & Hospitality" },
  { value: "retail-goods", label: "Retail & Goods" },
  { value: "fitness-recreation", label: "Fitness & Recreation" },
  { value: "nonprofit-community", label: "Nonprofit & Community" },
  { value: "hoa-property-management", label: "HOA & Property Management" },
  { value: "custom", label: "Other / New category" },
];

const CTA_OPTIONS = [
  { value: "booking", label: "Booking", description: "Customers book appointments or sessions" },
  { value: "purchase", label: "Purchase", description: "Customers buy products or pay for services" },
  { value: "inquiry", label: "Inquiry", description: "Customers request quotes or information" },
  { value: "donation", label: "Donation", description: "Supporters donate to a cause" },
];

const COMPANY_SIZE_OPTIONS = [
  { value: "solo", label: "Solo", description: "Just me" },
  { value: "small", label: "Small", description: "2-10 people" },
  { value: "medium", label: "Medium", description: "11-50 people" },
  { value: "large", label: "Large", description: "50+ people" },
];

const GEOGRAPHIC_SCOPE_OPTIONS = [
  { value: "local", label: "Local", description: "City or neighborhood" },
  { value: "regional", label: "Regional", description: "State or region" },
  { value: "national", label: "National", description: "Entire country" },
  { value: "international", label: "International", description: "Multiple countries" },
];

const CATEGORY_PLACEHOLDERS: Record<string, { description: string; targetMarket: string }> = {
  "healthcare-wellness": {
    description: "We provide quality healthcare services to improve our patients' wellbeing.",
    targetMarket: "Individuals and families seeking healthcare",
  },
  "beauty-personal-care": {
    description: "We help clients look and feel their best with professional beauty services.",
    targetMarket: "Individuals seeking personal care and beauty treatments",
  },
  "trades-maintenance": {
    description: "We provide reliable trade and maintenance services for homes and businesses.",
    targetMarket: "Homeowners and property managers",
  },
  "professional-services": {
    description: "We deliver expert professional services tailored to our clients' needs.",
    targetMarket: "Businesses and individuals seeking professional expertise",
  },
  "education-training": {
    description: "We empower learners with courses, training, and educational programs.",
    targetMarket: "Students, professionals, and lifelong learners",
  },
  "pet-services": {
    description: "We provide caring, professional services for pets and their owners.",
    targetMarket: "Pet owners in your local area",
  },
  "food-hospitality": {
    description: "We serve great food and memorable hospitality experiences.",
    targetMarket: "Diners, event planners, and food enthusiasts",
  },
  "retail-goods": {
    description: "We sell quality products that our customers love.",
    targetMarket: "Shoppers looking for quality goods",
  },
  "fitness-recreation": {
    description: "We help people stay active and healthy through fitness and recreation.",
    targetMarket: "Fitness enthusiasts and active individuals",
  },
  "nonprofit-community": {
    description: "We serve our community through programs, outreach, and support services.",
    targetMarket: "Community members and supporters",
  },
  "hoa-property-management": {
    description: "We manage properties and communities to keep things running smoothly.",
    targetMarket: "Residents, tenants, and property owners",
  },
};

export function SetupWizard({
  archetypes,
  orgNameFromDb,
  suggestedArchetypeId,
  suggestedArchetypeName,
  archetypeConfidence,
  suggestedCompanyName,
  suggestedCurrency,
}: SetupWizardProps) {
  const [step, setStep] = useState<Step>(1);
  const [selected, setSelected] = useState<Archetype | null>(null);
  const [search, setSearch] = useState("");
  const [orgName, setOrgName] = useState(orgNameFromDb ?? suggestedCompanyName ?? "");
  const [orgSlug, setOrgSlug] = useState("store");
  const [tagline, setTagline] = useState("");
  const [heroImageUrl, setHeroImageUrl] = useState("");
  const [businessDescription, setBusinessDescription] = useState("");
  const [targetMarket, setTargetMarket] = useState("");
  const [companySize, setCompanySize] = useState<string | null>(null);
  const [geographicScope, setGeographicScope] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Custom archetype state
  const [customName, setCustomName] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customCategory, setCustomCategory] = useState("professional-services");
  const [customCtaType, setCustomCtaType] = useState("inquiry");
  const [customOfferings, setCustomOfferings] = useState("");
  const [customPortalLabel, setCustomPortalLabel] = useState("");
  const [customStakeholderLabel, setCustomStakeholderLabel] = useState("");
  const [customCreating, setCustomCreating] = useState(false);

  // Derive slug from name
  function derivedSlug(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  const builtIn = archetypes.filter((a) => a.isBuiltIn !== false);
  const custom = archetypes.filter((a) => a.isBuiltIn === false);
  const categories = Array.from(new Set(builtIn.map((a) => a.category))).sort();
  const filtered = builtIn.filter((a) =>
    !search || a.name.toLowerCase().includes(search.toLowerCase()) || a.category.includes(search.toLowerCase())
  );

  async function handleComplete() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/storefront/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          archetypeId: selected!.archetypeId,
          orgName,
          orgSlug,
          tagline,
          heroImageUrl: heroImageUrl || null,
          businessDescription: businessDescription || null,
          targetMarket: targetMarket || null,
          companySize,
          geographicScope,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Setup failed");
      }
      // Move to financial setup step
      setStep(4);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Setup failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateCustom() {
    setError(null);
    setCustomCreating(true);
    try {
      const offerings = customOfferings.split("\n").map((s) => s.trim()).filter(Boolean);
      if (offerings.length === 0) {
        setError("Add at least one offering (one per line)");
        return;
      }

      const res = await fetch("/api/storefront/admin/archetypes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: customName,
          category: customCategory === "custom" ? customName.toLowerCase().replace(/[^a-z0-9]+/g, "-") : customCategory,
          ctaType: customCtaType,
          itemTemplates: offerings.map((name) => ({
            name,
            description: "",
            priceType: customCtaType === "booking" ? "per-session" : customCtaType === "purchase" ? "fixed" : customCtaType === "donation" ? "donation" : "quote",
            ...(customCtaType === "booking" ? { bookingDurationMinutes: 60 } : {}),
          })),
          sectionTemplates: [
            { type: "hero", title: "Welcome", sortOrder: 0 },
            { type: "items", title: "What We Offer", sortOrder: 1 },
            { type: "about", title: "About Us", sortOrder: 2 },
            { type: "gallery", title: "Gallery", sortOrder: 3 },
            { type: "contact", title: "Get in Touch", sortOrder: 4 },
          ],
          formSchema: [
            { name: "name", label: "Name", type: "text", required: true },
            { name: "email", label: "Email", type: "email", required: true },
            { name: "phone", label: "Phone", type: "tel", required: false },
            { name: "message", label: "Message", type: "textarea", required: false },
          ],
          tags: [
            ...customName.toLowerCase().split(/\s+/),
            ...offerings.map((o) => o.toLowerCase()),
          ].slice(0, 15),
          customVocabulary: {
            ...(customPortalLabel && { portalLabel: customPortalLabel }),
            ...(customStakeholderLabel && { stakeholderLabel: customStakeholderLabel }),
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to create archetype");
      }

      const created = await res.json();

      // Select the newly created archetype and go to preview
      setSelected({
        archetypeId: created.archetypeId,
        name: created.name,
        category: created.category,
        ctaType: created.ctaType,
        tags: created.tags,
        itemTemplates: created.itemTemplates,
        sectionTemplates: created.sectionTemplates,
        isBuiltIn: false,
      });
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create archetype");
    } finally {
      setCustomCreating(false);
    }
  }

  // ─── Step 1: Choose Archetype ───────────────────────────────────────

  if (step === 1) {
    return (
      <div style={{ color: "var(--dpf-text)" }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Choose your business type</h2>

        {suggestedArchetypeId && suggestedArchetypeName && (
          <div style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid var(--dpf-accent)",
            background: "color-mix(in srgb, var(--dpf-accent) 10%, transparent)",
            marginBottom: 16,
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}>
            <span style={{ fontWeight: 600 }}>Suggested:</span>
            <span>{suggestedArchetypeName}</span>
            {archetypeConfidence === "high" && (
              <span style={{ fontSize: 11, color: "var(--dpf-muted)" }}>(high confidence)</span>
            )}
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--dpf-muted)" }}>
              Detected from your branding URL — scroll down to find it highlighted
            </span>
          </div>
        )}

        <input
          type="search"
          placeholder="Search archetypes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: "100%", maxWidth: 360, padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dpf-border)", fontSize: 14, marginBottom: 16, color: "var(--dpf-text)", background: "var(--dpf-surface-1)" }}
        />
        {categories.map((cat) => {
          const items = filtered.filter((a) => a.category === cat);
          if (!items.length) return null;
          return (
            <div key={cat} style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--dpf-muted)", marginBottom: 8 }}>
                {cat.replace(/-/g, " ")}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
                {items.map((a) => {
                  const isSuggested = a.archetypeId === suggestedArchetypeId;
                  return (
                    <button key={a.archetypeId} onClick={() => { setSelected(a); setStep(2); }}
                      style={{
                        padding: "12px 16px",
                        textAlign: "left",
                        borderRadius: 8,
                        border: isSuggested ? "2px solid var(--dpf-accent)" : "1px solid var(--dpf-border)",
                        background: isSuggested ? "color-mix(in srgb, var(--dpf-accent) 8%, var(--dpf-surface-1))" : "var(--dpf-surface-1)",
                        cursor: "pointer",
                        fontSize: 13,
                        color: "var(--dpf-text)",
                      }}>
                      <div style={{ fontWeight: 600 }}>{a.name}</div>
                      {isSuggested && (
                        <div style={{ fontSize: 11, color: "var(--dpf-accent)", marginTop: 2 }}>Suggested for you</div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Custom archetypes section */}
        {custom.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--dpf-muted)", marginBottom: 8 }}>
              Custom business types
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
              {custom.map((a) => (
                <button key={a.archetypeId} onClick={() => { setSelected(a); setStep(2); }}
                  style={{
                    padding: "12px 16px", textAlign: "left", borderRadius: 8,
                    border: "1px dashed var(--dpf-border)", background: "var(--dpf-surface-1)",
                    cursor: "pointer", fontSize: 13, color: "var(--dpf-text)",
                  }}>
                  <div style={{ fontWeight: 600 }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>Custom</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* "Other" card */}
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => setStep("custom")}
            style={{
              width: "100%", padding: "16px 20px", textAlign: "left", borderRadius: 8,
              border: "1px dashed var(--dpf-accent)", cursor: "pointer", fontSize: 13,
              color: "var(--dpf-text)",
              background: "color-mix(in srgb, var(--dpf-accent) 5%, var(--dpf-surface-1))",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Can't find your business?</div>
            <div style={{ fontSize: 12, color: "var(--dpf-muted)" }}>
              Define a custom business model. Your template can also be contributed back to help others.
            </div>
          </button>
        </div>
      </div>
    );
  }

  // ─── Custom Archetype Definition ──────────────────────────────────────

  if (step === "custom") {
    return (
      <div style={{ maxWidth: 520, color: "var(--dpf-text)" }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Define your business model</h2>
        <p style={{ fontSize: 13, color: "var(--dpf-muted)", marginBottom: 16 }}>
          Tell us about your business and we'll create a custom template.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ fontSize: 13 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Business type name *</div>
            <input type="text" value={customName} onChange={(e) => setCustomName(e.target.value)}
              placeholder="e.g. Brewery Taproom, Dog Daycare, Co-working Space"
              required style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dpf-border)", fontSize: 14, color: "var(--dpf-text)", background: "var(--dpf-surface-1)" }} />
          </label>

          <label style={{ fontSize: 13 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>What does this business do?</div>
            <textarea value={customDescription} onChange={(e) => setCustomDescription(e.target.value)}
              placeholder="Brief description of the business..."
              rows={2} style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dpf-border)", fontSize: 14, color: "var(--dpf-text)", background: "var(--dpf-surface-1)", resize: "none" }} />
          </label>

          <label style={{ fontSize: 13 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Closest category</div>
            <select value={customCategory} onChange={(e) => setCustomCategory(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dpf-border)", fontSize: 14, color: "var(--dpf-text)", background: "var(--dpf-surface-1)" }}>
              {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>

          <label style={{ fontSize: 13 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>How do customers interact? *</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {CTA_OPTIONS.map((o) => (
                <button key={o.value} type="button" onClick={() => setCustomCtaType(o.value)}
                  style={{
                    padding: "8px 12px", textAlign: "left", borderRadius: 6, cursor: "pointer", fontSize: 12,
                    border: customCtaType === o.value ? "2px solid var(--dpf-accent)" : "1px solid var(--dpf-border)",
                    background: customCtaType === o.value ? "color-mix(in srgb, var(--dpf-accent) 8%, var(--dpf-surface-1))" : "var(--dpf-surface-1)",
                    color: "var(--dpf-text)",
                  }}>
                  <div style={{ fontWeight: 600 }}>{o.label}</div>
                  <div style={{ fontSize: 11, color: "var(--dpf-muted)" }}>{o.description}</div>
                </button>
              ))}
            </div>
          </label>

          <label style={{ fontSize: 13 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>What do you offer? * (one per line)</div>
            <textarea value={customOfferings} onChange={(e) => setCustomOfferings(e.target.value)}
              placeholder={"Hot Desk\nMeeting Room\nPrivate Office\nVirtual Office"}
              rows={5} style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dpf-border)", fontSize: 14, fontFamily: "monospace", color: "var(--dpf-text)", background: "var(--dpf-surface-1)", resize: "vertical" }} />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label style={{ fontSize: 13 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Portal name</div>
              <input type="text" value={customPortalLabel} onChange={(e) => setCustomPortalLabel(e.target.value)}
                placeholder="e.g. Member Portal"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dpf-border)", fontSize: 14, color: "var(--dpf-text)", background: "var(--dpf-surface-1)" }} />
            </label>
            <label style={{ fontSize: 13 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Your customers are...</div>
              <input type="text" value={customStakeholderLabel} onChange={(e) => setCustomStakeholderLabel(e.target.value)}
                placeholder="e.g. Members, Clients"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dpf-border)", fontSize: 14, color: "var(--dpf-text)", background: "var(--dpf-surface-1)" }} />
            </label>
          </div>

          {error && <p style={{ color: "var(--dpf-error)", fontSize: 13 }}>{error}</p>}

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button onClick={() => setStep(1)} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid var(--dpf-border)", background: "var(--dpf-surface-1)", color: "var(--dpf-text)", cursor: "pointer", fontSize: 13 }}>Back</button>
            <button onClick={handleCreateCustom} disabled={customCreating || !customName.trim() || !customOfferings.trim()}
              style={{ padding: "8px 20px", borderRadius: 6, border: "none", background: "var(--dpf-accent)", color: "#fff", cursor: customCreating ? "wait" : "pointer", fontSize: 13, fontWeight: 600, opacity: customCreating ? 0.7 : 1 }}>
              {customCreating ? "Creating..." : "Create template & preview"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Step 2: Preview ──────────────────────────────────────────────────

  if (step === 2) {
    const items = Array.isArray(selected?.itemTemplates) ? selected!.itemTemplates as Array<{ name: string }> : [];
    const sections = Array.isArray(selected?.sectionTemplates) ? selected!.sectionTemplates as Array<{ title: string; type: string }> : [];
    return (
      <div style={{ color: "var(--dpf-text)" }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Preview: {selected?.name}</h2>
        <p style={{ fontSize: 13, color: "var(--dpf-muted)", marginBottom: 16 }}>
          These sections and items will be created. You can edit them later.
          {selected?.isBuiltIn === false && " This is a custom template."}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Sections</div>
            {sections.map((s, i) => <div key={i} style={{ fontSize: 13, padding: "4px 0", borderBottom: "1px solid var(--dpf-border)" }}>{s.title}</div>)}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Items / Services</div>
            {items.map((item, i) => <div key={i} style={{ fontSize: 13, padding: "4px 0", borderBottom: "1px solid var(--dpf-border)" }}>{item.name}</div>)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setStep(1)} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid var(--dpf-border)", background: "var(--dpf-surface-1)", color: "var(--dpf-text)", cursor: "pointer", fontSize: 13 }}>Back</button>
          <button onClick={() => setStep(3)} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "var(--dpf-accent)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Continue</button>
        </div>
      </div>
    );
  }

  // ─── Step 4: Financial Setup ──────────────────────────────────────────

  if (step === 4) {
    return (
      <FinancialSetupStep
        archetypeSlug={financeSlugFromCategory(selected?.category ?? "")}
        archetypeName={selected?.name ?? "your business"}
        suggestedCurrency={suggestedCurrency ?? null}
        onComplete={() => { window.location.href = "/admin/storefront"; }}
      />
    );
  }

  // ─── Step 3: Business Identity ────────────────────────────────────────

  const placeholders = CATEGORY_PLACEHOLDERS[selected?.category ?? ""] ?? {
    description: "Describe what your business does in 1-2 sentences",
    targetMarket: "Who are your ideal customers?",
  };

  return (
    <div style={{ maxWidth: 520, color: "var(--dpf-text)" }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Your business identity</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Business name *</div>
          <input type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)}
            required style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dpf-border)", fontSize: 14, color: "var(--dpf-text)", background: "var(--dpf-surface-1)" }} />
          {(orgNameFromDb || suggestedCompanyName) && (
            <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 4 }}>
              {orgNameFromDb ? "Pre-filled from your account" : "Pre-filled from your branding URL"} — edit if your storefront uses a different name
            </div>
          )}
        </label>
        <label style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>URL slug *</div>
          <input type="text" value={orgSlug} onChange={(e) => setOrgSlug(e.target.value)}
            required style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dpf-border)", fontSize: 14, fontFamily: "monospace", color: "var(--dpf-text)", background: "var(--dpf-surface-1)" }} />
          <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 4 }}>
            Permanent URL — choose carefully, this cannot easily be changed later. Your portal will be at /s/{orgSlug || "your-slug"}
          </div>
        </label>
        <label style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Tagline</div>
          <input type="text" value={tagline} onChange={(e) => setTagline(e.target.value)}
            style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dpf-border)", fontSize: 14, color: "var(--dpf-text)", background: "var(--dpf-surface-1)" }} />
        </label>
        <label style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>What does your business do?</div>
          <textarea value={businessDescription} onChange={(e) => setBusinessDescription(e.target.value)}
            placeholder={placeholders.description}
            rows={2} style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dpf-border)", fontSize: 14, color: "var(--dpf-text)", background: "var(--dpf-surface-1)", resize: "none" }} />
          <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 4 }}>
            This helps your AI coworker understand your business when building features
          </div>
        </label>
        <label style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Who are your customers?</div>
          <input type="text" value={targetMarket} onChange={(e) => setTargetMarket(e.target.value)}
            placeholder={placeholders.targetMarket}
            style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dpf-border)", fontSize: 14, color: "var(--dpf-text)", background: "var(--dpf-surface-1)" }} />
        </label>
        <div style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Company size</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
            {COMPANY_SIZE_OPTIONS.map((o) => (
              <button key={o.value} type="button" onClick={() => setCompanySize(companySize === o.value ? null : o.value)}
                style={{
                  padding: "8px 4px", textAlign: "center", borderRadius: 6, cursor: "pointer", fontSize: 12,
                  border: companySize === o.value ? "2px solid var(--dpf-accent)" : "1px solid var(--dpf-border)",
                  background: companySize === o.value ? "color-mix(in srgb, var(--dpf-accent) 8%, var(--dpf-surface-1))" : "var(--dpf-surface-1)",
                  color: "var(--dpf-text)",
                }}>
                <div style={{ fontWeight: 600 }}>{o.label}</div>
                <div style={{ fontSize: 10, color: "var(--dpf-muted)" }}>{o.description}</div>
              </button>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Geographic reach</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
            {GEOGRAPHIC_SCOPE_OPTIONS.map((o) => (
              <button key={o.value} type="button" onClick={() => setGeographicScope(geographicScope === o.value ? null : o.value)}
                style={{
                  padding: "8px 4px", textAlign: "center", borderRadius: 6, cursor: "pointer", fontSize: 12,
                  border: geographicScope === o.value ? "2px solid var(--dpf-accent)" : "1px solid var(--dpf-border)",
                  background: geographicScope === o.value ? "color-mix(in srgb, var(--dpf-accent) 8%, var(--dpf-surface-1))" : "var(--dpf-surface-1)",
                  color: "var(--dpf-text)",
                }}>
                <div style={{ fontWeight: 600 }}>{o.label}</div>
                <div style={{ fontSize: 10, color: "var(--dpf-muted)" }}>{o.description}</div>
              </button>
            ))}
          </div>
        </div>
        <label style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Hero image URL</div>
          <input type="url" value={heroImageUrl} onChange={(e) => setHeroImageUrl(e.target.value)}
            style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dpf-border)", fontSize: 14, color: "var(--dpf-text)", background: "var(--dpf-surface-1)" }} />
        </label>
        {error && <p style={{ color: "var(--dpf-error)", fontSize: 13 }}>{error}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setStep(2)} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid var(--dpf-border)", background: "var(--dpf-surface-1)", color: "var(--dpf-text)", cursor: "pointer", fontSize: 13 }}>Back</button>
          <button onClick={handleComplete} disabled={submitting || !orgName || !orgSlug}
            style={{ padding: "8px 20px", borderRadius: 6, border: "none", background: "var(--dpf-accent)", color: "#fff", cursor: submitting ? "wait" : "pointer", fontSize: 13, fontWeight: 600, opacity: submitting ? 0.7 : 1 }}>
            {submitting ? "Creating..." : "Create Portal"}
          </button>
        </div>
      </div>
    </div>
  );
}
