"use client";
import { useState } from "react";
import { ScheduleEditor } from "./ScheduleEditor";

type AvailabilityRow = {
  id: string;
  days: number[];
  startTime: string;
  endTime: string;
  date: string | null;
  isBlocked: boolean;
  reason: string | null;
};

type ServiceItem = {
  id: string;
  name: string;
  ctaType: string;
};

type ProviderService = {
  id: string;
  item: ServiceItem;
};

type Provider = {
  id: string;
  providerId: string;
  name: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  priority: number;
  weight: number;
  services: ProviderService[];
  availability: AvailabilityRow[];
};

type BookableItem = {
  id: string;
  name: string;
  ctaType: string;
};

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 600,
      padding: "2px 7px",
      borderRadius: 10,
      background: active ? "color-mix(in srgb, var(--dpf-success) 15%, transparent)" : "rgba(148,163,184,0.15)",
      color: active ? "var(--dpf-success, #22c55e)" : "var(--dpf-muted)",
    }}>
      {active ? "Active" : "Inactive"}
    </span>
  );
}

export function TeamManager({
  providers: initial,
  storefrontId,
  items,
}: {
  providers: Provider[];
  storefrontId: string;
  items: BookableItem[];
}) {
  const [providers, setProviders] = useState<Provider[]>(initial);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Per-provider edit state
  const [editState, setEditState] = useState<Record<string, {
    name: string;
    email: string;
    phone: string;
    isActive: boolean;
    priority: number;
    weight: number;
    saving: boolean;
    error: string | null;
  }>>({});

  function getEdit(p: Provider) {
    return editState[p.id] ?? {
      name: p.name,
      email: p.email ?? "",
      phone: p.phone ?? "",
      isActive: p.isActive,
      priority: p.priority,
      weight: p.weight,
      saving: false,
      error: null,
    };
  }

  function patchEdit(id: string, patch: Partial<typeof editState[string]>) {
    setEditState((prev) => ({
      ...prev,
      [id]: { ...getEdit(providers.find((p) => p.id === id)!), ...prev[id], ...patch },
    }));
  }

  async function addProvider() {
    if (!newName.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch("/api/storefront/admin/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storefrontId, name: newName.trim(), email: newEmail || undefined, phone: newPhone || undefined }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setAddError(data.error ?? "Failed to add provider");
        return;
      }
      const data = (await res.json()) as { provider: Provider };
      setProviders((prev) => [...prev, data.provider]);
      setNewName("");
      setNewEmail("");
      setNewPhone("");
      setShowAddForm(false);
    } catch {
      setAddError("Network error");
    } finally {
      setAdding(false);
    }
  }

  async function saveProvider(p: Provider) {
    const edit = getEdit(p);
    patchEdit(p.id, { saving: true, error: null });
    try {
      const res = await fetch(`/api/storefront/admin/providers/${p.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: edit.name,
          email: edit.email || null,
          phone: edit.phone || null,
          isActive: edit.isActive,
          priority: edit.priority,
          weight: edit.weight,
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        patchEdit(p.id, { saving: false, error: data.error ?? "Save failed" });
        return;
      }
      const data = (await res.json()) as { provider: Provider };
      setProviders((prev) => prev.map((x) => (x.id === p.id ? data.provider : x)));
      patchEdit(p.id, { saving: false });
    } catch {
      patchEdit(p.id, { saving: false, error: "Network error" });
    }
  }

  async function toggleService(p: Provider, itemId: string, assigned: boolean) {
    // Optimistic update
    const newItemIds = assigned
      ? p.services.filter((s) => s.item.id !== itemId).map((s) => s.item.id)
      : [...p.services.map((s) => s.item.id), itemId];

    await fetch(`/api/storefront/admin/providers/${p.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceItemIds: newItemIds }),
    });

    // Refresh provider data
    const res = await fetch(`/api/storefront/admin/providers`);
    if (res.ok) {
      const data = (await res.json()) as { providers: Provider[] };
      setProviders(data.providers);
    }
  }

  async function deleteProvider(p: Provider) {
    if (!window.confirm(`Delete provider "${p.name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/storefront/admin/providers/${p.id}`, { method: "DELETE" });
    if (res.ok) {
      setProviders((prev) => prev.filter((x) => x.id !== p.id));
      if (expandedId === p.id) setExpandedId(null);
    }
  }

  const bookableItems = items.filter((i) => i.ctaType === "booking");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Service Providers ({providers.length})</div>
        <button
          onClick={() => setShowAddForm((v) => !v)}
          style={{ padding: "6px 14px", borderRadius: 5, border: "1px solid var(--dpf-border)", background: showAddForm ? "var(--dpf-accent)" : "none", color: showAddForm ? "#fff" : "inherit", cursor: "pointer", fontSize: 13 }}
        >
          {showAddForm ? "Cancel" : "+ Add Provider"}
        </button>
      </div>

      {showAddForm && (
        <div style={{ padding: 16, border: "1px solid var(--dpf-border)", borderRadius: 8, marginBottom: 16, background: "var(--dpf-surface-1)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>New Provider</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              placeholder="Full name *"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{ padding: "8px 10px", border: "1px solid var(--dpf-border)", borderRadius: 5, background: "var(--dpf-surface-2)", color: "inherit", fontSize: 13, width: "100%", boxSizing: "border-box" }}
            />
            <input
              placeholder="Email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              style={{ padding: "8px 10px", border: "1px solid var(--dpf-border)", borderRadius: 5, background: "var(--dpf-surface-2)", color: "inherit", fontSize: 13, width: "100%", boxSizing: "border-box" }}
            />
            <input
              placeholder="Phone"
              type="tel"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              style={{ padding: "8px 10px", border: "1px solid var(--dpf-border)", borderRadius: 5, background: "var(--dpf-surface-2)", color: "inherit", fontSize: 13, width: "100%", boxSizing: "border-box" }}
            />
            {addError && <div style={{ fontSize: 12, color: "var(--dpf-error, #ef4444)" }}>{addError}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={addProvider}
                disabled={adding || !newName.trim()}
                style={{ padding: "7px 16px", borderRadius: 5, border: "none", background: "var(--dpf-accent)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
              >
                {adding ? "Adding…" : "Add Provider"}
              </button>
            </div>
          </div>
        </div>
      )}

      {providers.length === 0 && !showAddForm && (
        <p style={{ color: "var(--dpf-muted)", fontSize: 13 }}>No providers yet. Add a provider to start managing availability.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {providers.map((p) => {
          const expanded = expandedId === p.id;
          const edit = getEdit(p);
          return (
            <div key={p.id} style={{ border: "1px solid var(--dpf-border)", borderRadius: 8, overflow: "hidden" }}>
              {/* Card header */}
              <div
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer", background: expanded ? "var(--dpf-surface-1)" : "transparent" }}
                onClick={() => setExpandedId(expanded ? null : p.id)}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</div>
                  {p.email && <div style={{ fontSize: 12, color: "var(--dpf-muted)" }}>{p.email}</div>}
                </div>
                <StatusBadge active={p.isActive} />
                <span style={{ fontSize: 12, color: "var(--dpf-muted)" }}>{p.services.length} service{p.services.length !== 1 ? "s" : ""}</span>
                <span style={{ fontSize: 12, color: "var(--dpf-muted)" }}>{expanded ? "▲" : "▼"}</span>
              </div>

              {expanded && (
                <div style={{ padding: "0 16px 16px", borderTop: "1px solid var(--dpf-border)" }}>
                  {/* Edit fields */}
                  <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Details</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <input
                        placeholder="Name *"
                        value={edit.name}
                        onChange={(e) => patchEdit(p.id, { name: e.target.value })}
                        style={{ flex: 1, minWidth: 140, padding: "6px 10px", border: "1px solid var(--dpf-border)", borderRadius: 5, background: "var(--dpf-surface-2)", color: "inherit", fontSize: 13 }}
                      />
                      <input
                        placeholder="Email"
                        type="email"
                        value={edit.email}
                        onChange={(e) => patchEdit(p.id, { email: e.target.value })}
                        style={{ flex: 1, minWidth: 140, padding: "6px 10px", border: "1px solid var(--dpf-border)", borderRadius: 5, background: "var(--dpf-surface-2)", color: "inherit", fontSize: 13 }}
                      />
                      <input
                        placeholder="Phone"
                        type="tel"
                        value={edit.phone}
                        onChange={(e) => patchEdit(p.id, { phone: e.target.value })}
                        style={{ flex: 1, minWidth: 120, padding: "6px 10px", border: "1px solid var(--dpf-border)", borderRadius: 5, background: "var(--dpf-surface-2)", color: "inherit", fontSize: 13 }}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={edit.isActive}
                          onChange={(e) => patchEdit(p.id, { isActive: e.target.checked })}
                          style={{ accentColor: "var(--dpf-accent)" }}
                        />
                        Active
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                        Priority
                        <input
                          type="number"
                          value={edit.priority}
                          onChange={(e) => patchEdit(p.id, { priority: parseInt(e.target.value) || 0 })}
                          style={{ width: 60, padding: "4px 6px", border: "1px solid var(--dpf-border)", borderRadius: 4, background: "var(--dpf-surface-2)", color: "inherit", fontSize: 13 }}
                        />
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                        Weight
                        <input
                          type="number"
                          value={edit.weight}
                          onChange={(e) => patchEdit(p.id, { weight: parseInt(e.target.value) || 0 })}
                          style={{ width: 60, padding: "4px 6px", border: "1px solid var(--dpf-border)", borderRadius: 4, background: "var(--dpf-surface-2)", color: "inherit", fontSize: 13 }}
                        />
                      </label>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button
                        onClick={() => saveProvider(p)}
                        disabled={edit.saving}
                        style={{ padding: "6px 14px", borderRadius: 5, border: "none", background: "var(--dpf-accent)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
                      >
                        {edit.saving ? "Saving…" : "Save Details"}
                      </button>
                      {edit.error && <span style={{ fontSize: 12, color: "var(--dpf-error, #ef4444)" }}>{edit.error}</span>}
                    </div>
                  </div>

                  {/* Service assignment */}
                  {bookableItems.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                        Services
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {bookableItems.map((item) => {
                          const assigned = p.services.some((s) => s.item.id === item.id);
                          return (
                            <label key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                              <input
                                type="checkbox"
                                checked={assigned}
                                onChange={() => toggleService(p, item.id, assigned)}
                                style={{ accentColor: "var(--dpf-accent)" }}
                              />
                              {item.name}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Schedule editor */}
                  <ScheduleEditor providerId={p.id} availability={p.availability} />

                  {/* Delete */}
                  <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--dpf-border)" }}>
                    <button
                      onClick={() => deleteProvider(p)}
                      style={{ padding: "6px 14px", borderRadius: 5, border: "1px solid var(--dpf-error, #ef4444)", background: "none", color: "var(--dpf-error, #ef4444)", cursor: "pointer", fontSize: 13 }}
                    >
                      Delete Provider
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
