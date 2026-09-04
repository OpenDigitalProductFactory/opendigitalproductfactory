---
title: "WordPress (self-hosted)"
area: platform
order: 5
---

# WordPress (self-hosted)

Use **Platform > Tools > Native Integrations > WordPress (self-hosted)** when the business already operates a WordPress site and wants approved DPF content to reach it without making the DPF installation public.

DPF acts as the internal system of record and governed publishing conduit. WordPress remains the public website system. The connection uses outbound HTTPS from DPF to the WordPress REST API; WordPress does not call back into DPF.

## Before you connect

In WordPress, create a dedicated user with only the capabilities the business intends DPF to use. Under **Users > Profile > Application Passwords**, create an Application Password for DPF. Do not reuse a human password or an administrator account when an editor-level role is enough.

In DPF, enter exactly three values:

1. The customer-owned WordPress HTTPS site URL.
2. The dedicated WordPress username.
3. The Application Password.

DPF tests the authenticated identity, REST API, visible content types, taxonomies, and effective create/publish/upload capabilities before saving the connection. The password is encrypted at rest and is never shown again.

## Capability matrix

| Capability | Delivery posture | Authority |
| --- | --- | --- |
| Connect, authenticate, and health-check | Supported | WordPress reports identity and permissions; DPF stores safe health evidence |
| Discover posts, pages, media, taxonomies, and custom types | Supported, read-only | WordPress is authoritative |
| Incrementally observe core posts, pages, and media | Supported, read-only staging | Evidence only until a human links or accepts it; no silent canonical import |
| Create or update approved posts and pages | Supported | DPF owns source content and approval; WordPress owns the projected resource |
| Upload JPEG, PNG, GIF, WebP, and PDF up to 10 MB | Supported through the governed media service | DPF owns approved bytes/metadata; WordPress owns delivery |
| Publish directly to the public site | Optional, off by default | Requires connection policy plus separate item authorization; draft-first otherwise |
| Detect remote edits and uncertain outcomes | Supported | DPF records drift or ambiguity and stops duplicate-prone retry |
| Custom post types and plugin fields | Discovered only | Reported as unsupported until an explicit adapter exists |
| Themes, blocks, page layout, menus, plugins, SEO delivery | Not managed | WordPress |
| Hosting, domain, TLS, public URL, caching, or CDN | Not provided | Customer and WordPress hosting stack |
| General two-way CMS synchronization | Not provided | No claim of full WordPress parity |

## Publish an approved item

1. Prepare a `wordpress-post` or `wordpress-page` draft in Customer Marketing.
2. Review and approve it. Approval alone does not contact WordPress.
3. In **Ready to publish**, choose **Create WordPress draft**.
4. Review the content, audience, and consequence preview, then confirm.
5. Use the receipt link to open the resulting WordPress item.

The durable projection binding means a later DPF version updates the same WordPress resource instead of creating a duplicate. If the remote result is uncertain, DPF marks the binding ambiguous and requires review rather than guessing.

## What DPF can honestly claim

DPF absorbs the internal business-content part commonly handled in WordPress: structured source material, AI-assisted drafting, approvals, versioned intent, scheduling metadata, audit receipts, and multi-channel reuse. It does **not** absorb WordPress's public CMS runtime. DPF does not provide theme rendering, public hosting, domains, CDN, plugin execution, or a public website URL.

For connection failures, credential rotation, drift, and recovery, use the [WordPress operations runbook](../../runbooks/wordpress-self-hosted.md).
