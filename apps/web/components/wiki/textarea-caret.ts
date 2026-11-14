// BI-2F7BE778: where the caret sits inside a textarea, so the link suggestions
// open at the caret (spec 2026-10-14 knowledge-linking §7).
//
// A textarea does not expose caret coordinates. The standard technique copies
// the textarea's text metrics onto an off-screen mirror element, fills it with
// the text before the caret, and measures a marker span placed there.

const COPIED_STYLES = [
  "boxSizing",
  "width",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "lineHeight",
  "tabSize",
  "textTransform",
  "wordSpacing",
  "direction",
] as const;

export type CaretPoint = { top: number; left: number; lineHeight: number };

/** Caret position relative to the textarea's padding box, scroll applied. */
export function textareaCaretPoint(textarea: HTMLTextAreaElement, position: number): CaretPoint {
  const doc = textarea.ownerDocument;
  const style = doc.defaultView?.getComputedStyle(textarea);
  const mirror = doc.createElement("div");
  if (style) {
    for (const key of COPIED_STYLES) mirror.style[key] = style[key];
  }
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.top = "0";
  mirror.style.insetInlineStart = "-9999px";
  mirror.textContent = textarea.value.slice(0, position);
  const marker = doc.createElement("span");
  marker.textContent = textarea.value.slice(position) || ".";
  mirror.appendChild(marker);
  doc.body.appendChild(mirror);
  const lineHeight = Number.parseFloat(style?.lineHeight ?? "") || Number.parseFloat(style?.fontSize ?? "") * 1.4 || 20;
  const point = {
    top: marker.offsetTop - textarea.scrollTop,
    left: marker.offsetLeft - textarea.scrollLeft,
    lineHeight,
  };
  doc.body.removeChild(mirror);
  return point;
}
