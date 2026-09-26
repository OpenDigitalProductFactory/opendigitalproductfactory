/**
 * Markdown -> DOCX for the architecture document set, through the portal's own
 * document-export pipeline (plan 2026-09-08 M2, BI-DBDB8C6D).
 *
 * The Markdown files are the editable source of truth; the .docx files are
 * publication artifacts. Generation runs in three steps, each owned elsewhere:
 *
 *   1. Mermaid diagrams render to SVG + high-resolution PNG through
 *      scripts/lib/mermaid-renderer.mjs (a tool image, not a dependency).
 *   2. Markdown becomes a standalone HTML document through
 *      apps/web/lib/documents/markdown-to-html.ts, the renderer the portal uses
 *      to export a markdown document. Local diagram images are inlined as
 *      data: URIs first, because the converter runs with no network and no
 *      host mounts.
 *   3. HTML becomes .docx in the dpf-doctools image (`dpf-convert --from html
 *      --to docx`), started with the portal's hardened argv
 *      (apps/web/lib/documents/conversion/command.ts).
 *
 * This replaced a bespoke generator built on the `docx` npm package, which was
 * a root devDependency for these four scripts alone.
 *
 * Run through tsx (the `pnpm docs:*` scripts do), which loads the portal's
 * TypeScript modules. Converting needs Docker and DPF_DOCTOOLS_IMAGE set to a
 * digest-pinned dpf-doctools reference; see DOCTOOLS_HINT.
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..", "..");

/** Largest HTML handed to the converter; equals dpf-convert's own default cap. */
export const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const ENGINE_TIMEOUT_SECONDS = 300;

