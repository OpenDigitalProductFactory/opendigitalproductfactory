// Brand masters as flat ODF (BI-3A0E5413, slice S6 of BI-815D40C6).
//
// One template per document family, generated from the organization's brand:
//   deck    .fodp  masters dpf-title / dpf-section / dpf-content (the names
//                  dpf-render looks for), brand colours, fonts, logo, accent bar
//   report  .fodt  Title / Subtitle / Heading 1-3 in the brand, logo + title header
//   letter  .fodt  letterhead: logo, organization name and address
//   sheet   .fods  brand body font, title in the page header
//   drawing .fodg  brand page and logo; shape colours come from the render theme
//
// Flat ODF is plain XML: it is generated here without a zip dependency,
// screened by dpf-render (no scripts, objects or external links) and opened by
// the engine as a template. Pure functions only: the same brand always yields
// the same bytes, which is what makes a master content-addressable.

import type { DocumentFamily } from "./spec";

export type BrandLogo = { mimeType: "image/png" | "image/jpeg" | "image/gif"; data: Buffer; widthPx: number; heightPx: number };

export type BrandMasterInput = {
  organizationName: string;
  /** #rrggbb */
  primary: string;
  secondary: string;
  background: string;
  foreground: string;
  headingFont: string;
  bodyFont: string;
  paper: "a4" | "letter";
  addressLines: string[];
  logo: BrandLogo | null;
};

export const BRAND_MASTER_EXTENSION: Record<DocumentFamily, "fodp" | "fodt" | "fods" | "fodg"> = {
  deck: "fodp",
  report: "fodt",
  letter: "fodt",
  sheet: "fods",
  drawing: "fodg",
};

export const BRAND_MASTER_MIME: Record<"fodp" | "fodt" | "fods" | "fodg", string> = {
  fodp: "application/vnd.oasis.opendocument.presentation-flat-xml",
  fodt: "application/vnd.oasis.opendocument.text-flat-xml",
  fods: "application/vnd.oasis.opendocument.spreadsheet-flat-xml",
  fodg: "application/vnd.oasis.opendocument.graphics-flat-xml",
};

const NAMESPACES = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:xlink="http://www.w3.org/1999/xlink"',
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
  'xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"',
  'xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0"',
].join(" ");

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Characters XML 1.0 cannot carry at all.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

/** A font family name as ODF quotes it: 'Name With Spaces'. */
function fontFamily(name: string): string {
  return escapeXml(`'${name.replace(/'/g, "")}'`);
}

function fontFaces(input: BrandMasterInput): string {
  const faces = [...new Set([input.headingFont, input.bodyFont])];
  return `<office:font-face-decls>${faces
    .map((name) => `<style:font-face style:name="${escapeXml(name)}" svg:font-family="${fontFamily(name)}"/>`)
    .join("")}</office:font-face-decls>`;
}

/** Relative luminance test: white text on dark fills, near-black on light ones. */
export function contrastText(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  // Document ink for a generated office file, not portal UI.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#1a1a1a" : "#ffffff"; // style-drift-allow
}

/** Logo box of at most maxW x maxH centimetres, keeping the image's aspect ratio. */
function logoBox(logo: BrandLogo, maxW: number, maxH: number): { w: string; h: string } {
  const ratio = logo.widthPx > 0 && logo.heightPx > 0 ? logo.widthPx / logo.heightPx : 1;
  const w = Math.min(maxW, maxH * ratio);
  const h = w / ratio;
  return { w: `${w.toFixed(3)}cm`, h: `${h.toFixed(3)}cm` };
}

function logoImage(logo: BrandLogo): string {
  return `<draw:image loext:mime-type="${logo.mimeType}"><office:binary-data>${logo.data.toString("base64")}</office:binary-data></draw:image>`;
}

