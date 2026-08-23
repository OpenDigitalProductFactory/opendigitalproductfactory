// apps/web/lib/ux-budget/scope.ts
//
// L2 measurement scoping — EP-UX-SYSTEM spec §6 L2 (BI-B9BE9A29).
//
// THE RULE THIS FILE ENCODES: progressive disclosure is REWARDED, never taxed.
// A budget that counted every word in the markup would punish the exact fix it is
// supposed to encourage — moving professional detail behind a <details> or a
// disclosure region. So before anything is measured, collapsed subtrees are
// EXCISED. Content the owner cannot see on arrival does not count against them.
//
// Why a tag scanner rather than a regex: a regex cannot match a closing tag to its
// opening tag, so `<details><div>…</div></details>` would be truncated at the first
// `</div>` and leak the tail of a collapsed subtree into the measured scope — the
// budget would then silently measure the wrong thing, which is worse than not
// measuring at all. This walks the tag stream and tracks depth.
//
// Input is an HTML string. The route sweep (BI-BD81682A) serialises the SERVED DOM
// after hydration, so client components and their real state are present; this
// module then applies the structural disclosure semantics. Computed-style
// invisibility (e.g. a `hidden md:block` utility) is the browser's job to prune
// before serialising — see `isStructurallyHidden` for what is handled here.

/** Elements that never have a closing tag. */
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** Elements whose text is never rendered to the reader. */
const NON_RENDERED = new Set(["script", "style", "template", "noscript"]);

/** Marks a region as progressive disclosure; excised unless explicitly open. */
export const DISCLOSURE_ATTR = "data-dpf-disclosure";

/**
 * Marks a container that DEFERS content behind its own trigger, where the container
 * itself stays visible on arrival — the canonical React constructs
 * (`ExpandableCard`, `CollapsibleList`) rather than a native `<details>`.
 *
 * WHY THIS IS SEPARATE FROM `DISCLOSURE_ATTR` (BI-2B196D07). Those constructs omit
 * the deferred subtree from the DOM entirely when collapsed (`{open && …}`,
 * `rows.slice(0, previewCount)`), so on arrival there is no subtree left to excise —
 * only a visible summary and a trigger. Reusing `DISCLOSURE_ATTR` would therefore be
 * actively wrong: `isStructurallyHidden` would excise the whole card INCLUDING the
 * summary the owner reads, under-counting words and hiding any primary action inside
 * it. So this attribute makes the region COUNTABLE without making it excisable.
 *
 * Before this existed, a surface built from the prescribed constructs measured zero
 * disclosure regions and FAILED the blocking `deferred-detail` check, while the same
 * surface using a raw `<details>` — the construct the kernel principle ranks lowest —
 * passed. The measurement inverted the doctrine it exists to enforce.
 */
export const DISCLOSURE_TRIGGER_ATTR = "data-dpf-disclosure-trigger";

/** Marks the lead band — the first thing the owner reads. Budgeted separately. */
export const LEAD_ATTR = "data-dpf-lead";

export type TagToken = {
  /** Lowercased tag name. */
  name: string;
  /** Lowercased attribute name -> value ("" for valueless attributes). */
  attrs: Record<string, string>;
  /** True for `<br/>`-style self-closing syntax. */
  selfClosing: boolean;
};

// Matches a tag while tolerating `>` inside quoted attribute values.
//
// The alternation branches are mutually exclusive BY CONSTRUCTION: the catch-all
// excludes both quote characters, so a `"` can only ever be consumed by the quoted
// branch. An earlier version used `[^>]` there, which let `""` be matched two
// different ways and made the pattern exponentially backtrack on input like
// `<a""""""…` (CodeQL js/redos). Unambiguous branches also mean the quantifier can be
// greedy rather than lazy, which is what removes the backtracking entirely.
//
// Self-closing syntax is detected from the captured attribute text rather than a
// trailing `(\/?)` group, because with a greedy catch-all the `/` of `<br/>` is
// consumed as attribute text before such a group could see it.
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** `<br/>` and `<img … />`: the trailing slash lands in the captured attribute text. */
function hasSelfClosingSlash(rawAttrs: string): boolean {
  return /\/\s*$/.test(rawAttrs);
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(raw)) !== null) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

