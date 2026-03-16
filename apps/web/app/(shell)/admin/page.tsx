import { prisma } from "@dpf/db";
import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { BrandingConfigurator } from "@/components/admin/BrandingConfigurator";
import { AdminUserAccessPanel } from "@/components/admin/AdminUserAccessPanel";
import { PlatformKeysPanel } from "@/components/admin/PlatformKeysPanel";
import { deleteThemePreset } from "@/lib/actions/branding";
import { resolveBrandingLogoUrl } from "@/lib/branding";

const THEME_PRESET_SCOPE_PREFIX = "theme-preset:";

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ThemeTokenInput = {
  version: string;
  palette_bg: string;
  palette_surface1: string;
  palette_surface2: string;
  palette_accent: string;
  palette_muted: string;
  palette_border: string;
  typography_fontFamily: string;
  typography_headingFontFamily: string;
  spacing_xs: string;
  spacing_sm: string;
  spacing_md: string;
  spacing_lg: string;
  spacing_xl: string;
  radius_sm: string;
  radius_md: string;
  radius_lg: string;
  radius_xl: string;
  surfaces_page: string;
  surfaces_panel: string;
  surfaces_card: string;
  surfaces_sidebar: string;
  surfaces_modal: string;
  states_idle: string;
  states_hover: string;
  states_active: string;
  states_focus: string;
  states_success: string;
  states_warning: string;
  states_error: string;
  states_info: string;
  shadows_panel: string;
  shadows_card: string;
  shadows_button: string;
};

type BrandingConfigRow = {
  id: string;
  scope: string;
  companyName: string;
  logoUrl: string | null;
  tokens: unknown;
};

type BrandingPresetRow = {
  id: string;
  scope: string;
  companyName: string;
  logoUrl: string;
  tokens: ThemeTokenInput;
};

const THEME_TOKEN_BASE: ThemeTokenInput = {
  version: "1.0.0",
  palette_bg: "#0f0f1a",
  palette_surface1: "#1a1a2e",
  palette_surface2: "#161625",
  palette_accent: "#7c8cf8",
  palette_muted: "#8888a0",
  palette_border: "#2a2a40",
  typography_fontFamily: "Inter, system-ui, sans-serif",
  typography_headingFontFamily: "Inter, system-ui, sans-serif",
  spacing_xs: "4px",
  spacing_sm: "8px",
  spacing_md: "12px",
  spacing_lg: "16px",
  spacing_xl: "24px",
  radius_sm: "6px",
  radius_md: "10px",
  radius_lg: "14px",
  radius_xl: "18px",
  surfaces_page: "#0f0f1a",
  surfaces_panel: "#1a1a2e",
  surfaces_card: "#161625",
  surfaces_sidebar: "#1a1a2e",
  surfaces_modal: "#161625",
  states_idle: "#7c8cf8",
  states_hover: "#9ec5ff",
  states_active: "#5ba3ff",
  states_focus: "#4ade80",
  states_success: "#4ade80",
  states_warning: "#fbbf24",
  states_error: "#f87171",
  states_info: "#38bdf8",
  shadows_panel: "0 18px 48px rgba(0, 0, 0, 0.45)",
  shadows_card: "0 12px 24px rgba(0, 0, 0, 0.35)",
  shadows_button: "0 6px 12px rgba(0, 0, 0, 0.28)",
};

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function readColor(value: unknown, fallback: string): string {
  if (typeof value === "string" && HEX_RE.test(value)) return value;
  return fallback;
}