function documentOpen(mimetype: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<office:document ${NAMESPACES} office:version="1.3" office:mimetype="${mimetype}">`;
}

function meta(input: BrandMasterInput, family: DocumentFamily): string {
  return `<office:meta><meta:generator>dpf brand-master</meta:generator><dc:title>${escapeXml(
    `${input.organizationName} ${family} master`,
  )}</dc:title></office:meta>`;
}

// ---------------------------------------------------------------- deck (.fodp)

function deckMaster(name: string, input: BrandMasterInput, kind: "title" | "section" | "content"): string {
  const onBrand = kind !== "content";
  const logo = input.logo
    ? (() => {
        const box = logoBox(input.logo, onBrand ? 5 : 3.2, onBrand ? 2.2 : 1.2);
        const x = onBrand ? "1.4cm" : `${(26.6 - parseFloat(box.w)).toFixed(3)}cm`;
        const y = onBrand ? "1.2cm" : "0.5cm";
        return `<draw:frame draw:name="brand-logo" draw:layer="backgroundobjects" svg:x="${x}" svg:y="${y}" svg:width="${box.w}" svg:height="${box.h}">${logoImage(input.logo)}</draw:frame>`;
      })()
    : "";
  const footer = `<draw:frame draw:name="brand-footer" draw:layer="backgroundobjects" draw:style-name="gr-footer-${kind}" svg:x="1.4cm" svg:y="14.4cm" svg:width="20cm" svg:height="0.8cm"><draw:text-box><text:p text:style-name="p-footer-${kind}">${escapeXml(input.organizationName)}</text:p></draw:text-box></draw:frame>`;
  const accent = onBrand
    ? ""
    : `<draw:rect draw:name="brand-accent" draw:layer="backgroundobjects" draw:style-name="gr-accent" svg:x="0cm" svg:y="15.35cm" svg:width="28cm" svg:height="0.4cm"/>`;
  const titleFrame =
    kind === "content"
      ? `<draw:frame presentation:style-name="${name}-title" draw:layer="backgroundobjects" svg:x="1.4cm" svg:y="0.6cm" svg:width="22cm" svg:height="2.4cm" presentation:class="title" presentation:placeholder="true"><draw:text-box/></draw:frame>`
      : `<draw:frame presentation:style-name="${name}-title" draw:layer="backgroundobjects" svg:x="1.4cm" svg:y="5cm" svg:width="25.2cm" svg:height="3.6cm" presentation:class="title" presentation:placeholder="true"><draw:text-box/></draw:frame>`;
  // Title and section slides place a subtitle under the title; content slides an outline.
  const body =
    kind === "content"
      ? `<draw:frame presentation:style-name="${name}-outline1" draw:layer="backgroundobjects" svg:x="1.4cm" svg:y="3.6cm" svg:width="25.2cm" svg:height="10.2cm" presentation:class="outline" presentation:placeholder="true"><draw:text-box/></draw:frame>`
      : `<draw:frame presentation:style-name="${name}-subtitle" draw:layer="backgroundobjects" svg:x="1.4cm" svg:y="8.8cm" svg:width="25.2cm" svg:height="2.6cm" presentation:class="subtitle" presentation:placeholder="true"><draw:text-box/></draw:frame>`;
  return `<style:master-page style:name="${name}" style:page-layout-name="pm-deck" draw:style-name="dp-${kind}">${logo}${accent}${titleFrame}${body}${footer}</style:master-page>`;
}

function deckPresentationStyles(name: string, input: BrandMasterInput, kind: "title" | "section" | "content"): string {
  const onBrand = kind !== "content";
  const titleColour = onBrand ? contrastText(input.primary) : input.primary;
  const bodyColour = onBrand ? contrastText(input.primary) : input.foreground;
  const titleSize = kind === "title" ? "40pt" : kind === "section" ? "36pt" : "32pt";
  const pageFill = kind === "title" ? input.primary : kind === "section" ? input.secondary : input.background;
  return [
    `<style:style style:name="${name}-title" style:family="presentation"><style:graphic-properties draw:stroke="none" draw:fill="none" draw:textarea-vertical-align="middle"/><style:paragraph-properties fo:text-align="${onBrand ? "start" : "start"}"/><style:text-properties fo:color="${titleColour}" style:font-name="${escapeXml(input.headingFont)}" fo:font-size="${titleSize}" fo:font-weight="bold"/></style:style>`,
    `<style:style style:name="${name}-subtitle" style:family="presentation"><style:graphic-properties draw:stroke="none" draw:fill="none"/><style:text-properties fo:color="${bodyColour}" style:font-name="${escapeXml(input.bodyFont)}" fo:font-size="24pt"/></style:style>`,
    `<style:style style:name="${name}-outline1" style:family="presentation"><style:graphic-properties draw:stroke="none" draw:fill="none"><text:list-style style:name="${name}-outline1"><text:list-level-style-bullet text:level="1" text:bullet-char="&#x2022;"><style:list-level-properties text:space-before="0.3cm" text:min-label-width="0.9cm"/><style:text-properties fo:font-family="${fontFamily(input.bodyFont)}" fo:font-size="100%" fo:color="${onBrand ? bodyColour : input.primary}"/></text:list-level-style-bullet></text:list-style></style:graphic-properties><style:paragraph-properties fo:margin-top="0.3cm"/><style:text-properties fo:color="${bodyColour}" style:font-name="${escapeXml(input.bodyFont)}" fo:font-size="24pt"/></style:style>`,
    // The importer reads a master's background from its "-background" style, so the fill lives here too.
    `<style:style style:name="${name}-background" style:family="presentation"><style:graphic-properties draw:stroke="none" draw:fill="solid" draw:fill-color="${pageFill}"/></style:style>`,
    `<style:style style:name="${name}-backgroundobjects" style:family="presentation"><style:graphic-properties draw:shadow="hidden"/></style:style>`,
    `<style:style style:name="${name}-notes" style:family="presentation"><style:text-properties style:font-name="${escapeXml(input.bodyFont)}" fo:font-size="12pt"/></style:style>`,
  ].join("");
}

export function buildDeckMaster(input: BrandMasterInput): string {
  const kinds = [
    ["dpf-title", "title"],
    ["dpf-section", "section"],
    ["dpf-content", "content"],
  ] as const;
  const drawingPage = (kind: string, fill: string) =>
    `<style:style style:name="dp-${kind}" style:family="drawing-page"><style:drawing-page-properties draw:background-size="border" draw:fill="solid" draw:fill-color="${fill}"/></style:style>`;
  const footerStyles = (["title", "section", "content"] as const)
    .map((kind) => {
      const colour = kind === "content" ? input.secondary : contrastText(input.primary);
      return `<style:style style:name="gr-footer-${kind}" style:family="graphic"><style:graphic-properties draw:stroke="none" draw:fill="none"/></style:style><style:style style:name="p-footer-${kind}" style:family="paragraph"><style:text-properties fo:color="${colour}" style:font-name="${escapeXml(input.bodyFont)}" fo:font-size="11pt"/></style:style>`;
    })
    .join("");
  return [
    documentOpen("application/vnd.oasis.opendocument.presentation"),
    meta(input, "deck"),
    fontFaces(input),
    `<office:styles>${kinds.map(([name, kind]) => deckPresentationStyles(name, input, kind)).join("")}</office:styles>`,
    `<office:automatic-styles><style:page-layout style:name="pm-deck"><style:page-layout-properties fo:margin-top="0cm" fo:margin-bottom="0cm" fo:margin-left="0cm" fo:margin-right="0cm" fo:page-width="28cm" fo:page-height="15.75cm" style:print-orientation="landscape"/></style:page-layout>`,
    drawingPage("title", input.primary),
    drawingPage("section", input.secondary),
    drawingPage("content", input.background),
    `<style:style style:name="gr-accent" style:family="graphic"><style:graphic-properties draw:stroke="none" draw:fill="solid" draw:fill-color="${input.primary}"/></style:style>`,
    footerStyles,
    `</office:automatic-styles>`,
    `<office:master-styles>${kinds.map(([name, kind]) => deckMaster(name, input, kind)).join("")}</office:master-styles>`,
    `<office:body><office:presentation><draw:page draw:name="page1" draw:master-page-name="dpf-content" presentation:presentation-page-layout-name="AL1T0"/></office:presentation></office:body>`,
    `</office:document>\n`,
  ].join("\n");
}

// ---------------------------------------------------------------- report and letter (.fodt)

function paperSize(paper: BrandMasterInput["paper"]): { w: string; h: string } {
  return paper === "letter" ? { w: "21.59cm", h: "27.94cm" } : { w: "21cm", h: "29.7cm" };
}

function writerStyles(input: BrandMasterInput): string {
  const heading = (level: number, size: string) =>
    `<style:style style:name="Heading ${level}" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Text body" style:default-outline-level="${level}" style:class="text"><style:paragraph-properties fo:margin-top="0.42cm" fo:margin-bottom="0.21cm"/><style:text-properties fo:color="${level === 1 ? input.primary : input.foreground}" fo:font-size="${size}" fo:font-weight="bold" style:font-name="${escapeXml(input.headingFont)}"/></style:style>`;
  return [
    `<office:styles>`,
    `<style:default-style style:family="paragraph"><style:text-properties style:font-name="${escapeXml(input.bodyFont)}" fo:font-size="11pt" fo:color="${input.foreground}"/></style:default-style>`,
    `<style:style style:name="Standard" style:family="paragraph" style:class="text"/>`,
    `<style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Text body" style:class="text"><style:paragraph-properties fo:keep-with-next="always"/><style:text-properties style:font-name="${escapeXml(input.headingFont)}"/></style:style>`,
    `<style:style style:name="Text body" style:family="paragraph" style:parent-style-name="Standard" style:class="text"><style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.25cm" fo:line-height="115%"/></style:style>`,
    `<style:style style:name="Title" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Subtitle" style:class="chapter"><style:text-properties fo:color="${input.primary}" fo:font-size="26pt" fo:font-weight="bold"/></style:style>`,
    `<style:style style:name="Subtitle" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Text body" style:class="chapter"><style:paragraph-properties fo:margin-bottom="0.5cm"/><style:text-properties fo:color="${input.secondary}" fo:font-size="16pt"/></style:style>`,
    heading(1, "18pt"),
    heading(2, "14pt"),
    heading(3, "12pt"),
    `<style:style style:name="Header" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"><style:paragraph-properties><style:tab-stops><style:tab-stop style:position="17cm" style:type="right"/></style:tab-stops></style:paragraph-properties><style:text-properties fo:color="${input.secondary}" fo:font-size="9pt"/></style:style>`,
    `<style:style style:name="Footer" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"><style:text-properties fo:color="${input.secondary}" fo:font-size="8pt"/></style:style>`,
    `</office:styles>`,
  ].join("");
}

