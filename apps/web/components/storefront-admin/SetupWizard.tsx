"use client";
import { useState } from "react";
import { slugify } from "@/lib/shared/slugify";
import { setupQuestionsFor } from "@/lib/storefront/setup-questions";
import { ArchetypeActivationSummary } from "./ArchetypeActivationSummary";
import { FinancialSetupStep } from "./FinancialSetupStep";
import { seedOnboardingBrandOffer } from "@/lib/actions/seed-onboarding-brand-offer";
import { financeProfileSlugFromCategory } from "@/lib/finance/setup-profile";
import { INDUSTRY_OPTIONS } from "@/lib/storefront/industries";
import type { WorkspaceHomeSetupActivationSummary } from "@/lib/workspace-home";
import type { ProductMixDefinition } from "@dpf/storefront-templates";
import type { ProductLineSelection } from "@/lib/products/setup-product-mix";
import {
  ProductMixSetupFieldset,
  defaultProductLineSelections,
} from "./ProductMixSetupFieldset";

type Archetype = {
  archetypeId: string;
  name: string;
  category: string;
  ctaType: string;
  tags: unknown;
  itemTemplates: unknown;
  sectionTemplates: unknown;
  activationProfile?: unknown;
  productMix: ProductMixDefinition;
  workspaceHomeActivation?: WorkspaceHomeSetupActivationSummary;
  isBuiltIn?: boolean;
};

type Step = 1 | 2 | 3 | "custom";

type SetupWizardProps = {
  archetypes: Archetype[];
  orgNameFromDb?: string | null;
  suggestedArchetypeId?: string | null;
  suggestedArchetypeName?: string | null;
  archetypeConfidence?: "high" | "medium" | null;
  suggestedCompanyName?: string | null;
  suggestedCurrency?: string | null;
  /** Portal label from archetype vocabulary, e.g. "Community Portal", "Client Portal" */
  portalLabel?: string | null;
  /** Stakeholder label, e.g. "Homeowners", "Clients" */
  stakeholderLabel?: string | null;
};

// Canonical 11-industry list comes from @/lib/storefront/industries (INDUSTRY_OPTIONS).
// Custom archetypes must pick one of these; the API enforces it.

const CTA_OPTIONS = [
  { value: "booking", label: "Booking", description: "Customers book appointments or sessions" },
  { value: "purchase", label: "Purchase", description: "Customers buy products or pay for services" },
  { value: "inquiry", label: "Inquiry", description: "Customers request quotes or information" },
  { value: "donation", label: "Donation", description: "Supporters donate to a cause" },
];