function parseStoredTokens(value: unknown): ThemeTokenInput {
  const raw = typeof value === "string" ? (() => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  })() : value;

  const record = isRecord(raw) ? raw : {};
  const palette = isRecord(record.palette) ? record.palette : {};
  const typography = isRecord(record.typography) ? record.typography : {};
  const spacing = isRecord(record.spacing) ? record.spacing : {};
  const radius = isRecord(record.radius) ? record.radius : {};
  const surfaces = isRecord(record.surfaces) ? record.surfaces : {};
  const states = isRecord(record.states) ? record.states : {};
  const shadows = isRecord(record.shadows) ? record.shadows : {};

  return {
    version: readString(record.version, THEME_TOKEN_BASE.version),
    palette_bg: readColor(palette.bg, THEME_TOKEN_BASE.palette_bg),
    palette_surface1: readColor(palette.surface1, THEME_TOKEN_BASE.palette_surface1),
    palette_surface2: readColor(palette.surface2, THEME_TOKEN_BASE.palette_surface2),
    palette_accent: readColor(palette.accent, THEME_TOKEN_BASE.palette_accent),
    palette_muted: readColor(palette.muted, THEME_TOKEN_BASE.palette_muted),
    palette_border: readColor(palette.border, THEME_TOKEN_BASE.palette_border),
    typography_fontFamily: readString(typography.fontFamily, THEME_TOKEN_BASE.typography_fontFamily),
    typography_headingFontFamily: readString(typography.headingFontFamily, THEME_TOKEN_BASE.typography_headingFontFamily),
    spacing_xs: readString(spacing.xs, THEME_TOKEN_BASE.spacing_xs),
    spacing_sm: readString(spacing.sm, THEME_TOKEN_BASE.spacing_sm),
    spacing_md: readString(spacing.md, THEME_TOKEN_BASE.spacing_md),
    spacing_lg: readString(spacing.lg, THEME_TOKEN_BASE.spacing_lg),
    spacing_xl: readString(spacing.xl, THEME_TOKEN_BASE.spacing_xl),
    radius_sm: readString(radius.sm, THEME_TOKEN_BASE.radius_sm),
    radius_md: readString(radius.md, THEME_TOKEN_BASE.radius_md),
    radius_lg: readString(radius.lg, THEME_TOKEN_BASE.radius_lg),
    radius_xl: readString(radius.xl, THEME_TOKEN_BASE.radius_xl),
    surfaces_page: readColor(surfaces.page, THEME_TOKEN_BASE.surfaces_page),
    surfaces_panel: readColor(surfaces.panel, THEME_TOKEN_BASE.surfaces_panel),
    surfaces_card: readColor(surfaces.card, THEME_TOKEN_BASE.surfaces_card),
    surfaces_sidebar: readColor(surfaces.sidebar, THEME_TOKEN_BASE.surfaces_sidebar),
    surfaces_modal: readColor(surfaces.modal, THEME_TOKEN_BASE.surfaces_modal),
    states_idle: readColor(states.idle, THEME_TOKEN_BASE.states_idle),
    states_hover: readColor(states.hover, THEME_TOKEN_BASE.states_hover),
    states_active: readColor(states.active, THEME_TOKEN_BASE.states_active),
    states_focus: readColor(states.focus, THEME_TOKEN_BASE.states_focus),
    states_success: readColor(states.success, THEME_TOKEN_BASE.states_success),
    states_warning: readColor(states.warning, THEME_TOKEN_BASE.states_warning),
    states_error: readColor(states.error, THEME_TOKEN_BASE.states_error),
    states_info: readColor(states.info, THEME_TOKEN_BASE.states_info),
    shadows_panel: readString(shadows.panel, THEME_TOKEN_BASE.shadows_panel),
    shadows_card: readString(shadows.card, THEME_TOKEN_BASE.shadows_card),
    shadows_button: readString(shadows.button, THEME_TOKEN_BASE.shadows_button),
  };
}

function makePreset(
  scope: string,
  companyName: string,
  logoUrl: string,
  overrides: Partial<ThemeTokenInput>
): BrandingPresetRow {
  return {
    id: scope,
    scope,
    companyName,
    logoUrl,
    tokens: {
      ...THEME_TOKEN_BASE,
      ...overrides,
    },
  };
}

function getPresetLabel(scope: string): string {
  return scope.replace(THEME_PRESET_SCOPE_PREFIX, "");
}

function presetLogoUrl(fileName: string): string {
  return `/logos/${fileName}`;
}