function writerDocument(input: BrandMasterInput, family: "report" | "letter"): string {
  const size = paperSize(input.paper);
  const logo = input.logo
    ? (() => {
        const box = logoBox(input.logo, family === "letter" ? 4.5 : 3, family === "letter" ? 2 : 1.1);
        return `<draw:frame draw:name="brand-logo" text:anchor-type="as-char" svg:width="${box.w}" svg:height="${box.h}">${logoImage(input.logo)}</draw:frame>`;
      })()
    : "";
  const headerText =
    family === "report"
      ? `${logo}<text:tab/>{{title}}`
      : `${logo}<text:tab/>${escapeXml(input.organizationName)}`;
  const footer =
    family === "letter" && input.addressLines.length > 0
      ? `<style:footer><text:p text:style-name="Footer">${escapeXml([input.organizationName, ...input.addressLines].join(" · "))}</text:p></style:footer>`
      : family === "report"
        ? `<style:footer><text:p text:style-name="Footer">${escapeXml(input.organizationName)}</text:p></style:footer>`
        : "";
  return [
    documentOpen("application/vnd.oasis.opendocument.text"),
    meta(input, family),
    fontFaces(input),
    writerStyles(input),
    `<office:automatic-styles><style:page-layout style:name="pm-page"><style:page-layout-properties fo:page-width="${size.w}" fo:page-height="${size.h}" style:print-orientation="portrait" fo:margin-top="1.2cm" fo:margin-bottom="1.2cm" fo:margin-left="2cm" fo:margin-right="2cm"/><style:header-style><style:header-footer-properties fo:min-height="1cm" fo:margin-bottom="0.6cm"/></style:header-style><style:footer-style><style:header-footer-properties fo:min-height="0.6cm" fo:margin-top="0.4cm"/></style:footer-style></style:page-layout></office:automatic-styles>`,
    `<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm-page"><style:header><text:p text:style-name="Header">${headerText}</text:p></style:header>${footer}</style:master-page></office:master-styles>`,
    `<office:body><office:text><text:p text:style-name="Text body">{{body}}</text:p></office:text></office:body>`,
    `</office:document>\n`,
  ].join("\n");
}

