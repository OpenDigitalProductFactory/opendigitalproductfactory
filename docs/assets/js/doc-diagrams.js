(function (global) {
  "use strict";

  var MERMAID_BLOCK_SELECTOR =
    "div.language-mermaid, pre > code.language-mermaid";

  function diagramSlugFromSourcePath(sourcePath) {
    var normalized = String(sourcePath || "").replace(/\\/g, "/");
    normalized = normalized.replace(/^docs\//, "");
    if (
      !/^user-guide\/[A-Za-z0-9][A-Za-z0-9_/-]*\.md$/.test(normalized) ||
      normalized.indexOf("//") !== -1
    ) {
      return null;
    }
    return normalized
      .replace(/^user-guide\//, "")
      .replace(/\.md$/, "");
  }

  function diagramPublicHref(slug, index) {
    var encodedSlug = String(slug)
      .split("/")
      .map(function (segment) {
        return encodeURIComponent(segment);
      })
      .join("/");
    return "/user-guide/assets/diagrams/" + encodedSlug + "/" + index + ".svg";
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
})(typeof globalThis !== "undefined" ? globalThis : this);