const OOTB_PRESETS: BrandingPresetRow[] = [
  makePreset(
    "theme-preset:servicenow",
    "ServiceNow",
    presetLogoUrl("service-now-logo.svg"),
    {
      palette_bg: "#0b1020",
      palette_surface1: "#122140",
      palette_surface2: "#101f3a",
      palette_accent: "#00acef",
      palette_muted: "#7ea5ce",
      palette_border: "#23416b",
      surfaces_page: "#081224",
      surfaces_panel: "#112649",
      surfaces_card: "#10284f",
      surfaces_sidebar: "#112649",
      typography_fontFamily: "Inter, system-ui, sans-serif",
      typography_headingFontFamily: "Inter, system-ui, sans-serif",
    }
  ),
  makePreset(
    "theme-preset:teamlogicit",
    "TeamLogicIT",
    presetLogoUrl("teamlogicit-logo.svg"),
    {
      palette_bg: "#0b1118",
      palette_surface1: "#162131",
      palette_surface2: "#1f2d3f",
      palette_accent: "#00b8d8",
      palette_muted: "#6b89a8",
      palette_border: "#29475f",
      surfaces_page: "#080c14",
      surfaces_panel: "#132136",
      surfaces_card: "#1a2d46",
      surfaces_sidebar: "#132136",
      typography_fontFamily: "Roboto Condensed, Arial, sans-serif",
      typography_headingFontFamily: "Roboto Condensed, Arial, sans-serif",
      states_focus: "#14c4b5",
    }
  ),
  makePreset(
    "theme-preset:the-open-group",
    "The Open Group",
    "/logos/the-open-group-logo.svg",
    {
      palette_bg: "#10111f",
      palette_surface1: "#1f2342",
      palette_surface2: "#24294d",
      palette_accent: "#7f5cff",
      palette_muted: "#6f75a2",
      palette_border: "#3f4674",
      surfaces_page: "#0a0b16",
      surfaces_panel: "#191d3a",
      surfaces_card: "#20244a",
      surfaces_sidebar: "#191d3a",
      typography_fontFamily: "Inter, Arial, sans-serif",
      typography_headingFontFamily: "Inter, Arial, sans-serif",
      states_hover: "#9b81ff",
      states_info: "#62c0ff",
    }
  ),
  makePreset(
    "theme-preset:state-of-texas",
    "State of TX",
    presetLogoUrl("state-of-texas-logo.svg"),
    {
      palette_bg: "#071827",
      palette_surface1: "#132f48",
      palette_surface2: "#163e63",
      palette_accent: "#bf0a30",
      palette_muted: "#7f9db8",
      palette_border: "#345f7f",
      surfaces_page: "#05111d",
      surfaces_panel: "#103250",
      surfaces_card: "#174066",
      surfaces_sidebar: "#103250",
      surfaces_modal: "#164069",
      shadows_panel: "0 14px 36px rgba(5, 18, 33, 0.52)",
      typography_fontFamily: "Source Sans 3, Arial, sans-serif",
      typography_headingFontFamily: "Merriweather, Georgia, serif",
    }
  ),
  makePreset(
    "theme-preset:rudys",
    "Rudys",
    presetLogoUrl("rudys-logo.svg"),
    {
      palette_bg: "#120d0b",
      palette_surface1: "#231916",
      palette_surface2: "#30231c",
      palette_accent: "#f4a300",
      palette_muted: "#9c7c6a",
      palette_border: "#5a3c2f",
      surfaces_page: "#0f0a09",
      surfaces_panel: "#2b1a16",
      surfaces_card: "#3a251f",
      surfaces_sidebar: "#2b1a16",
      typography_fontFamily: "Nunito, Arial, sans-serif",
      typography_headingFontFamily: "Nunito, Arial, sans-serif",
      states_warning: "#ffb347",
      states_error: "#ff5c5c",
    }
  ),
  makePreset(
    "theme-preset:buccees",
    "Buc-ee's",
    presetLogoUrl("buc-ees-logo.svg"),
    {
      palette_bg: "#070f14",
      palette_surface1: "#0e1f2d",
      palette_surface2: "#0b2a42",
      palette_accent: "#ffc107",
      palette_muted: "#9eb2c2",
      palette_border: "#285e78",
      surfaces_page: "#051016",
      surfaces_panel: "#112f43",
      surfaces_card: "#184462",
      surfaces_sidebar: "#112f43",
      typography_fontFamily: "Poppins, Arial, sans-serif",
      typography_headingFontFamily: "Poppins, Arial, sans-serif",
      states_success: "#4dbf67",
    }
  ),
  makePreset(
    "theme-preset:great-clips",
    "Great Clips",
    presetLogoUrl("great-clips-logo.svg"),
    {
      palette_bg: "#170f14",
      palette_surface1: "#2a1823",
      palette_surface2: "#3a2232",
      palette_accent: "#ff5ca6",
      palette_muted: "#9f8996",
      palette_border: "#58314a",
      surfaces_page: "#120b11",
      surfaces_panel: "#2e1b2a",
      surfaces_card: "#3f2339",
      surfaces_sidebar: "#2e1b2a",
      typography_fontFamily: "Nunito Sans, Arial, sans-serif",
      typography_headingFontFamily: "Nunito Sans, Arial, sans-serif",
      states_hover: "#ff8dc2",
      states_active: "#ff4c93",
    }
  ),
  makePreset(
    "theme-preset:dunkin-donuts",
    "Dunkin' Donuts",
    presetLogoUrl("dunkin-donuts-logo.svg"),
    {
      palette_bg: "#140f10",
      palette_surface1: "#241b1c",
      palette_surface2: "#342424",
      palette_accent: "#f28c28",
      palette_muted: "#9b8c8b",
      palette_border: "#73453b",
      surfaces_page: "#100b0c",
      surfaces_panel: "#2c1d1f",
      surfaces_card: "#3a2a2b",
      surfaces_sidebar: "#2c1d1f",
      typography_fontFamily: "Arial Black, sans-serif",
      typography_headingFontFamily: "Arial Black, sans-serif",
      states_hover: "#ffd16a",
      states_warning: "#ffca6a",
      states_info: "#8ad7ff",
    }
  ),
  makePreset(
    "theme-preset:floyds-glass",
    "Floyds Glass Co.",
    presetLogoUrl("floyds-glass-logo.svg"),
    {
      palette_bg: "#0c1320",
      palette_surface1: "#17233a",
      palette_surface2: "#21314e",
      palette_accent: "#5cb4ff",
      palette_muted: "#8aa0bd",
      palette_border: "#36517b",
      surfaces_page: "#09111b",
      surfaces_panel: "#15233c",
      surfaces_card: "#1f3050",
      surfaces_sidebar: "#15233c",
      typography_fontFamily: "Lato, Arial, sans-serif",
      typography_headingFontFamily: "Lato, Arial, sans-serif",
      states_focus: "#6ce3ff",
    }
  ),
  makePreset(
    "theme-preset:atlassian",
    "Atlassian",
    presetLogoUrl("atlassian-logo.svg"),
    {
      palette_bg: "#0b1d2c",
      palette_surface1: "#16314a",
      palette_surface2: "#1f425f",
      palette_accent: "#0052cc",
      palette_muted: "#7f98ad",
      palette_border: "#2f597d",
      surfaces_page: "#071522",
      surfaces_panel: "#17334d",
      surfaces_card: "#204766",
      surfaces_sidebar: "#17334d",
      typography_fontFamily: "Atlassian Sans, Arial, sans-serif",
      typography_headingFontFamily: "Atlassian Sans, Arial, sans-serif",
      states_hover: "#4ea1ff",
      states_active: "#2f7efc",
    }
  ),
  makePreset(
    "theme-preset:adobe",
    "Adobe",
    presetLogoUrl("adobe-logo.svg"),
    {
      palette_bg: "#100b16",
      palette_surface1: "#1d1428",
      palette_surface2: "#2a1f3b",
      palette_accent: "#ff61f6",
      palette_muted: "#9a8ea3",
      palette_border: "#4d2d65",
      surfaces_page: "#0b0710",
      surfaces_panel: "#211629",
      surfaces_card: "#2f2040",
      surfaces_sidebar: "#211629",
      typography_fontFamily: "Source Sans Pro, Arial, sans-serif",
      typography_headingFontFamily: "Source Sans Pro, Arial, sans-serif",
      states_focus: "#6ce2ff",
      states_success: "#6de4b0",
    }
  ),
  makePreset(
    "theme-preset:open-digital-product-factory",
    "Open Digital Product Factory",
    "/logos/open-digital-product-factory-logo.svg",
    {
      palette_bg: "#071f43",
      palette_surface1: "#11315d",
      palette_surface2: "#163f73",
      palette_accent: "#4f80c7",
      palette_muted: "#7ea0c5",
      palette_border: "#2e5a87",
      typography_fontFamily: "Inter, system-ui, sans-serif",
      typography_headingFontFamily: "Inter, system-ui, sans-serif",
      surfaces_page: "#061b31",
      surfaces_panel: "#102c53",
      surfaces_card: "#173b65",
      surfaces_sidebar: "#102c53",
      surfaces_modal: "#173b65",
      states_hover: "#86a8e2",
      states_info: "#8ec9ff",
      states_success: "#4ade80",
      states_focus: "#72d7ff",
    }
  ),
];