export const buildReportMaster = (input: BrandMasterInput): string => writerDocument(input, "report");
export const buildLetterMaster = (input: BrandMasterInput): string => writerDocument(input, "letter");

// ---------------------------------------------------------------- sheet (.fods)

export function buildSheetMaster(input: BrandMasterInput): string {
  const size = paperSize(input.paper);
  return [
    documentOpen("application/vnd.oasis.opendocument.spreadsheet"),
    meta(input, "sheet"),
    fontFaces(input),
    `<office:styles><style:default-style style:family="table-cell"><style:text-properties style:font-name="${escapeXml(input.bodyFont)}" fo:font-size="10pt"/></style:default-style><style:style style:name="Default" style:family="table-cell"/></office:styles>`,
    `<office:automatic-styles><style:page-layout style:name="pm-sheet"><style:page-layout-properties fo:page-width="${size.w}" fo:page-height="${size.h}" style:print-orientation="portrait" fo:margin-top="1.5cm" fo:margin-bottom="1.5cm" fo:margin-left="1.5cm" fo:margin-right="1.5cm"/><style:header-style><style:header-footer-properties fo:min-height="0.75cm"/></style:header-style></style:page-layout></office:automatic-styles>`,
    `<office:master-styles><style:master-page style:name="Default" style:page-layout-name="pm-sheet"><style:header><style:region-left><text:p>${escapeXml(input.organizationName)}</text:p></style:region-left><style:region-right><text:p>{{title}}</text:p></style:region-right></style:header></style:master-page></office:master-styles>`,
    `<office:body><office:spreadsheet><table:table table:name="Sheet1"><table:table-column/><table:table-row><table:table-cell/></table:table-row></table:table></office:spreadsheet></office:body>`,
    `</office:document>\n`,
  ].join("\n");
}

