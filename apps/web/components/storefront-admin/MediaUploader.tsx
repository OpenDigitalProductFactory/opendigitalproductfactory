"use client";

// Reusable image gallery editor for any owner entity (storefront item, adoptable
// animal, provider, section, ...). Drives the media substrate end to end:
//   upload     POST   /api/media                       (multipart, attaches on upload)
//   list       GET    /api/storefront/admin/media       ?ownerType&ownerId&role
//   reorder    PATCH  /api/storefront/admin/media        { order: id[] }
//   primary    PATCH  /api/storefront/admin/media/:id    { setPrimary }
//   alt text   PATCH  /api/storefront/admin/media/:id    { assetId, altText }
//   remove     DELETE /api/storefront/admin/media/:id
// The first image (sortOrder 0) is the primary; it also syncs the owner's legacy
// scalar imageUrl/avatarUrl/etc., so existing single-image rendering keeps working.

import { useCallback, useEffect, useRef, useState } from "react";

export interface MediaUploaderProps {
  ownerType: string;
  ownerId: string;
  role?: string;
  label?: string;
  /** Hint copy describing what the images are for (from the archetype profile). */
  hint?: string;
  maxImages?: number;
}

interface MediaItem {
  attachmentId: string;
  assetId: string;
  url: string;
  altText: string | null;
  caption: string | null;
}

export function MediaUploader({
  ownerType,
  ownerId,
  role = "gallery",
  label = "Images",
  hint,
  maxImages = 12,
}: MediaUploaderProps) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/storefront/admin/media?ownerType=${encodeURIComponent(ownerType)}&ownerId=${encodeURIComponent(ownerId)}&role=${encodeURIComponent(role)}`,
      );
      if (res.ok) {
        const data = (await res.json()) as { media: MediaItem[] };
        setItems(data.media);
      }
    } finally {
      setLoading(false);
    }
  }, [ownerType, ownerId, role]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onPickFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setError(null);
      setUploading(true);
      try {
        for (const file of Array.from(files)) {
          if (items.length >= maxImages) {
            setError(`Up to ${maxImages} images.`);
            break;
          }
          const form = new FormData();
          form.append("file", file);
          form.append("ownerType", ownerType);
          form.append("ownerId", ownerId);
          form.append("role", role);
          const res = await fetch("/api/media", { method: "POST", body: form });
          if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            setError(data.error ?? `Upload failed (${res.status})`);
            break;
          }
        }
        await reload();
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [items.length, maxImages, ownerType, ownerId, role, reload],
  );

  const move = useCallback(
    async (index: number, dir: -1 | 1) => {
      const next = [...items];
      const target = index + dir;
      if (target < 0 || target >= next.length) return;
      [next[index], next[target]] = [next[target], next[index]];
      setItems(next);
      await fetch("/api/storefront/admin/media", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerType, ownerId, role, order: next.map((i) => i.attachmentId) }),
      });
    },
    [items, ownerType, ownerId, role],
  );

  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  const remove = useCallback(async (attachmentId: string) => {
    setPendingRemove(null);
    const res = await fetch(`/api/storefront/admin/media/${attachmentId}`, {
      method: "DELETE",
    }).catch(() => null);
    if (!res?.ok) return;
    setItems((prev) => prev.filter((i) => i.attachmentId !== attachmentId));
  }, []);

  const saveAlt = useCallback(async (item: MediaItem, altText: string) => {
    setItems((prev) =>
      prev.map((i) => (i.attachmentId === item.attachmentId ? { ...i, altText } : i)),
    );
    await fetch(`/api/storefront/admin/media/${item.attachmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId: item.assetId, altText }),
    });
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>{label}</span>
        {hint && <span className="text-[var(--dpf-muted)]" style={{ fontSize: 11 }}>· {hint}</span>}
      </div>

      {loading ? (
        <div className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>Loading…</div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
            gap: 10,
          }}
        >
          {items.map((item, index) => (
            <div
              key={item.attachmentId}
              className="border border-[var(--dpf-border)]"
              style={{
                borderRadius: 8,
                padding: 6,
                display: "flex",
                flexDirection: "column",
                gap: 4,
                position: "relative",
              }}
            >
              {index === 0 && (
                <span
                  className="bg-[var(--dpf-accent)] text-white"
                  style={{
                    position: "absolute",
                    top: 8,
                    left: 8,
                    fontSize: 10,
                    borderRadius: 4,
                    padding: "1px 5px",
                  }}
                >
                  Primary
                </span>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.url}
                alt={item.altText ?? ""}
                style={{ width: "100%", height: 90, objectFit: "cover", borderRadius: 4 }}
              />
              <input
                type="text"
                value={item.altText ?? ""}
                placeholder="Alt text"
                onChange={(e) =>
                  setItems((prev) =>
                    prev.map((i) =>
                      i.attachmentId === item.attachmentId ? { ...i, altText: e.target.value } : i,
                    ),
                  )
                }
                onBlur={(e) => void saveAlt(item, e.target.value)}
                className="border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-[var(--dpf-text)]"
                style={{
                  fontSize: 11,
                  padding: "2px 4px",
                  borderRadius: 4,
                }}
              />
              <div style={{ display: "flex", gap: 4, justifyContent: "space-between" }}>
                <button type="button" onClick={() => void move(index, -1)} disabled={index === 0}
                  className={btnClass} style={btnStyle} aria-label="Move left">←</button>
                <button type="button" onClick={() => void move(index, 1)} disabled={index === items.length - 1}
                  className={btnClass} style={btnStyle} aria-label="Move right">→</button>
                {pendingRemove === item.attachmentId ? (
                  <>
                    <button type="button" onClick={() => void remove(item.attachmentId)}
                      className="border border-[var(--dpf-error)] bg-transparent text-[var(--dpf-error)]"
                      style={destructiveBtnStyle} aria-label="Remove this photo for good">Remove</button>
                    <button type="button" onClick={() => setPendingRemove(null)}
                      className={btnClass} style={destructiveBtnStyle} aria-label="Keep this photo">Keep</button>
                  </>
                ) : (
                  <button type="button" onClick={() => setPendingRemove(item.attachmentId)}
                    className="border border-[var(--dpf-border)] bg-transparent text-[var(--dpf-error)]"
                    style={destructiveBtnStyle} aria-label="Remove">✕</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          multiple
          hidden
          onChange={(e) => void onPickFiles(e.target.files)}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || items.length >= maxImages}
          className="border border-dashed border-[var(--dpf-border)] bg-transparent text-[var(--dpf-text)]"
          style={{
            fontSize: 12,
            padding: "6px 12px",
            borderRadius: 6,
            cursor: uploading ? "default" : "pointer",
          }}
        >
          {uploading ? "Uploading…" : "+ Add images"}
        </button>
      </div>

      {error && <div className="text-[var(--dpf-error)]" style={{ fontSize: 12 }}>{error}</div>}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "2px 6px",
  borderRadius: 4,
  cursor: "pointer",
};

/** Removing a photograph is destructive and is done one-handed on the tablet a
 *  kennel technician carries. It measured 24x24 and deleted on one press
 *  (BI-56BB6038). Same 44px target the animal's own Delete uses. */
const destructiveBtnStyle: React.CSSProperties = {
  minHeight: 44,
  minWidth: 44,
  fontSize: 12,
  borderRadius: 4,
  cursor: "pointer",
};

const btnClass = "border border-[var(--dpf-border)] bg-transparent text-[var(--dpf-text)]";