async function getPlatformKeyStatuses(): Promise<Record<string, boolean>> {
  const keys = ["brave_search_api_key"];
  const configs = await prisma.platformConfig.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true },
  });
  const statuses: Record<string, boolean> = {};
  for (const k of keys) {
    const config = configs.find((c) => c.key === k);
    statuses[k] = !!config && typeof config.value === "string" && config.value.length > 0;
  }
  return statuses;
}

export default async function AdminPage() {
  const [users, roles] = await Promise.all([
    prisma.user.findMany({
      orderBy: { email: "asc" },
      select: {
        id: true,
        email: true,
        isActive: true,
        isSuperuser: true,
        createdAt: true,
        groups: {
          select: {
            platformRole: { select: { roleId: true, name: true } },
          },
        },
      },
    }),
    prisma.platformRole.findMany({
      orderBy: { roleId: "asc" },
      select: {
        id: true,
        roleId: true,
        name: true,
      },
    }),
  ]);

  const brandingConfigs: BrandingConfigRow[] = await prisma.brandingConfig.findMany({
    where: { scope: { startsWith: THEME_PRESET_SCOPE_PREFIX } },
    orderBy: { scope: "asc" },
    select: {
      id: true,
      scope: true,
      companyName: true,
      logoUrl: true,
      tokens: true,
    },
  });

  const activeBranding = await prisma.brandingConfig.findUnique({
    where: { scope: "organization" },
    select: {
      companyName: true,
      logoUrl: true,
      tokens: true,
    },
  });

  const savedPresets: BrandingPresetRow[] = brandingConfigs
    .map((preset) => ({
      id: preset.id,
      scope: preset.scope,
      companyName: preset.companyName,
      logoUrl: resolveBrandingLogoUrl(preset.logoUrl, preset.companyName),
      tokens: parseStoredTokens(preset.tokens),
    }))
    .sort((a, b) => a.companyName.localeCompare(b.companyName));

  const activePreset = {
    companyName: activeBranding?.companyName ?? "Custom",
    logoUrl: resolveBrandingLogoUrl(activeBranding?.logoUrl ?? null, activeBranding?.companyName ?? "Custom"),
    tokens: activeBranding ? parseStoredTokens(activeBranding.tokens) : THEME_TOKEN_BASE,
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {users.length} user{users.length !== 1 ? "s" : ""}
        </p>
      </div>

      <AdminTabNav />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {users.map((u) => {
          const statusColour = u.isActive ? "#4ade80" : "#8888a0";
          const statusLabel = u.isActive ? "active" : "inactive";

          return (
            <div
              key={u.id}
              className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4"
              style={{ borderLeftColor: "#8888a0" }}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-sm font-semibold text-white leading-tight truncate">{u.email}</p>
                <div className="flex gap-1 shrink-0">
                  {u.isSuperuser && (
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded-full"
                      style={{ background: "#fbbf2420", color: "#fbbf24" }}
                    >
                      superuser
                    </span>
                  )}
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded-full"
                    style={{ background: `${statusColour}20`, color: statusColour }}
                  >
                    {statusLabel}
                  </span>
                </div>
              </div>
              <p className="text-[9px] text-[var(--dpf-muted)]">Joined {new Date(u.createdAt).toLocaleDateString()}</p>
              {u.groups.length === 0 ? (
                <p className="text-[9px] text-[var(--dpf-muted)] mt-2">No roles assigned</p>
              ) : (
                <div className="flex flex-wrap gap-1 mt-2">
                  {u.groups.map((g) => (
                    <span
                      key={g.platformRole.roleId}
                      className="text-[9px] font-mono text-[var(--dpf-muted)]"
                    >
                      {g.platformRole.roleId}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {users.length === 0 && <p className="text-sm text-[var(--dpf-muted)]">No users registered yet.</p>}

      <div className="mt-8">
        <AdminUserAccessPanel
          roles={roles}
          users={users.map((user) => ({
            id: user.id,
            email: user.email,
          }))}
        />
      </div>

      <div className="mt-8">
        <PlatformKeysPanel keyStatuses={await getPlatformKeyStatuses()} />
      </div>

      <div className="mt-8">
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-white">Branding configuration</h2>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">Set active brand styles and add/organize future presets.</p>
        </div>

        <BrandingConfigurator builtInPresets={OOTB_PRESETS} savedPresets={savedPresets} activePreset={activePreset} />

        <div className="mt-5 rounded-lg bg-[var(--dpf-surface-1)] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-white">Saved presets</h3>
            <p className="text-xs text-[var(--dpf-muted)]">{savedPresets.length} saved</p>
          </div>

          {savedPresets.length === 0 ? (
            <p className="text-sm text-[var(--dpf-muted)]">No custom theme presets yet.</p>
          ) : (
            <div className="space-y-2">
              {savedPresets.map((preset) => (
                <div
                  key={preset.id}
                  className="flex items-start gap-3 p-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]"
                >
                  <div className="w-9 h-9 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] grid place-items-center text-[9px] font-bold text-[var(--dpf-muted)]">
                    {preset.companyName.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{preset.companyName}</p>
                    <p className="text-[10px] text-[var(--dpf-muted)]">{getPresetLabel(preset.scope)}</p>
                  </div>
                  <form action={deleteThemePreset}>
                    <input type="hidden" name="id" value={preset.id} />
                    <button
                      type="submit"
                      className="px-2.5 py-1.5 rounded bg-red-700 text-white text-[10px] font-semibold"
                    >
                      Delete
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}



