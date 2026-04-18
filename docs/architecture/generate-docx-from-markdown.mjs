/**
 * Generic Markdown -> DOCX generator for the architecture document set.
 *
 * Features:
 * - optional Mermaid rendering to SVG + high-resolution PNG
 * - basic Markdown support: headings, paragraphs, lists, tables, code fences
 * - inline links, emphasis, strong, inline code
 * - image embedding from local files
 *
 * This is intentionally conservative. The Markdown files are the editable
 * source of truth; generated DOCX files are publication artifacts.
 */

import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";

import { marked } from "marked";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  NumberFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  StyleLevel,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
} from "docx";

const ROOT = resolve(import.meta.dirname, "..", "..");
const NAVY = "1e3a5f";
const MID_BLUE = "1565c0";
const LIGHT_BLUE = "e8f0fe";
const WHITE = "ffffff";
const LIGHT_GRAY = "f5f5f5";
const DARK_GRAY = "333333";
const BLOCK_IMAGE_MAX = { width: 620, height: 700 };
const INLINE_IMAGE_MAX = { width: 360, height: 240 };
const CELL_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 1, color: "cccccc" },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: "cccccc" },
  left: { style: BorderStyle.SINGLE, size: 1, color: "cccccc" },
  right: { style: BorderStyle.SINGLE, size: 1, color: "cccccc" },
};

function findChrome() {
  const cacheDir = join(homedir(), ".cache", "puppeteer", "chrome");
  if (!existsSync(cacheDir)) return null;
  const versions = readdirSync(cacheDir).filter((entry) => entry.startsWith("win64-"));
  if (versions.length === 0) return null;
  versions.sort().reverse();
  const exe = join(cacheDir, versions[0], "chrome-win64", "chrome.exe");
  return existsSync(exe) ? exe : null;
}

function renderMermaidDiagrams(diagramsDir) {
  if (!diagramsDir || !existsSync(diagramsDir)) return;

  const pngDir = join(diagramsDir, "png");
  const svgDir = join(diagramsDir, "svg");
  const mmdConfig = join(diagramsDir, "mermaid-config.json");
  if (!existsSync(pngDir)) mkdirSync(pngDir, { recursive: true });
  if (!existsSync(svgDir)) mkdirSync(svgDir, { recursive: true });

  const chromePath = findChrome();
  const env = { ...process.env };
  if (chromePath) env.PUPPETEER_EXECUTABLE_PATH = chromePath;

  const mmdFiles = readdirSync(diagramsDir).filter((file) => file.endsWith(".mmd"));
  console.log(`Rendering ${mmdFiles.length} Mermaid diagrams from ${diagramsDir}...`);

  for (const file of mmdFiles) {
    const input = join(diagramsDir, file);
    const base = file.replace(".mmd", "");
    const pngOutput = join(pngDir, `${base}.png`);
    const svgOutput = join(svgDir, `${base}.svg`);

    console.log(`  ${file} -> svg, png`);
    try {
      execSync(
        `pnpm exec mmdc -i "${input}" -o "${svgOutput}" -c "${mmdConfig}" -b white`,
        { cwd: ROOT, stdio: "pipe", timeout: 60_000, env },
      );
      execSync(
        `pnpm exec mmdc -i "${input}" -o "${pngOutput}" -c "${mmdConfig}" -b white -s 3`,
        { cwd: ROOT, stdio: "pipe", timeout: 60_000, env },
      );
    } catch (err) {
      const message = err?.stderr?.toString?.().split("\n")[0] || err?.message || "Unknown render error";
      console.error(`  WARN: Failed to render ${file}: ${message}`);
    }
  }
}

function heading(level, text) {
  const map = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
    5: HeadingLevel.HEADING_4,
    6: HeadingLevel.HEADING_4,
  };
  return new Paragraph({
    heading: map[level] || HeadingLevel.HEADING_2,
    spacing: { before: level === 1 ? 400 : 240, after: 120 },
    children: [
      new TextRun({
        text,
        bold: true,
        font: "Segoe UI",
        size: level === 1 ? 36 : level === 2 ? 28 : level === 3 ? 24 : 22,
        color: NAVY,
      }),
    ],
  });
}

