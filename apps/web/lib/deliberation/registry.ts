// apps/web/lib/deliberation/registry.ts
// Task 4 — Deliberation pattern registry.
//
// Resolution order:
//   1. Load all DeliberationPattern rows from the DB (authority at runtime).
//   2. If the DB has no rows or the read fails, fall back to the file-backed
//      seeds under deliberation/ via the Task 1 seeder helpers.
// Persona text for each defaultRole is composed via the shared prompt-loader
// (loadPrompt("deliberation", roleId)) so admins can override persona prompts
// at runtime through Admin > Prompts without touching the pattern row.
//
// The registry caches resolved pattern lists for 60s to match prompt-loader
// cadence. Call invalidateDeliberationRegistryCache() on admin edits.

import { readFileSync } from "node:fs";
import { prisma } from "@dpf/db";
import {
  discoverDeliberationFiles,
  parseDeliberationContent,
} from "@dpf/db/seed-deliberation";
import { loadPrompt } from "../tak/prompt-loader";
import type {
  DeliberationPatternStatus,
} from "./types";
import { isDeliberationPatternStatus } from "./types";

/* -------------------------------------------------------------------------- */
/* Public types                                                               */
/* -------------------------------------------------------------------------- */

export interface ResolvedDeliberationRole {
  roleId: string;
  count: number;
  required: boolean;
  personaText: string;
}

export interface ResolvedDeliberationPattern {
  patternId: string;
  slug: string;
  name: string;
  status: DeliberationPatternStatus;
  purpose: string;
  defaultRoles: ResolvedDeliberationRole[];
  topologyTemplate: Record<string, unknown>;
  activationPolicyHints: Record<string, unknown>;
  evidenceRequirements: Record<string, unknown>;
  outputContract: Record<string, unknown>;
  providerStrategyHints: Record<string, unknown>;
  source: "db" | "file";
}

/**
 * Lightweight per-role routing recipe hint extracted from a pattern's
 * providerStrategyHints.rolesRecipes map. Consumed by recipe-loader so
 * deliberation branches can express preferences the task router can honor
 * without bypassing the existing routing pipeline.
 */
export interface RoleRoutingRecipeHint {
  roleId: string;
  capabilityTier?: "low" | "medium" | "high";
  taskType?: string;
  preferProviderDiversity?: boolean;
  requireProviderDiversity?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Cache                                                                      */
/* -------------------------------------------------------------------------- */

const CACHE_TTL_MS = 60_000;

type CacheEntry = {
  patterns: ResolvedDeliberationPattern[];
  loadedAt: number;
};

let listCache: CacheEntry | null = null;

export function invalidateDeliberationRegistryCache(): void {
  listCache = null;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

type RawRole = { roleId?: unknown; count?: unknown; required?: unknown };

function normalizeRoles(value: unknown): Array<{
  roleId: string;
  count: number;
  required: boolean;
}> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ roleId: string; count: number; required: boolean }> = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as RawRole;
    if (typeof r.roleId !== "string" || r.roleId.trim() === "") continue;
    const count = typeof r.count === "number" && Number.isFinite(r.count) ? r.count : 1;
    const required = typeof r.required === "boolean" ? r.required : false;
    out.push({ roleId: r.roleId, count, required });
  }
  return out;
}

function normalizeStatus(value: unknown): DeliberationPatternStatus {
  if (isDeliberationPatternStatus(value)) return value;
  return "active";
}

async function attachPersonas(
  roles: Array<{ roleId: string; count: number; required: boolean }>,
): Promise<ResolvedDeliberationRole[]> {
  // Load each unique roleId once; the loader has its own 60s cache so
  // repeated patterns sharing a role incur only one DB round trip per TTL.
  const uniqueIds = Array.from(new Set(roles.map((r) => r.roleId)));
  const personaMap = new Map<string, string>();
  await Promise.all(
    uniqueIds.map(async (roleId) => {
      const text = await loadPrompt("deliberation", roleId);
      personaMap.set(roleId, text);
    }),
  );
  return roles.map((r) => ({
    ...r,
    personaText: personaMap.get(r.roleId) ?? "",
  }));
}

/* -------------------------------------------------------------------------- */
/* DB and file loaders                                                        */
/* -------------------------------------------------------------------------- */

type DbPatternRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  purpose: string;
  defaultRoles: unknown;
  topologyTemplate: unknown;
  activationPolicyHints: unknown;
  evidenceRequirements: unknown;
  outputContract: unknown;
  providerStrategyHints: unknown;
};