export function SetupWizard({
  archetypes,
  orgNameFromDb,
  suggestedArchetypeId,
  suggestedArchetypeName,
  archetypeConfidence,
  suggestedCompanyName,
  suggestedCurrency,
  portalLabel,
  stakeholderLabel,
}: SetupWizardProps) {
  const [step, setStep] = useState<Step>(1);
  const [selected, setSelected] = useState<Archetype | null>(null);
  const [search, setSearch] = useState("");
  const orgName = orgNameFromDb ?? suggestedCompanyName ?? "";
  const [orgSlug, setOrgSlug] = useState("store");
  const [tagline, setTagline] = useState("");
  const [heroImageUrl, setHeroImageUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // EP-PARTNER-CHANNEL Phase 1b: per-capability setup answers (capabilityKey → enabled).
  const [capabilityChoices, setCapabilityChoices] = useState<Record<string, boolean>>({});
  const [productLineSelections, setProductLineSelections] = useState<
    ProductLineSelection[]
  >([]);

  const displayPortalLabel = portalLabel ?? "Portal";

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
    return slugify(name);
  }

  const builtIn = archetypes.filter((a) => a.isBuiltIn !== false);
  const custom = archetypes.filter((a) => a.isBuiltIn === false);
  const categories = Array.from(new Set(builtIn.map((a) => a.category))).sort();
  const filtered = builtIn.filter((a) =>
    !search || a.name.toLowerCase().includes(search.toLowerCase()) || a.category.includes(search.toLowerCase())
  );

  function chooseArchetype(archetype: Archetype) {
    setSelected(archetype);
    setProductLineSelections(defaultProductLineSelections(archetype.productMix));
    setStep(2);
  }

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
          // Record the answer to each setup capability question (asked → decided).
          capabilityChoices: setupQuestionsFor(selected!.activationProfile).map((q) => ({
            capabilityKey: q.capabilityKey,
            choice: capabilityChoices[q.capabilityKey] ? "enabled" : "disabled",
          })),
          productLines: productLineSelections,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errorBody = data as { error?: string; message?: string };
        throw new Error(errorBody.message ?? errorBody.error ?? "Setup failed");
      }
      // Move to financial setup step
      setStep(3);
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
          category: customCategory,
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
        activationProfile: created.activationProfile,
        productMix: created.productMix,
        workspaceHomeActivation: {
          archetypeId: created.archetypeId,
          archetypeName: created.name,
          mode: "unconfigured",
          match: "none",
          label: "Platform workspace view",
          status: "not-configured",
          sourceContributionId: null,
          primaryOperatingQuestion: null,
          topConcerns: [],
          primitiveWidgets: [],
          requiredCanonicalData: [],
          requiredSignals: [],
          missingDataBehavior: "platform-fallback",
          fallback: "platform",
          setupAction: "choose-or-finish-business-setup",
        },
        isBuiltIn: false,
      });
      setProductLineSelections(
        defaultProductLineSelections(created.productMix as ProductMixDefinition),
      );
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
      <div className="text-[var(--dpf-text)]">
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Choose your portal template</h2>

        {suggestedArchetypeId && suggestedArchetypeName && (
          <div className="border border-[var(--dpf-accent)]" style={{
            padding: "10px 14px",
            borderRadius: 8,
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
              <span className="text-[var(--dpf-muted)]" style={{ fontSize: 11 }}>(high confidence)</span>
            )}
            <span className="text-[var(--dpf-muted)]" style={{ marginLeft: "auto", fontSize: 12 }}>
              Detected from your branding URL — scroll down to find it highlighted
            </span>
          </div>
        )}

        <input
          type="search"
          placeholder="Search archetypes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-[var(--dpf-border)] text-[var(--dpf-text)] bg-[var(--dpf-surface-1)]"
          style={{ width: "100%", maxWidth: 360, padding: "8px 12px", borderRadius: 6, fontSize: 14, marginBottom: 16 }}
        />
        {categories.map((cat) => {
          const items = filtered.filter((a) => a.category === cat);
          if (!items.length) return null;
          return (
            <div key={cat} style={{ marginBottom: 24 }}>
              <div className="text-[var(--dpf-muted)]" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                {cat.replace(/-/g, " ")}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
                {items.map((a) => {
                  const isSuggested = a.archetypeId === suggestedArchetypeId;
                  return (
                    <button key={a.archetypeId} onClick={() => chooseArchetype(a)}
                      className={`text-[var(--dpf-text)] ${isSuggested ? "border-2 border-[var(--dpf-accent)]" : "border border-[var(--dpf-border)]"}`}
                      style={{
                        padding: "12px 16px",
                        textAlign: "left",
                        borderRadius: 8,
                        background: isSuggested ? "color-mix(in srgb, var(--dpf-accent) 8%, var(--dpf-surface-1))" : "var(--dpf-surface-1)",
                        cursor: "pointer",
                        fontSize: 13,
                      }}>
                      <div style={{ fontWeight: 600 }}>{a.name}</div>
                      {isSuggested && (
                        <div className="text-[var(--dpf-accent)]" style={{ fontSize: 11, marginTop: 2 }}>Suggested for you</div>
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
            <div className="text-[var(--dpf-muted)]" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Custom business types
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
              {custom.map((a) => (
                <button key={a.archetypeId} onClick={() => chooseArchetype(a)}
                  className="border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)]"
                  style={{
                    padding: "12px 16px", textAlign: "left", borderRadius: 8,
                    cursor: "pointer", fontSize: 13,
                  }}>
                  <div style={{ fontWeight: 600 }}>{a.name}</div>
                  <div className="text-[var(--dpf-muted)]" style={{ fontSize: 11, marginTop: 2 }}>Custom</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* "Other" card */}
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => setStep("custom")}
            className="border border-dashed border-[var(--dpf-accent)] text-[var(--dpf-text)]"
            style={{
              width: "100%", padding: "16px 20px", textAlign: "left", borderRadius: 8,
              cursor: "pointer", fontSize: 13,
              background: "color-mix(in srgb, var(--dpf-accent) 5%, var(--dpf-surface-1))",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Can't find your business?</div>
            <div className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>
              Define a custom operating model. Your template can also be contributed back to help others, including software-platform and customer-zero installs.
            </div>
          </button>
        </div>
      </div>
    );
  }

  // ─── Custom Archetype Definition ──────────────────────────────────────

  if (step === "custom") {
    return (
      <div className="text-[var(--dpf-text)]" style={{ maxWidth: 520 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Define your operating model</h2>
        <p className="text-[var(--dpf-muted)]" style={{ fontSize: 13, marginBottom: 16 }}>
          Tell us about your business or platform and we'll create a template that matches how you operate and what you sell.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ fontSize: 13 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Business type name *</div>
            <input type="text" value={customName} onChange={(e) => setCustomName(e.target.value)}
              placeholder="e.g. Brewery Taproom, Dog Daycare, Co-working Space"
              required className="border border-[var(--dpf-border)] text-[var(--dpf-text)] bg-[var(--dpf-surface-1)]" style={{ width: "100%", padding: "8px 12px", borderRadius: 6, fontSize: 14 }} />
          </label>

          <label style={{ fontSize: 13 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>What does this business do?</div>
            <textarea value={customDescription} onChange={(e) => setCustomDescription(e.target.value)}
              placeholder="Brief description of the business..."
              rows={2} className="border border-[var(--dpf-border)] text-[var(--dpf-text)] bg-[var(--dpf-surface-1)]" style={{ width: "100%", padding: "8px 12px", borderRadius: 6, fontSize: 14, resize: "none" }} />
          </label>

          <label style={{ fontSize: 13 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Closest category</div>
            <select value={customCategory} onChange={(e) => setCustomCategory(e.target.value)}
              className="border border-[var(--dpf-border)] text-[var(--dpf-text)] bg-[var(--dpf-surface-1)]" style={{ width: "100%", padding: "8px 12px", borderRadius: 6, fontSize: 14 }}>
              {INDUSTRY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>

          <label style={{ fontSize: 13 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>How do customers interact? *</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {CTA_OPTIONS.map((o) => (
                <button key={o.value} type="button" onClick={() => setCustomCtaType(o.value)}
                  className={`text-[var(--dpf-text)] ${customCtaType === o.value ? "border-2 border-[var(--dpf-accent)]" : "border border-[var(--dpf-border)]"}`}
                  style={{
                    padding: "8px 12px", textAlign: "left", borderRadius: 6, cursor: "pointer", fontSize: 12,
                    background: customCtaType === o.value ? "color-mix(in srgb, var(--dpf-accent) 8%, var(--dpf-surface-1))" : "var(--dpf-surface-1)",
                  }}>
                  <div style={{ fontWeight: 600 }}>{o.label}</div>
                  <div className="text-[var(--dpf-muted)]" style={{ fontSize: 11 }}>{o.description}</div>
                </button>
              ))}
            </div>
          </label>

          <label style={{ fontSize: 13 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>What do you offer? * (one per line)</div>
            <textarea value={customOfferings} onChange={(e) => setCustomOfferings(e.target.value)}
              placeholder={"Hot Desk\nMeeting Room\nPrivate Office\nVirtual Office"}
              rows={5} className="border border-[var(--dpf-border)] text-[var(--dpf-text)] bg-[var(--dpf-surface-1)]" style={{ width: "100%", padding: "8px 12px", borderRadius: 6, fontSize: 14, fontFamily: "monospace", resize: "vertical" }} />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label style={{ fontSize: 13 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Portal name</div>
              <input type="text" value={customPortalLabel} onChange={(e) => setCustomPortalLabel(e.target.value)}
                placeholder="e.g. Member Portal"
                className="border border-[var(--dpf-border)] text-[var(--dpf-text)] bg-[var(--dpf-surface-1)]" style={{ width: "100%", padding: "8px 12px", borderRadius: 6, fontSize: 14 }} />
            </label>
            <label style={{ fontSize: 13 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Your customers are...</div>
              <input type="text" value={customStakeholderLabel} onChange={(e) => setCustomStakeholderLabel(e.target.value)}
                placeholder="e.g. Members, Clients"
                className="border border-[var(--dpf-border)] text-[var(--dpf-text)] bg-[var(--dpf-surface-1)]" style={{ width: "100%", padding: "8px 12px", borderRadius: 6, fontSize: 14 }} />
            </label>
          </div>

          {error && <p className="text-[var(--dpf-error)]" style={{ fontSize: 13 }}>{error}</p>}

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button onClick={() => setStep(1)} className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)]" style={{ padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>Back</button>
            <button onClick={handleCreateCustom} disabled={customCreating || !customName.trim() || !customOfferings.trim()}
              className="bg-[var(--dpf-accent)] text-white" style={{ padding: "8px 20px", borderRadius: 6, border: "none", cursor: customCreating ? "wait" : "pointer", fontSize: 13, fontWeight: 600, opacity: customCreating ? 0.7 : 1 }}>
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
      <div className="text-[var(--dpf-text)]">
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Preview: {selected?.name}</h2>
        <p className="text-[var(--dpf-muted)]" style={{ fontSize: 13, marginBottom: 16 }}>
          These sections and items will be created. You can edit them later.
          {selected?.isBuiltIn === false && " This is a custom template."}
        </p>
        <ArchetypeActivationSummary
          activationProfile={selected?.activationProfile}
          workspaceHomeActivation={selected?.workspaceHomeActivation}
        />
        {selected?.productMix && (
          <ProductMixSetupFieldset
            archetypeCategory={selected.category}
            productMix={selected.productMix}
            value={productLineSelections}
            onChange={setProductLineSelections}
          />
        )}
        {(() => {
          const questions = setupQuestionsFor(selected?.activationProfile);
          if (questions.length === 0) return null;
          return (
            <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              {questions.map((q) => (
                <label
                  key={q.capabilityKey}
                  className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
                  style={{ display: "flex", gap: 10, alignItems: "flex-start", borderRadius: 8, padding: 12, cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={capabilityChoices[q.capabilityKey] ?? false}
                    onChange={(e) =>
                      setCapabilityChoices((prev) => ({ ...prev, [q.capabilityKey]: e.target.checked }))
                    }
                    style={{ marginTop: 2 }}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span className="text-[var(--dpf-text)]" style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{q.question}</span>
                    {q.helpText && (
                      <span className="text-[var(--dpf-muted)]" style={{ display: "block", fontSize: 12, marginTop: 2 }}>{q.helpText}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          );
        })()}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Sections</div>
            {sections.map((s, i) => <div key={i} className="border-b border-[var(--dpf-border)]" style={{ fontSize: 13, padding: "4px 0" }}>{s.title}</div>)}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Items / Services</div>
            {items.map((item, i) => <div key={i} className="border-b border-[var(--dpf-border)]" style={{ fontSize: 13, padding: "4px 0" }}>{item.name}</div>)}
          </div>
        </div>
        {/* Portal-specific fields: slug, tagline, hero */}
        <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ fontSize: 13 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>URL slug *</div>
            <input type="text" value={orgSlug} onChange={(e) => setOrgSlug(e.target.value)}
              required className="border border-[var(--dpf-border)] text-[var(--dpf-text)] bg-[var(--dpf-surface-1)]" style={{ width: "100%", maxWidth: 360, padding: "8px 12px", borderRadius: 6, fontSize: 14, fontFamily: "monospace" }} />
            <div className="text-[var(--dpf-muted)]" style={{ fontSize: 11, marginTop: 4 }}>
              Your {displayPortalLabel.toLowerCase()} will be at /s/{orgSlug || "your-slug"}
            </div>
          </label>
          <label style={{ fontSize: 13 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Tagline</div>
            <input type="text" value={tagline} onChange={(e) => setTagline(e.target.value)}
              className="border border-[var(--dpf-border)] text-[var(--dpf-text)] bg-[var(--dpf-surface-1)]" style={{ width: "100%", maxWidth: 360, padding: "8px 12px", borderRadius: 6, fontSize: 14 }} />
          </label>
          <label style={{ fontSize: 13 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Hero image URL</div>
            <input type="url" value={heroImageUrl} onChange={(e) => setHeroImageUrl(e.target.value)}
              className="border border-[var(--dpf-border)] text-[var(--dpf-text)] bg-[var(--dpf-surface-1)]" style={{ width: "100%", maxWidth: 360, padding: "8px 12px", borderRadius: 6, fontSize: 14 }} />
          </label>
        </div>
        {error && <p className="text-[var(--dpf-error)]" style={{ fontSize: 13 }}>{error}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setStep(1)} className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)]" style={{ padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>Back</button>
          <button onClick={handleComplete} disabled={submitting || !orgSlug || productLineSelections.some((line) => !line.label.trim())}
            className="bg-[var(--dpf-accent)] text-white" style={{ padding: "8px 20px", borderRadius: 6, border: "none", cursor: submitting ? "wait" : "pointer", fontSize: 13, fontWeight: 600, opacity: submitting || !orgSlug ? 0.7 : 1 }}>
            {submitting ? "Creating..." : `Create ${displayPortalLabel}`}
          </button>
        </div>
      </div>
    );
  }

  // ─── Step 3: Financial Setup ──────────────────────────────────────────

  if (step === 3) {
    return (
      <FinancialSetupStep
        archetypeSlug={financeProfileSlugFromCategory(selected?.category)}
        archetypeName={selected?.name ?? "your business"}
        suggestedCurrency={suggestedCurrency ?? null}
        onComplete={async () => {
          // Seed the onboarding coworker's first message offering to build
          // the brand in the background — the first-run wow moment.
          // Non-fatal: proceed to the tour even if seeding fails.
          try {
            await seedOnboardingBrandOffer();
          } catch {
            // Best-effort.
          }
          // Regulated categories (BI-5D9DCDE6 spec §9.2): land the operator on
          // the licensing workspace where the jurisdiction/charter capture step
          // and archetype-matched regulators are waiting. Required but never
          // blocking (D5) — everything else is already set up.
          window.location.href =
            selected?.category === "banking-financial-services"
              ? "/compliance/licensing"
              : "/storefront";
        }}
      />
    );
  }

  // This should not be reachable — all steps handled above
  return null;
}