const IMAGE_MIME = Object.freeze({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" });

export const DOCTOOLS_HINT =
  "\n  Converting to .docx needs Docker and DPF_DOCTOOLS_IMAGE naming a digest-pinned dpf-doctools image:" +
  "\n    - a published one: ghcr.io/opendigitalproductfactory/dpf-doctools@sha256:<digest>, or" +
  "\n    - a local build: `docker build -f Dockerfile.doctools -t dpf-doctools .`, then the sha256:<id>" +
  "\n      that `docker image inspect --format '{{.Id}}' dpf-doctools` prints.";

async function importFromRoot(relativePath) {
  return import(pathToFileURL(join(ROOT, relativePath)).href);
}

async function renderMermaidDiagrams(diagramsDir) {
  if (!diagramsDir || !existsSync(diagramsDir)) return;
  const { availableMermaidRenderer, renderMermaid, MERMAID_RENDERER_HINT } = await importFromRoot("scripts/lib/mermaid-renderer.mjs");

  const pngDir = join(diagramsDir, "png");
  const svgDir = join(diagramsDir, "svg");
  const mmdConfig = join(diagramsDir, "mermaid-config.json");
  mkdirSync(pngDir, { recursive: true });
  mkdirSync(svgDir, { recursive: true });

  const mmdFiles = readdirSync(diagramsDir).filter((file) => file.endsWith(".mmd"));
  console.log(`Rendering ${mmdFiles.length} Mermaid diagrams from ${diagramsDir}...`);
  const renderer = availableMermaidRenderer();
  if (mmdFiles.length > 0 && !renderer) {
    console.warn(`  WARN: no Mermaid renderer available; the committed diagram images are used as they are.${MERMAID_RENDERER_HINT}`);
    return;
  }

  for (const file of mmdFiles) {
    const input = join(diagramsDir, file);
    const base = file.replace(".mmd", "");
    const pngOutput = join(pngDir, `${base}.png`);
    const svgOutput = join(svgDir, `${base}.svg`);
    const configMtime = existsSync(mmdConfig) ? statSync(mmdConfig).mtimeMs : 0;
    const freshnessFloor = Math.max(statSync(input).mtimeMs, configMtime);
    if (existsSync(svgOutput) && statSync(svgOutput).mtimeMs >= freshnessFloor) {
      console.log(`  ${file} -> up to date`);
      continue;
    }
    console.log(`  ${file} -> svg, png`);
    try {
      const configFile = existsSync(mmdConfig) ? mmdConfig : undefined;
      renderMermaid({ input, output: svgOutput, configFile, background: "white", renderer });
      renderMermaid({ input, output: pngOutput, configFile, background: "white", scale: 4, renderer });
    } catch (err) {
      const message = err?.stderr?.toString?.().split("\n")[0] || err?.message || "Unknown render error";
      console.error(`  WARN: Failed to render ${file}: ${message}`);
    }
  }
}

/**
 * The raster file to embed for a local image reference. An SVG diagram is
 * swapped for its PNG companion (`<dir>/svg/x.svg` -> `<dir>/png/x.png`):
 * the portal's export renderer embeds raster images only.
 */
export function embeddableImagePath(localPath) {
  const ext = extname(localPath).toLowerCase();
  if (ext === ".svg") {
    const png = join(dirname(dirname(localPath)), "png", `${basename(localPath, ext)}.png`);
    return existsSync(png) ? png : null;
  }
  return IMAGE_MIME[ext] && existsSync(localPath) ? localPath : null;
}

const IMAGE_REF = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(\s+"[^"]*")?\s*\)/g;

/**
 * Inline every local image reference as a base64 data: URI, outside fenced
 * code. A remote or missing image is left as written; the export renderer
 * turns it into its alt text.
 */
export function inlineLocalImages(markdown, baseDir) {
  let fence = null;
  return markdown
    .split("\n")
    .map((line) => {
      const marker = line.match(/^\s*(```+|~~~+)/);
      if (marker) {
        if (!fence) fence = marker[1].slice(0, 3);
        else if (marker[1].startsWith(fence)) fence = null;
        return line;
      }
      if (fence) return line;
      return line.replace(IMAGE_REF, (whole, alt, href) => {
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return whole;
        const file = embeddableImagePath(resolve(baseDir, decodeURI(href)));
        if (!file) return whole;
        const mime = IMAGE_MIME[extname(file).toLowerCase()];
        return `![${alt}](data:${mime};base64,${readFileSync(file).toString("base64")})`;
      });
    })
    .join("\n");
}

/** The subtitle and generation date go under the document's own H1 title. */
export function withPublicationFrontMatter(markdown, { subtitle, generatedOn }) {
  const lines = markdown.split("\n");
  const titleIndex = lines.findIndex((line) => /^#\s/.test(line));
  const frontMatter = ["", ...(subtitle ? [`**${subtitle}**`, ""] : []), `*Generated ${generatedOn}*`];
  lines.splice(titleIndex + 1, 0, ...frontMatter);
  return lines.join("\n");
}

/** Markdown file -> the standalone HTML document the converter reads. */
export async function publicationHtml({ markdownPath, title, subtitle, generatedOn = new Date().toISOString().slice(0, 10) }) {
  const { markdownToHtmlDocument } = await importFromRoot("apps/web/lib/documents/markdown-to-html.ts");
  const markdown = readFileSync(markdownPath, "utf8").replace(/\r\n?/g, "\n");
  const prepared = withPublicationFrontMatter(inlineLocalImages(markdown, dirname(markdownPath)), { subtitle, generatedOn });
  return markdownToHtmlDocument(prepared, title);
}

/** The hardened one-shot `docker run` of dpf-convert, from the portal's own builder. */
export async function doctoolsCommand(image) {
  const { buildConverterCommand } = await importFromRoot("apps/web/lib/documents/conversion/command.ts");
  return buildConverterCommand({
    image,
    containerName: `dpf-doctools-${randomBytes(6).toString("hex")}`,
    to: "docx",
    from: "html",
    maxInputBytes: MAX_INPUT_BYTES,
    engineTimeoutSeconds: ENGINE_TIMEOUT_SECONDS,
  });
}

async function convertHtmlToDocx(html, image) {
  const { command, args } = await doctoolsCommand(image);
  const input = Buffer.from(html, "utf8");
  if (input.length > MAX_INPUT_BYTES) throw new Error(`HTML is ${input.length} bytes, over the ${MAX_INPUT_BYTES}-byte converter cap`);
  const result = spawnSync(command, args, {
    input,
    maxBuffer: 200 * 1024 * 1024,
    timeout: (ENGINE_TIMEOUT_SECONDS + 30) * 1000,
  });
  if (result.error) throw new Error(`docker could not run: ${result.error.message}${DOCTOOLS_HINT}`);
  if (result.status !== 0 || result.stdout.length === 0) {
    const detail = result.stderr?.toString().trim().split("\n").pop() || "no output";
    throw new Error(`dpf-convert exited ${result.status}: ${detail}`);
  }
  return result.stdout;
}

export async function generateDocxFromMarkdown({ markdownPath, outputPath, title, subtitle, diagramsDir }) {
  const image = process.env.DPF_DOCTOOLS_IMAGE?.trim();
  if (!image) throw new Error(`DPF_DOCTOOLS_IMAGE is not set.${DOCTOOLS_HINT}`);

  await renderMermaidDiagrams(diagramsDir);
  const html = await publicationHtml({ markdownPath, title, subtitle });
  const docx = await convertHtmlToDocx(html, image);
  writeFileSync(outputPath, docx);
  console.log(`Done! Output: ${outputPath}`);
  console.log(`File size: ${(docx.length / 1024).toFixed(0)} KB`);
}