async function loadFromDb(): Promise<ResolvedDeliberationPattern[] | null> {
  let rows: DbPatternRow[];
  try {
    rows = (await prisma.deliberationPattern.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        purpose: true,
        defaultRoles: true,
        topologyTemplate: true,
        activationPolicyHints: true,
        evidenceRequirements: true,
        outputContract: true,
        providerStrategyHints: true,
      },
    })) as DbPatternRow[];
  } catch {
    return null;
  }

  if (!rows || rows.length === 0) return [];

  const resolved: ResolvedDeliberationPattern[] = [];
  for (const row of rows) {
    const normalizedRoles = normalizeRoles(row.defaultRoles);
    const rolesWithPersonas = await attachPersonas(normalizedRoles);
    resolved.push({
      patternId: row.id,
      slug: row.slug,
      name: row.name,
      status: normalizeStatus(row.status),
      purpose: row.purpose,
      defaultRoles: rolesWithPersonas,
      topologyTemplate: asRecord(row.topologyTemplate),
      activationPolicyHints: asRecord(row.activationPolicyHints),
      evidenceRequirements: asRecord(row.evidenceRequirements),
      outputContract: asRecord(row.outputContract),
      providerStrategyHints: asRecord(row.providerStrategyHints),
      source: "db",
    });
  }
  return resolved;
}

async function loadFromFiles(): Promise<ResolvedDeliberationPattern[]> {
  const files = discoverDeliberationFiles();
  const out: ResolvedDeliberationPattern[] = [];
  for (const { slug, filePath } of files) {
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    try {
      const record = parseDeliberationContent(raw, filePath);
      const normalizedRoles = normalizeRoles(record.defaultRoles);
      const rolesWithPersonas = await attachPersonas(normalizedRoles);
      out.push({
        patternId: `file:${slug}`,
        slug: record.slug,
        name: record.name,
        status: normalizeStatus(record.status),
        purpose: record.purpose,
        defaultRoles: rolesWithPersonas,
        topologyTemplate: asRecord(record.topologyTemplate),
        activationPolicyHints: asRecord(record.activationPolicyHints),
        evidenceRequirements: asRecord(record.evidenceRequirements),
        outputContract: asRecord(record.outputContract),
        providerStrategyHints: asRecord(record.providerStrategyHints),
        source: "file",
      });
    } catch {
      // Per spec §6 loud-but-scoped: skip this file, keep the rest.
      continue;
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Resolve all deliberation patterns, DB-first with file fallback.
 */
export async function listPatterns(): Promise<ResolvedDeliberationPattern[]> {
  if (listCache && Date.now() - listCache.loadedAt < CACHE_TTL_MS) {
    return listCache.patterns;
  }

  const fromDb = await loadFromDb();
  let patterns: ResolvedDeliberationPattern[];
  if (fromDb === null) {
    patterns = await loadFromFiles();
  } else if (fromDb.length === 0) {
    patterns = await loadFromFiles();
  } else {
    patterns = fromDb;
  }

  listCache = { patterns, loadedAt: Date.now() };
  return patterns;
}

/**
 * Look up a single pattern by slug. Returns null when no pattern with that
 * slug is known to either the DB or the file-backed fallback.
 */
export async function getPattern(
  slug: string,
): Promise<ResolvedDeliberationPattern | null> {
  const all = await listPatterns();
  return all.find((p) => p.slug === slug) ?? null;
}

/**
 * Extract per-role routing recipe hints from a pattern's
 * providerStrategyHints.rolesRecipes map. Returns an empty Map when the
 * pattern has no rolesRecipes or the entries are malformed.
 */
export function extractRoleRecipes(
  pattern: ResolvedDeliberationPattern,
): Map<string, RoleRoutingRecipeHint> {
  const out = new Map<string, RoleRoutingRecipeHint>();
  const hints = pattern.providerStrategyHints;
  if (!hints || typeof hints !== "object") return out;
  const recipes = (hints as Record<string, unknown>).rolesRecipes;
  if (!recipes || typeof recipes !== "object" || Array.isArray(recipes)) return out;

  for (const [roleId, raw] of Object.entries(recipes as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const hint: RoleRoutingRecipeHint = { roleId };

    if (
      entry.capabilityTier === "low" ||
      entry.capabilityTier === "medium" ||
      entry.capabilityTier === "high"
    ) {
      hint.capabilityTier = entry.capabilityTier;
    }
    if (typeof entry.taskType === "string" && entry.taskType.trim() !== "") {
      hint.taskType = entry.taskType;
    }
    if (typeof entry.preferProviderDiversity === "boolean") {
      hint.preferProviderDiversity = entry.preferProviderDiversity;
    }
    if (typeof entry.requireProviderDiversity === "boolean") {
      hint.requireProviderDiversity = entry.requireProviderDiversity;
    }

    out.set(roleId, hint);
  }
  return out;
}
