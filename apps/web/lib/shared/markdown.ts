// apps/web/lib/shared/markdown.ts
//
// The one markdown renderer (plan 2026-09-08 M5; founder decision 2026-09-26,
// WWMD ledger DI-D9292D812CFF). Every surface that shows markdown (the user
// guide, wiki pages, coworker chat, build briefs, workspace documents and the
// office-document export) renders through renderMarkdown(), on markdown-it.
// It replaced react-markdown and remark-gfm.
//
// Raw HTML is off. HTML written inside the markdown is shown as text, never
// rendered, so model output, wiki bodies and uploaded documents cannot inject
// markup. Link and image URLs go through markdown-it's validateLink, which
// refuses javascript:, vbscript:, file: and non-image data: URLs; a refused
// link stays as literal text.
//
// GFM coverage: tables, strikethrough and autolinked URLs come from
// markdown-it's defaults plus linkify; task-list items (`- [ ]`, `- [x]`) are
// the small core rule below, rendered as disabled checkboxes.
//
// One parser instance serves every caller. What differs per surface (element
// classes, link resolution, heading ids, a fence hook, wikilinks, offline
// images) travels in markdown-it's `env`, which every rule receives, so no
// caller ever builds a second parser.
//
// Pure: no React, no server-only imports. Server components, client
// components and server code import it alike. Components show the result
// through <MarkdownHtml>, the one place the HTML reaches the DOM.

import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";

/** Elements a caller can give a class to. `code` is inline code; `pre` wraps a code block. */
export type MarkdownElement =
  | "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
  | "p" | "ul" | "ol" | "li" | "blockquote" | "hr"
  | "a" | "strong" | "em" | "s" | "code" | "pre" | "img"
  | "table" | "thead" | "tbody" | "tr" | "th" | "td";

export type MarkdownLink = { href: string; external?: boolean };

export type RenderMarkdownOptions = {
  /** Class names per element. Tailwind picks them up from the calling file. */
  classes?: Partial<Record<MarkdownElement, string>>;
  /** Wrap each table in a <div> with this class (for horizontal scroll). */
  tableWrapperClass?: string;
  /** Give a heading an id. Return undefined to leave it without one. */
  headingId?: (text: string, level: number) => string | undefined;
  /** Rewrite a link target. An external result opens in a new tab. */
  resolveLink?: (href: string) => MarkdownLink;
  /** With no resolveLink: open absolute http(s) links in a new tab. */
  externalLinksInNewTab?: boolean;
  /** Rewrite an image source. Null renders the image as `[alt]` text. */
  resolveImage?: (src: string, alt: string) => string | null;
  /**
   * Render a fenced block yourself. Return trusted HTML, or null for the
   * default <pre><code>. The caller owns escaping in what it returns.
   */
  renderFence?: (language: string, content: string) => string | null;
  /** Turn `[[slug]]` and `[[slug|label]]` into links to this href. */
  wikilinkHref?: (slug: string) => string;
};

type Env = { options: RenderMarkdownOptions };

const md = new MarkdownIt({ html: false, linkify: true, typographer: false });

/** Escape text for HTML content or a double-quoted attribute. */
export const escapeHtml: (value: string) => string = md.utils.escapeHtml;

function optionsOf(env: unknown): RenderMarkdownOptions {
  return (env as Env | undefined)?.options ?? {};
}

function inlineText(token: Token | undefined): string {
  if (!token?.children) return token?.content ?? "";
  return token.children
    .filter((child) => child.type === "text" || child.type === "code_inline")
    .map((child) => child.content)
    .join("");
}

// ─── Task lists ─────────────────────────────────────────────────────────────

const TASK_MARKER = /^\[([ xX])\]\s+/;

function taskLists(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i];
    if (inline.type !== "inline") continue;
    if (tokens[i - 1].type !== "paragraph_open" || tokens[i - 2].type !== "list_item_open") continue;
    const match = TASK_MARKER.exec(inline.content);
    if (!match) continue;
    const first = inline.children?.[0];
    if (!first || first.type !== "text" || !TASK_MARKER.test(first.content)) continue;
    first.content = first.content.replace(TASK_MARKER, "");
    const checkbox = new state.Token("html_inline", "", 0);
    checkbox.content = `<input type="checkbox" disabled${match[1] === " " ? "" : " checked"}> `;
    inline.children!.unshift(checkbox);
    // The checkbox is the item marker, so the list bullet goes (as on GitHub).
    tokens[i - 2].attrJoin("class", "task-list-item list-none");
  }
}

// ─── Classes and heading ids ────────────────────────────────────────────────