function para(children, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    alignment: opts.align || AlignmentType.LEFT,
    children,
  });
}

function plainTextRun(text, opts = {}) {
  return new TextRun({
    text,
    font: "Segoe UI",
    size: opts.size ?? 21,
    color: opts.color ?? DARK_GRAY,
    bold: opts.bold,
    italics: opts.italics,
    underline: opts.underline,
    break: opts.break,
  });
}

function codeParagraph(text) {
  return new Paragraph({
    shading: { type: ShadingType.SOLID, color: "f5f7fa" },
    spacing: { before: 120, after: 120 },
    children: [
      new TextRun({
        text,
        font: "Consolas",
        size: 18,
        color: DARK_GRAY,
      }),
    ],
  });
}

function bullet(children, level = 0) {
  return new Paragraph({
    spacing: { after: 60 },
    bullet: { level },
    children,
  });
}

function ordered(children) {
  return new Paragraph({
    spacing: { after: 60 },
    numbering: { reference: "markdown-numbering", level: 0 },
    children,
  });
}

function spacer() {
  return new Paragraph({ spacing: { after: 80 }, children: [] });
}

function resolveLocalPath(baseDir, href) {
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href;
  return resolve(baseDir, href);
}

function readPngDimensions(filePath) {
  const data = readFileSync(filePath);
  if (data.length < 24 || data.toString("ascii", 1, 4) !== "PNG") {
    return null;
  }
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  };
}

function fitWithin(dimensions, maxDimensions) {
  if (!dimensions?.width || !dimensions?.height) {
    return { width: maxDimensions.width, height: maxDimensions.height };
  }

  const scale = Math.min(
    maxDimensions.width / dimensions.width,
    maxDimensions.height / dimensions.height,
    1,
  );

  return {
    width: Math.max(1, Math.round(dimensions.width * scale)),
    height: Math.max(1, Math.round(dimensions.height * scale)),
  };
}

function resolveDiagramCompanions(localPath) {
  const extension = extname(localPath).toLowerCase();
  const parentDir = dirname(localPath);
  const baseDir = dirname(parentDir);
  const fileBase = basename(localPath, extension);
  const pngPath = join(baseDir, "png", `${fileBase}.png`);
  const svgPath = join(baseDir, "svg", `${fileBase}.svg`);

  if (extension === ".png" && existsSync(svgPath)) {
    return {
      primaryPath: svgPath,
      primaryType: "svg",
      fallbackPath: localPath,
      dimensionsPath: localPath,
    };
  }

  if (extension === ".svg" && existsSync(pngPath)) {
    return {
      primaryPath: localPath,
      primaryType: "svg",
      fallbackPath: pngPath,
      dimensionsPath: pngPath,
    };
  }

  return {
    primaryPath: localPath,
    primaryType: extension.slice(1) || "png",
    fallbackPath: null,
    dimensionsPath: localPath,
  };
}

function createImageRunFromLocalPath(localPath, maxDimensions) {
  const source = resolveDiagramCompanions(localPath);
  const dimensions = readPngDimensions(source.dimensionsPath);
  const transformation = fitWithin(dimensions, maxDimensions);

  if (source.primaryType === "svg" && source.fallbackPath && existsSync(source.fallbackPath)) {
    return new ImageRun({
      type: "svg",
      data: readFileSync(source.primaryPath),
      transformation,
      fallback: {
        type: extname(source.fallbackPath).slice(1) || "png",
        data: readFileSync(source.fallbackPath),
        transformation,
      },
    });
  }

  return new ImageRun({
    data: readFileSync(source.primaryPath),
    transformation,
    type: source.primaryType,
  });
}