/**
 * Remove every subtree whose opening tag satisfies `shouldRemove`, matching close
 * tags by depth so nested markup cannot truncate the removal early.
 */
export function removeSubtrees(
  html: string,
  shouldRemove: (tag: TagToken) => boolean,
): string {
  let out = "";
  let cursor = 0;
  // Non-null while skipping: the tag name being skipped and how deep we are in it.
  let skipping: { name: string; depth: number } | null = null;

  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(html)) !== null) {
    const [full, closeSlash, rawName, rawAttrs] = m;
    const name = rawName.toLowerCase();
    const isClose = closeSlash === "/";
    const isVoid = VOID_ELEMENTS.has(name) || hasSelfClosingSlash(rawAttrs);

    if (skipping) {
      // Only same-name tags move the depth counter; everything else is swallowed.
      if (name === skipping.name && !isVoid) {
        if (isClose) {
          skipping.depth -= 1;
          if (skipping.depth === 0) {
            skipping = null;
            cursor = m.index + full.length;
          }
        } else {
          skipping.depth += 1;
        }
      }
      continue;
    }

    if (isClose) continue;

    const tag: TagToken = { name, attrs: parseAttrs(rawAttrs), selfClosing: isVoid };
    if (!shouldRemove(tag)) continue;

    out += html.slice(cursor, m.index);
    if (isVoid) {
      // No subtree to skip — drop the single tag.
      cursor = m.index + full.length;
    } else {
      skipping = { name, depth: 1 };
    }
  }

  // An unclosed skipped element swallows the remainder, which is the safe
  // direction: unparseable markup must not silently inflate the measured scope.
  return skipping ? out : out + html.slice(cursor);
}

/**
 * Extract the outerHTML of every subtree whose opening tag satisfies `predicate`.
 * Nested matches are not descended into — the outermost match wins.
 */
export function extractSubtrees(
  html: string,
  predicate: (tag: TagToken) => boolean,
): string[] {
  const found: string[] = [];
  let capture: { name: string; depth: number; start: number } | null = null;

  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(html)) !== null) {
    const [full, closeSlash, rawName, rawAttrs] = m;
    const name = rawName.toLowerCase();
    const isClose = closeSlash === "/";
    const isVoid = VOID_ELEMENTS.has(name) || hasSelfClosingSlash(rawAttrs);

    if (capture) {
      if (name === capture.name && !isVoid) {
        if (isClose) {
          capture.depth -= 1;
          if (capture.depth === 0) {
            found.push(html.slice(capture.start, m.index + full.length));
            capture = null;
          }
        } else {
          capture.depth += 1;
        }
      }
      continue;
    }

    if (isClose) continue;
    const tag: TagToken = { name, attrs: parseAttrs(rawAttrs), selfClosing: isVoid };
    if (!predicate(tag)) continue;

    if (isVoid) found.push(full);
    else capture = { name, depth: 1, start: m.index };
  }
  return found;
}

/** True when an attribute is present and not explicitly negated. */
function flagOn(attrs: Record<string, string>, name: string): boolean {
  if (!(name in attrs)) return false;
  const v = attrs[name].toLowerCase();
  return v !== "false" && v !== "closed";
}

/**
 * Structurally hidden on arrival: `hidden`, `aria-hidden="true"`, a collapsed
 * `<details>`, or a disclosure region that is not explicitly open.
 *
 * `DISCLOSURE_TRIGGER_ATTR` is deliberately absent: that marker means "this container
 * defers content behind a trigger", and the container itself is visible on arrival.
 * Excising it would delete the summary the owner actually reads.
 */
export function isStructurallyHidden(tag: TagToken): boolean {
  if (flagOn(tag.attrs, "hidden")) return true;
  if (tag.attrs["aria-hidden"]?.toLowerCase() === "true") return true;
  if (tag.name === "details" && !("open" in tag.attrs)) return true;
  if (DISCLOSURE_ATTR in tag.attrs && !("open" in tag.attrs)) return true;
  return false;
}