function applyClasses(tokens: Token[], classes: RenderMarkdownOptions["classes"]): void {
  if (!classes) return;
  for (const token of tokens) {
    if (token.nesting !== -1 && token.tag in classes && token.type !== "fence" && token.type !== "code_block") {
      const cls = classes[token.tag as MarkdownElement];
      if (cls) token.attrJoin("class", cls);
    }
    if (token.children) applyClasses(token.children, classes);
  }
}

function decorate(state: StateCore): void {
  const options = optionsOf(state.env);
  applyClasses(state.tokens, options.classes);
  if (options.headingId) {
    state.tokens.forEach((token, i) => {
      if (token.type !== "heading_open") return;
      const id = options.headingId!(inlineText(state.tokens[i + 1]), Number(token.tag.slice(1)));
      if (id) token.attrSet("id", id);
    });
  }
}

// ─── Wikilinks ──────────────────────────────────────────────────────────────

const WIKILINK = /^\[\[([a-zA-Z0-9/_-]+)(?:\|([^\]]+))?\]\]/;

function wikilink(state: StateInline, silent: boolean): boolean {
  const hrefFor = optionsOf(state.env).wikilinkHref;
  if (!hrefFor) return false;
  if (state.src.charCodeAt(state.pos) !== 0x5b || state.src.charCodeAt(state.pos + 1) !== 0x5b) return false;
  const match = WIKILINK.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) {
    const open = state.push("link_open", "a", 1);
    open.attrs = [["href", hrefFor(match[1])]];
    open.info = "wikilink";
    const text = state.push("text", "", 0);
    text.content = match[2] ?? match[1];
    state.push("link_close", "a", -1);
  }
  state.pos += match[0].length;
  return true;
}

md.core.ruler.after("inline", "dpf_task_lists", taskLists);
md.core.ruler.push("dpf_decorate", decorate);
md.inline.ruler.before("link", "dpf_wikilink", wikilink);

// ─── Renderer rules ─────────────────────────────────────────────────────────

const renderToken = md.renderer.renderToken.bind(md.renderer);

md.renderer.rules.link_open = (tokens, idx, _opts, env) => {
  const token = tokens[idx];
  const options = optionsOf(env);
  const href = token.attrGet("href") ?? "";
  let external = false;
  if (options.resolveLink && token.info !== "wikilink") {
    const resolved = options.resolveLink(href);
    token.attrSet("href", resolved.href);
    external = resolved.external === true;
  } else if (options.externalLinksInNewTab) {
    external = /^https?:\/\//i.test(href);
  }
  if (external) {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noopener noreferrer");
  }
  return renderToken(tokens, idx, _opts);
};

md.renderer.rules.image = (tokens, idx, opts, env, self) => {
  const token = tokens[idx];
  const options = optionsOf(env);
  const alt = self.renderInlineAsText(token.children ?? [], opts, env);
  if (options.resolveImage) {
    const src = options.resolveImage(token.attrGet("src") ?? "", alt);
    if (src === null) return alt ? escapeHtml(`[${alt}]`) : "";
    token.attrSet("src", src);
  }
  token.attrSet("alt", alt);
  return renderToken(tokens, idx, opts);
};

function codeBlock(language: string, content: string, env: unknown): string {
  const options = optionsOf(env);
  const custom = options.renderFence?.(language, content);
  if (custom !== null && custom !== undefined) return custom;
  const preClass = options.classes?.pre ? ` class="${escapeHtml(options.classes.pre)}"` : "";
  const codeClass = language ? ` class="language-${escapeHtml(language)}"` : "";
  return `<pre${preClass}><code${codeClass}>${escapeHtml(content)}</code></pre>\n`;
}

md.renderer.rules.fence = (tokens, idx, _opts, env) => {
  const token = tokens[idx];
  const language = md.utils.unescapeAll(token.info).trim().split(/\s+/)[0] ?? "";
  return codeBlock(language, token.content, env);
};

md.renderer.rules.code_block = (tokens, idx, _opts, env) => codeBlock("", tokens[idx].content, env);

md.renderer.rules.table_open = (tokens, idx, opts, env) => {
  const wrapper = optionsOf(env).tableWrapperClass;
  const table = renderToken(tokens, idx, opts);
  return wrapper ? `<div class="${escapeHtml(wrapper)}">\n${table}` : table;
};

md.renderer.rules.table_close = (tokens, idx, opts, env) => {
  const table = renderToken(tokens, idx, opts);
  return optionsOf(env).tableWrapperClass ? `${table}</div>\n` : table;
};

/** Render markdown to HTML. Raw HTML in the source is escaped, never rendered. */
export function renderMarkdown(source: string, options: RenderMarkdownOptions = {}): string {
  const env: Env = { options };
  return md.render(source ?? "", env);
}
