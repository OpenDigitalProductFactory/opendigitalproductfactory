// apps/web/app/api/docs/route.ts
// Serves project documentation files as HTML-rendered markdown.
// Only serves files under docs/ with allowed extensions.

import { NextRequest } from "next/server";
import { readProjectFile, isPathAllowed } from "@/lib/codebase-tools";

const ALLOWED_PREFIXES = ["docs/"];
const ALLOWED_EXTENSIONS = [".md", ".txt"];

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("path");
  if (!path) {
    return new Response("Missing ?path= parameter", { status: 400 });
  }

  // Security: only docs/ directory, only safe extensions
  if (!ALLOWED_PREFIXES.some((p) => path.startsWith(p))) {
    return new Response("Access denied: only docs/ files are served", { status: 403 });
  }
  if (!ALLOWED_EXTENSIONS.some((ext) => path.endsWith(ext))) {
    return new Response("Access denied: unsupported file type", { status: 403 });
  }
  if (!isPathAllowed(path)) {
    return new Response("Access denied", { status: 403 });
  }

  const result = readProjectFile(path);
  if ("error" in result) {
    return new Response(result.error, { status: 404 });
  }

  // Simple markdown → HTML rendering (no heavy library needed)
  const html = renderMarkdownPage(path, result.content);
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function renderMarkdownPage(filePath: string, markdown: string): string {
  // Lightweight markdown → HTML (headings, lists, code blocks, bold, links)
  let html = escapeHtml(markdown);

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) =>
    `<pre style="background:#0d0d18;border:1px solid #2a2a40;border-radius:6px;padding:12px;overflow-x:auto;font-size:12px;line-height:1.5"><code class="language-${lang}">${code}</code></pre>`
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code style="background:#1a1a2e;padding:1px 4px;border-radius:3px;font-size:12px">$1</code>');

  // Headers
  html = html.replace(/^#### (.+)$/gm, '<h4 style="color:#e0e0ff;font-size:14px;margin:16px 0 8px;font-weight:600">$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3 style="color:#e0e0ff;font-size:15px;margin:20px 0 8px;font-weight:600">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 style="color:#e0e0ff;font-size:17px;margin:24px 0 10px;font-weight:700;border-bottom:1px solid #2a2a40;padding-bottom:6px">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 style="color:#fff;font-size:22px;margin:0 0 16px;font-weight:700">$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong style="color:#e0e0ff">$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Tables
  html = html.replace(/^\|(.+)\|$/gm, (line) => {
    const cells = line.split("|").filter(Boolean).map((c) => c.trim());
    const isHeader = cells.every((c) => /^[-:]+$/.test(c));
    if (isHeader) return ""; // separator row
    const tag = "td";
    return `<tr>${cells.map((c) => `<${tag} style="padding:4px 8px;border:1px solid #2a2a40;font-size:12px">${c}</${tag}>`).join("")}</tr>`;
  });
  html = html.replace(/(<tr>[\s\S]*?<\/tr>)/g, (match) => {
    if (!match.includes("<table")) {
      return `<table style="border-collapse:collapse;margin:8px 0;width:100%">${match}</table>`;
    }
    return match;
  });
  // Merge adjacent tables
  html = html.replace(/<\/table>\s*<table[^>]*>/g, "");

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li style="margin:2px 0;font-size:13px">$1</li>');
  html = html.replace(/(<li[^>]*>[\s\S]*?<\/li>)/g, (match) => {
    return `<ul style="margin:4px 0;padding-left:20px">${match}</ul>`;
  });
  html = html.replace(/<\/ul>\s*<ul[^>]*>/g, "");

  // Ordered lists
  html = html.replace(/^\d+\.\s(.+)$/gm, '<li style="margin:2px 0;font-size:13px">$1</li>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #2a2a40;margin:20px 0">');

  // Paragraphs (lines not already wrapped)
  html = html.replace(/^(?!<[hupoltd]|<\/|<hr|<pre|<code|<table|<tr|$)(.+)$/gm, '<p style="margin:6px 0;font-size:13px;line-height:1.6">$1</p>');

  const title = filePath.split("/").pop() ?? "Document";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:32px;background:#0d0d18;color:#b0b0c8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:900px;margin:0 auto">
  <div style="padding:0 16px">
    <div style="margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #2a2a40">
      <a href="/ops" style="color:#7c8cf8;font-size:12px;text-decoration:none">&larr; Back to Operations</a>
      <span style="color:#555;font-size:11px;margin-left:12px">${escapeHtml(filePath)}</span>
    </div>
    ${html}
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