// ---------------------------------------------------------------- drawing (.fodg)

export function buildDrawingMaster(input: BrandMasterInput): string {
  const logo = input.logo
    ? (() => {
        const box = logoBox(input.logo, 3, 1.2);
        return `<draw:frame draw:name="brand-logo" draw:layer="backgroundobjects" svg:x="${(28.2 - parseFloat(box.w)).toFixed(3)}cm" svg:y="1.2cm" svg:width="${box.w}" svg:height="${box.h}">${logoImage(input.logo)}</draw:frame>`;
      })()
    : "";
  return [
    documentOpen("application/vnd.oasis.opendocument.graphics"),
    meta(input, "drawing"),
    fontFaces(input),
    // Shape colours travel as the render theme (shapeFill/shapeStroke/shapeText), not
    // as graphic styles: replacing Draw's "standard" style also resets text autogrow.
    `<office:styles/>`,
    `<office:automatic-styles><style:page-layout style:name="pm-draw"><style:page-layout-properties fo:margin-top="1cm" fo:margin-bottom="1cm" fo:margin-left="1cm" fo:margin-right="1cm" fo:page-width="29.7cm" fo:page-height="21cm" style:print-orientation="landscape"/></style:page-layout><style:style style:name="dp-draw" style:family="drawing-page"><style:drawing-page-properties draw:fill="solid" draw:fill-color="${input.background}"/></style:style></office:automatic-styles>`,
    `<office:master-styles><style:master-page style:name="dpf-drawing" style:page-layout-name="pm-draw" draw:style-name="dp-draw">${logo}</style:master-page></office:master-styles>`,
    `<office:body><office:drawing><draw:page draw:name="page1" draw:master-page-name="dpf-drawing"/></office:drawing></office:body>`,
    `</office:document>\n`,
  ].join("\n");
}

export const BRAND_MASTER_BUILDERS: Record<DocumentFamily, (input: BrandMasterInput) => string> = {
  deck: buildDeckMaster,
  report: buildReportMaster,
  letter: buildLetterMaster,
  sheet: buildSheetMaster,
  drawing: buildDrawingMaster,
};
