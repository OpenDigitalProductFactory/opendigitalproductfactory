(function (global) {
  "use strict";

  var MERMAID_BLOCK_SELECTOR =
    "div.language-mermaid, pre > code.language-mermaid";

  function diagramSlugFromSourcePath(sourcePath) {
    var normalized = String(sourcePath || "").replace(/\\/g, "/");
    normalized = normalized.replace(/^docs\//, "");
    if (normalized.indexOf("user-guide/") !== 0) return null;
    return normalized
      .replace(/^user-guide\//, "")
      .replace(/\.md$/, "");
  }

  function diagramPublicHref(slug, index) {
    return "/user-guide/assets/diagrams/" + slug + "/" + index + ".svg";
  }

  function replacementTarget(block) {
    if (
      block.tagName === "CODE" &&
      block.parentElement &&
      block.parentElement.tagName === "PRE"
    ) {
      return block.parentElement;
    }
    return block;
  }

  function renderDocDiagrams(root, sourcePath) {
    var slug = diagramSlugFromSourcePath(sourcePath);
    if (!slug) return 0;

    var blocks = root.querySelectorAll(MERMAID_BLOCK_SELECTOR);
    for (var i = 0; i < blocks.length; i++) {
      var img = root.createElement("img");
      img.src = diagramPublicHref(slug, i);
      img.alt = "Diagram";
      img.className = "doc-diagram";
      img.loading = "lazy";
      replacementTarget(blocks[i]).replaceWith(img);
    }
    return blocks.length;
  }

  global.DPFDocDiagrams = Object.freeze({
    MERMAID_BLOCK_SELECTOR: MERMAID_BLOCK_SELECTOR,
    diagramSlugFromSourcePath: diagramSlugFromSourcePath,
    diagramPublicHref: diagramPublicHref,
    replacementTarget: replacementTarget,
    renderDocDiagrams: renderDocDiagrams,
  });

  if (typeof document !== "undefined") {
    var script = document.currentScript;
    var sourcePath = script && script.getAttribute("data-source-path");
    renderDocDiagrams(document, sourcePath);
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