function inlineRunsFromTokens(tokens = [], baseDir, style = {}) {
  const runs = [];
  for (const token of tokens) {
    if (token.type === "text") {
      if (token.tokens && token.tokens.length > 0) {
        runs.push(...inlineRunsFromTokens(token.tokens, baseDir, style));
      } else if (token.text) {
        runs.push(plainTextRun(token.text, style));
      }
      continue;
    }
    if (token.type === "strong") {
      runs.push(...inlineRunsFromTokens(token.tokens, baseDir, { ...style, bold: true }));
      continue;
    }
    if (token.type === "em") {
      runs.push(...inlineRunsFromTokens(token.tokens, baseDir, { ...style, italics: true }));
      continue;
    }
    if (token.type === "codespan") {
      runs.push(new TextRun({ text: token.text, font: "Consolas", size: 19, color: DARK_GRAY, bold: style.bold, italics: style.italics }));
      continue;
    }
    if (token.type === "br") {
      runs.push(new TextRun({ break: 1 }));
      continue;
    }
    if (token.type === "link") {
      const children = inlineRunsFromTokens(token.tokens, baseDir, { ...style, color: MID_BLUE, underline: {} });
      runs.push(new ExternalHyperlink({
        link: token.href,
        children: children.length > 0 ? children : [plainTextRun(token.href, { color: MID_BLUE, underline: {} })],
      }));
      continue;
    }
    if (token.type === "image") {
      const localPath = resolveLocalPath(baseDir, token.href);
      if (localPath && existsSync(localPath)) {
        runs.push(createImageRunFromLocalPath(localPath, INLINE_IMAGE_MAX));
      } else {
        runs.push(plainTextRun(`[Missing image: ${token.href}]`, { italics: true }));
      }
      continue;
    }
    if (token.raw) {
      runs.push(plainTextRun(token.raw, style));
    }
  }
  return runs;
}

function runsFromInlineText(text, baseDir) {
  const tokens = marked.Lexer.lexInline(text ?? "");
  return inlineRunsFromTokens(tokens, baseDir);
}

function tableCellFromInline(text, baseDir, widthPct, shading) {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    shading: shading ? { type: ShadingType.SOLID, color: shading } : undefined,
    borders: CELL_BORDER,
    children: [
      new Paragraph({
        spacing: { before: 40, after: 40 },
        children: runsFromInlineText(text, baseDir),
      }),
    ],
  });
}

function buildTable(token, baseDir) {
  const headerCount = token.header.length || 1;
  const colWidth = Math.floor(100 / headerCount);
  const headerRow = new TableRow({
    tableHeader: true,
    children: token.header.map((headerCell) =>
      new TableCell({
        width: { size: colWidth, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.SOLID, color: NAVY },
        borders: CELL_BORDER,
        children: [
          new Paragraph({
            spacing: { before: 60, after: 60 },
            children: inlineRunsFromTokens(
              headerCell.tokens ?? [{ type: "text", text: headerCell.text }],
              baseDir,
              { bold: true, color: WHITE },
            ),
          }),
        ],
      }),
    ),
  });

  const rows = token.rows.map((row, rowIndex) =>
    new TableRow({
      children: row.map((cell) =>
        tableCellFromInline(
          cell.text,
          baseDir,
          colWidth,
          rowIndex % 2 === 1 ? LIGHT_GRAY : undefined,
        ),
      ),
    }),
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...rows],
  });
}

function imageParagraph(token, baseDir) {
  const localPath = resolveLocalPath(baseDir, token.href);
  if (!localPath || !existsSync(localPath)) {
    return para([plainTextRun(`[Missing image: ${token.href}]`, { italics: true })], { align: AlignmentType.CENTER });
  }
  return new Paragraph({
    spacing: { before: 200, after: 200 },
    alignment: AlignmentType.CENTER,
    children: [createImageRunFromLocalPath(localPath, BLOCK_IMAGE_MAX)],
  });
}

