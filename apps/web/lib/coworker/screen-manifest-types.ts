// Pseudo-User Contract (spec §6.1) — ScreenManifest type definitions.
//
// A ScreenManifest is the declarative contract a page publishes about what
// a coworker can do on it: what entities can be selected, where it can
// navigate, what panels exist, what forms it has, and which domain (MCP)
// actions are meaningful here. The manifest is the single source of truth
// for the page's coworker-drivable surface — the lint (screen-manifest-lint
// .ts) checks it against the real PLATFORM_TOOLS registry; the runtime
// (screen-manifest-registry.ts) publishes it so the chat handler can read
// it; the React hook (use-screen-manifest.ts) wires the page lifecycle.
//
// BI-D9487754 / EP-COWORKER-INTERACTIVITY.

/** Reference to an entity that can appear in a SelectionDescriptor's list. */
export interface EntityRef {
  /** Stable id — matches what applySelection receives. */
  id: string;
  /** Human-readable label shown in the chat UI. */
  label: string;
}

/** A list-like selection a coworker can change on the user's behalf. */
export interface SelectionDescriptor {
  selectionId: string;
  /** Short human-readable label (e.g. "Build"). */
  label: string;
  /** Domain entity kind — purely informational for the chat handler. */
  entityType: string;
  /** Returns the current options the coworker can pick from. */
  listSource: () => Promise<EntityRef[]>;
  /** Set the selection to the named entity. Must be a real function (lint
   *  invariant MANIFEST-009). */
  applySelection: (entityId: string) => void;
}

/** A navigation the coworker can trigger (route change within the app). */
export interface NavigationDescriptor {
  navigationId: string;
  label: string;
  /** Route pattern, e.g. "/build" or "/build/:buildId". */
  route: string;
  /** Optional declared params — informational; the chat handler may use
   *  these to validate args before dispatching. */
  paramSchema?: Record<string, "string" | "number">;
  /** Perform the navigation. Lint invariant MANIFEST-010. */
  apply: (params?: Record<string, string>) => void;
}

/** A panel (collapsible region, sidebar drawer, modal) the coworker can
 *  open or close. */
export interface PanelDescriptor {
  panelId: string;
  label: string;
  describeOpenState: () => boolean;
  open: () => void;
  close: () => void;
}

/** A single field within a form. */
export interface FieldDescriptor {
  fieldId: string;
  label: string;
  /** Field type — keep extensible via the string fallback so platform
   *  custom widgets don't break the lint. */
  type:
    | "text"
    | "number"
    | "email"
    | "tel"
    | "select"
    | "checkbox"
    | "textarea"
    | "date"
    | "url"
    | "password";
  required: boolean;
  /** Set the field value. The visible-cue contract for form fills
   *  (BI-5696B4D7) is implemented INSIDE this setter at the page layer —
   *  the manifest only commits to the function existing. */
  setValue: (value: unknown) => void;
}

/** A form on the page that a coworker can pre-fill and (optionally) submit. */
export interface FormDescriptor {
  formId: string;
  label: string;
  fields: FieldDescriptor[];
  /** How the form is submitted — references a real MCP tool. The argMap
   *  describes how field values flow into tool arguments (lint validates
   *  only the tool name; runtime resolves the mapping). */
  submit: {
    tool: string;
    argMap: Record<string, string>;
  };
  /** When true, submission is treated as destructive and goes through the
   *  envelope flow (spec §6.4) regardless of MCP annotations. */
  destructive: boolean;
}

/** A reference from a manifest to a real MCP tool, with the optional
 *  default args bound from the current screen state. */
export interface DomainActionRef {
  /** Manifest-local id (used by destructiveActions and chat propose calls). */
  actionId: string;
  /** MUST match a PLATFORM_TOOLS entry name. Lint invariant MANIFEST-001. */
  tool: string;
  label: string;
  /** Static default args; the page may merge dynamic state at invoke time. */
  defaultArgs?: Record<string, unknown>;
  /** Invoke the underlying tool with merged args. */
  invoke: (args?: Record<string, unknown>) => Promise<void>;
}

/** The complete declarative contract for a page's coworker-drivable
 *  surface. Pages publish their manifest via the useScreenManifest hook;
 *  the lint validates each entry against PLATFORM_TOOLS and uniqueness
 *  invariants. */
export interface ScreenManifest {
  /** Globally unique among all registered manifests (lint MANIFEST-000). */
  surfaceId: string;
  /** Route pattern this manifest applies to. Supports `:param` placeholders. */
  routePattern: string;
  /** Short label for chat-side rendering ("Build Studio"). */
  label: string;
  selections: SelectionDescriptor[];
  navigations: NavigationDescriptor[];
  panels: PanelDescriptor[];
  forms: FormDescriptor[];
  domainActions: DomainActionRef[];
  /** Subset of domainActions[].actionId — these go through the envelope
   *  flow even if not flagged destructive by their tool's MCP annotations.
   *  Lint MANIFEST-002. */
  destructiveActions: string[];
}
