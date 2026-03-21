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
};

type Step = 1 | 2 | 3 | 4;

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

export function SetupWizard({ archetypes }: { archetypes: Archetype[] }) {
  const [step, setStep] = useState<Step>(1);
  const [selected, setSelected] = useState<Archetype | null>(null);
  const [search, setSearch] = useState("");
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("store");
  const [tagline, setTagline] = useState("");
  const [heroImageUrl, setHeroImageUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derive slug from name
  function derivedSlug(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  const categories = Array.from(new Set(archetypes.map((a) => a.category))).sort();
  const filtered = archetypes.filter((a) =>
    !search || a.name.toLowerCase().includes(search.toLowerCase()) || a.category.includes(search.toLowerCase())
  );

  async function handleComplete() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/storefront/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archetypeId: selected!.archetypeId, orgName, orgSlug, tagline, heroImageUrl: heroImageUrl || null }),
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

  if (step === 1) {
    return (
      <div style={{ color: "var(--dpf-text, #111827)" }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Choose your business type</h2>
        <input
          type="search"
          placeholder="Search archetypes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: "100%", maxWidth: 360, padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dpf-border, #d1d5db)", fontSize: 14, marginBottom: 16, color: "var(--dpf-text, #111827)", background: "var(--dpf-surface, #fff)" }}
        />
        {categories.map((cat) => {
          const items = filtered.filter((a) => a.category === cat);
          if (!items.length) return null;
          return (
            <div key={cat} style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--dpf-muted, #6b7280)", marginBottom: 8 }}>
                {cat.replace(/-/g, " ")}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
                {items.map((a) => (
                  <button key={a.archetypeId} onClick={() => { setSelected(a); setStep(2); }}
                    style={{ padding: "12px 16px", textAlign: "left", borderRadius: 8, border: "1px solid var(--dpf-border, #d1d5db)", background: "var(--dpf-surface, #fff)", cursor: "pointer", fontSize: 13, color: "var(--dpf-text, #111827)" }}>
                    <div style={{ fontWeight: 600 }}>{a.name}</div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (step === 2) {
    const items = Array.isArray(selected?.itemTemplates) ? selected!.itemTemplates as Array<{ name: string }> : [];
    const sections = Array.isArray(selected?.sectionTemplates) ? selected!.sectionTemplates as Array<{ title: string; type: string }> : [];
    return (
      <div style={{ color: "var(--dpf-text, #111827)" }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Preview: {selected?.name}</h2>
        <p style={{ fontSize: 13, color: "var(--dpf-muted, #6b7280)", marginBottom: 16 }}>These sections and items will be created. You can edit them later.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Sections</div>
            {sections.map((s, i) => <div key={i} style={{ fontSize: 13, padding: "4px 0", borderBottom: "1px solid var(--dpf-border, #e5e7eb)" }}>{s.title}</div>)}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Items / Services</div>
            {items.map((item, i) => <div key={i} style={{ fontSize: 13, padding: "4px 0", borderBottom: "1px solid var(--dpf-border, #e5e7eb)" }}>{item.name}</div>)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setStep(1)} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid var(--dpf-border, #d1d5db)", background: "var(--dpf-surface, #fff)", color: "var(--dpf-text, #111827)", cursor: "pointer", fontSize: 13 }}>Back</button>
          <button onClick={() => setStep(3)} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "var(--dpf-accent, #4f46e5)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Continue</button>
        </div>
      </div>
    );
  }

  // Step 4: financial setup (rendered before the redirect so we keep wizard context)
  if (step === 4) {
    return (
      <FinancialSetupStep
        archetypeSlug={financeSlugFromCategory(selected?.category ?? "")}
        archetypeName={selected?.name ?? "your business"}
        onComplete={() => { window.location.href = "/admin/storefront"; }}
      />
    );
  }

  // Step 3: identity
  return (
    <div style={{ maxWidth: 480, color: "var(--dpf-text, #111827)" }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Your business identity</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Business name *</div>
          <input type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)}
            required style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dpf-border, #d1d5db)", fontSize: 14, color: "var(--dpf-text, #111827)", background: "var(--dpf-surface, #fff)" }} />
        </label>
        <label style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>URL slug *</div>
          <input type="text" value={orgSlug} onChange={(e) => setOrgSlug(e.target.value)}
            required style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dpf-border, #d1d5db)", fontSize: 14, fontFamily: "monospace", color: "var(--dpf-text, #111827)", background: "var(--dpf-surface, #fff)" }} />
          <div style={{ fontSize: 11, color: "var(--dpf-muted, #6b7280)", marginTop: 4 }}>
            Permanent URL — choose carefully, this cannot easily be changed later. Your storefront will be at /s/{orgSlug || "your-slug"}
          </div>
        </label>
        <label style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Tagline</div>
          <input type="text" value={tagline} onChange={(e) => setTagline(e.target.value)}
            style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dpf-border, #d1d5db)", fontSize: 14, color: "var(--dpf-text, #111827)", background: "var(--dpf-surface, #fff)" }} />
        </label>
        <label style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Hero image URL</div>
          <input type="url" value={heroImageUrl} onChange={(e) => setHeroImageUrl(e.target.value)}
            style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dpf-border, #d1d5db)", fontSize: 14, color: "var(--dpf-text, #111827)", background: "var(--dpf-surface, #fff)" }} />
        </label>
        {error && <p style={{ color: "#ef4444", fontSize: 13 }}>{error}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setStep(2)} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid var(--dpf-border, #d1d5db)", background: "var(--dpf-surface, #fff)", color: "var(--dpf-text, #111827)", cursor: "pointer", fontSize: 13 }}>Back</button>
          <button onClick={handleComplete} disabled={submitting || !orgName || !orgSlug}
            style={{ padding: "8px 20px", borderRadius: 6, border: "none", background: "var(--dpf-accent, #4f46e5)", color: "#fff", cursor: submitting ? "wait" : "pointer", fontSize: 13, fontWeight: 600, opacity: submitting ? 0.7 : 1 }}>
            {submitting ? "Creating..." : "Create Storefront"}
          </button>
        </div>
      </div>
    </div>
  );
}