function markdownToDocChildren(markdownPath) {
  const markdown = readFileSync(markdownPath, "utf8");
  const baseDir = dirname(markdownPath);
  const tokens = marked.lexer(markdown);
  const children = [];

  for (const token of tokens) {
    if (token.type === "heading") {
      children.push(heading(token.depth, token.text));
      continue;
    }
    if (token.type === "paragraph") {
      if (token.tokens?.length === 1 && token.tokens[0].type === "image") {
        children.push(imageParagraph(token.tokens[0], baseDir));
      } else {
        children.push(para(inlineRunsFromTokens(token.tokens, baseDir)));
      }
      continue;
    }
    if (token.type === "space") {
      children.push(spacer());
      continue;
    }
    if (token.type === "list") {
      for (const item of token.items) {
        const itemRuns = item.tokens && item.tokens.length > 0
          ? inlineRunsFromTokens(item.tokens[0].tokens ?? [{ type: "text", text: item.text }], baseDir)
          : runsFromInlineText(item.text, baseDir);
        children.push(token.ordered ? ordered(itemRuns) : bullet(itemRuns, token.depth ?? 0));
      }
      continue;
    }
    if (token.type === "code") {
      children.push(codeParagraph(token.text));
      continue;
    }
    if (token.type === "blockquote") {
      for (const inner of token.tokens) {
        if (inner.type === "paragraph") {
          children.push(
            new Paragraph({
              spacing: { before: 60, after: 120 },
              indent: { left: 420 },
              border: { left: { style: BorderStyle.SINGLE, size: 6, color: MID_BLUE } },
              children: inlineRunsFromTokens(inner.tokens, baseDir, { italics: true }),
            }),
          );
        }
      }
      continue;
    }
    if (token.type === "table") {
      children.push(buildTable(token, baseDir));
      children.push(spacer());
      continue;
    }
    if (token.type === "hr") {
      children.push(spacer());
      continue;
    }
  }

  return children;
}

export async function generateDocxFromMarkdown({
  markdownPath,
  outputPath,
  title,
  subtitle,
  headerTitle,
  diagramsDir,
}) {
  renderMermaidDiagrams(diagramsDir);
  const bodyChildren = markdownToDocChildren(markdownPath);

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Segoe UI", size: 21, color: DARK_GRAY },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: "markdown-numbering",
          levels: [
            {
              level: 0,
              format: NumberFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.START,
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1.1),
              right: convertInchesToTwip(1.1),
            },
          },
        },
        children: [
          spacer(), spacer(), spacer(), spacer(), spacer(), spacer(),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [new TextRun({ text: title, font: "Segoe UI", size: 44, bold: true, color: NAVY })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 300 },
            children: [new TextRun({ text: subtitle, font: "Segoe UI", size: 24, color: DARK_GRAY })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: `Generated ${new Date().toISOString().slice(0, 10)}`, font: "Segoe UI", size: 18, color: "666666" })],
          }),
          new Paragraph({ children: [new PageBreak()] }),
        ],
      },
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1.1),
              right: convertInchesToTwip(1.1),
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: headerTitle, font: "Segoe UI", size: 16, color: "999999", italics: true })],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: "Page ", font: "Segoe UI", size: 16, color: "999999" }),
                  new TextRun({ children: [PageNumber.CURRENT], font: "Segoe UI", size: 16, color: "999999" }),
                ],
              }),
            ],
          }),
        },
        children: [
          heading(1, "Table of Contents"),
          new TableOfContents("Table of Contents", {
            hyperlink: true,
            headingStyleRange: "1-3",
            stylesWithLevels: [
              new StyleLevel("Heading1", 1),
              new StyleLevel("Heading2", 2),
              new StyleLevel("Heading3", 3),
            ],
          }),
          para([plainTextRun("Note: Update the Table of Contents in Word by right-clicking it and selecting 'Update Field'.")]),
          new Paragraph({ children: [new PageBreak()] }),
          ...bodyChildren,
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  let finalOutputPath = outputPath;
  try {
    writeFileSync(outputPath, buffer);
  } catch (error) {
    if (error?.code !== "EBUSY") {
      throw error;
    }

    const extension = extname(outputPath);
    const fallbackPath = outputPath.replace(
      new RegExp(`${extension.replace(".", "\\.")}$`),
      `.updated${extension}`,
    );
    writeFileSync(fallbackPath, buffer);
    finalOutputPath = fallbackPath;
    console.warn(`WARN: ${outputPath} is locked. Wrote updated output to ${fallbackPath} instead.`);
  }

  console.log(`Done! Output: ${finalOutputPath}`);
  console.log(`File size: ${(buffer.length / 1024).toFixed(0)} KB`);
}