/** True when the element carries progressive-disclosure semantics at all. */
export function isDisclosureRegion(tag: TagToken): boolean {
  return (
    tag.name === "details" ||
    DISCLOSURE_ATTR in tag.attrs ||
    DISCLOSURE_TRIGGER_ATTR in tag.attrs
  );
}

/**
 * The scope a budget is measured against: what the owner actually sees on arrival.
 * Non-rendered tags go first so a `<script>` containing markup-shaped strings
 * cannot confuse the disclosure pass.
 */
export function defaultVisibleHtml(html: string): string {
  const rendered = removeSubtrees(html, (tag) => NON_RENDERED.has(tag.name));
  return removeSubtrees(promoteClosedSummaries(rendered), isStructurallyHidden);
}

/**
 * A closed `<details>` still SHOWS its `<summary>` — that label is the row the
 * reader scans. Excising the whole subtree therefore under-counts every
 * disclosure-based list, and rewards the wrong thing: a page could hide 92 rows
 * behind 92 collapsed summaries and measure as if the screen were empty.
 *
 * Found while migrating `/platform/ai/skills` (BI-36CE8BAB): the redesigned
 * catalog measured 10 default-visible words, when a reader actually meets 92 row
 * labels. Lifting the summaries out before the disclosure pass keeps the
 * deferred BODY excised — which is the behaviour progressive disclosure should
 * earn — while still counting what is on screen.
 */
function promoteClosedSummaries(html: string): string {
  // Depth-aware, not a regex: these nest. A collapsed category containing
  // collapsed rows is the exact shape a grouped catalog produces, and a lazy
  // regex matches the first `</details>` it sees — which belongs to the INNER
  // element — mangling the parse and inventing a word count.
  //
  // extractSubtrees captures outermost-first and skips nested matches, which is
  // precisely right here: rows inside a COLLAPSED group are not on screen, so
  // they disappear with the group. If the group is open the predicate misses it,
  // the scan descends, and each row is then judged on its own.
  const closedDetails = extractSubtrees(
    html,
    (tag) => tag.name === "details" && !("open" in tag.attrs),
  );

  let out = html;
  for (const block of closedDetails) {
    const summary = extractSubtrees(block, (tag) => tag.name === "summary")[0];
    // A <details> with no <summary> shows a UA-default label; nothing of the
    // author's to count, so let the normal excision handle it.
    out = out.replace(block, summary ? `<div data-dpf-was-summary="">${summary}</div>` : "");
  }
  return out;
}

/** The lead band(s) — concatenated, already scoped to what is visible. */
export function leadBandHtml(html: string): string {
  return extractSubtrees(defaultVisibleHtml(html), (tag) => LEAD_ATTR in tag.attrs).join("\n");
}

/** How many disclosure regions the surface defers detail into. */
export function countDisclosureRegions(html: string): number {
  const rendered = removeSubtrees(html, (tag) => NON_RENDERED.has(tag.name));
  return extractSubtrees(rendered, isDisclosureRegion).length;
}

/**
 * The ROUTE-OWNED region of a surface: the `<main>` landmark when the shell
 * marks one, otherwise the whole scope unchanged.
 *
 * Only the reading-level axis uses this (BI-0ED0F6B3). Every other budget is
 * about what the owner MEETS on arrival, and the shell's header and rail are
 * part of that; but a reading grade computed over shared chrome measures the
 * chrome, identically, on all 202 routes, and drowns whatever the page itself
 * says. Word and control counts keep their existing whole-surface scope.
 */
export function routeContentHtml(html: string): string {
  const mains = extractSubtrees(html, (tag) => tag.name === "main");
  if (mains.length === 0) return html;
  const scoped = mains.join("\n");
  // A `<main>` that does not actually hold the page's words is not the route's
  // content — it is a landmark wrapped around a client shell, a portal target, or
  // (in a component test) a mocked-out subtree. Scoping to it would grade a
  // scrap: /platform/ai/skills renders a one-word <main> under test and would
  // have been graded on that single word. Below half the surface's words, keep
  // the whole scope; a diluted grade beats a grade of the wrong thing.
  return words(scoped) * 2 >= words(html) ? scoped : html;
}

function words(html: string): number {
  return (html.replace(/<[^>]*>/g, " ").match(/[a-zA-Z0-9]+/g) ?? []).length;
}
