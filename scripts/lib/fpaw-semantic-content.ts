type SemanticScanRange = {
  start: number;
  end: number;
};

type InlineMarkdownLink = {
  label: SemanticScanRange;
  nextIndex: number;
};

type InlineMarkdownCode = {
  content: SemanticScanRange;
  nextIndex: number;
};

const NON_SEMANTIC_NAMED_ENTITIES = [
  "&nbsp;",
  "&zerowidthspace;",
  "&zwnj;",
  "&zwj;",
  "&lrm;",
  "&rlm;",
  "&shy;",
] as const;
const MAX_MARKDOWN_LABEL_LENGTH = 999;
const SEMANTIC_CHARACTER = /[\p{L}\p{N}]/u;
const HTTP_AUTOLINK = /^https?:\/\/.+$/i;

function closingParenthesisAt(value: string, start: number, rangeEnd: number): number {
  let depth = 1;
  for (let index = start; index < rangeEnd; index += 1) {
    if (value[index] === "\\" && index + 1 < rangeEnd) {
      index += 1;
      continue;
    }
    if (value[index] === "(") depth += 1;
    if (value[index] !== ")") continue;
    depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function inlineMarkdownCodeAt(
  value: string,
  index: number,
  rangeEnd: number,
): InlineMarkdownCode | null {
  if (value[index] !== "`") return null;
  let openingEnd = index + 1;
  while (openingEnd < rangeEnd && value[openingEnd] === "`") openingEnd += 1;
  const delimiter = value.slice(index, openingEnd);
  let closingStart = value.indexOf(delimiter, openingEnd);
  while (closingStart >= 0 && closingStart + delimiter.length <= rangeEnd) {
    const exactRun = value[closingStart - 1] !== "`"
      && value[closingStart + delimiter.length] !== "`";
    if (exactRun) {
      return {
        content: { start: openingEnd, end: closingStart },
        nextIndex: closingStart + delimiter.length,
      };
    }
    closingStart = value.indexOf(delimiter, closingStart + delimiter.length);
  }
  return null;
}

function closingMarkdownLabelAt(value: string, index: number, rangeEnd: number): number {
  let depth = 1;
  for (let cursor = index + 1; cursor < rangeEnd;) {
    if (value[cursor] === "\\" && cursor + 1 < rangeEnd) {
      cursor += 2;
      continue;
    }
    if (value.startsWith("<!--", cursor)) {
      const commentEnd = value.indexOf("-->", cursor + 4);
      if (commentEnd < 0 || commentEnd + 3 > rangeEnd) return -1;
      cursor = commentEnd + 3;
      continue;
    }
    const code = inlineMarkdownCodeAt(value, cursor, rangeEnd);
    if (code) {
      cursor = code.nextIndex;
      continue;
    }
    if (value[cursor] === "[") depth += 1;
    if (value[cursor] === "]") {
      depth -= 1;
      if (depth === 0) return cursor;
    }
    cursor += 1;
  }
  return -1;
}

function inlineMarkdownLinkAt(
  value: string,
  index: number,
  rangeEnd: number,
): InlineMarkdownLink | null {
  if (value[index] !== "[") return null;
  const labelEnd = closingMarkdownLabelAt(
    value,
    index,
    Math.min(rangeEnd, index + MAX_MARKDOWN_LABEL_LENGTH + 2),
  );
  if (labelEnd < 0 || labelEnd + 1 >= rangeEnd) return null;
  let destinationEnd = -1;
  if (value[labelEnd + 1] === "(") {
    destinationEnd = closingParenthesisAt(value, labelEnd + 2, rangeEnd);
  } else if (value[labelEnd + 1] === "[") {
    for (let cursor = labelEnd + 2; cursor < rangeEnd; cursor += 1) {
      if (value[cursor] === "\\" && cursor + 1 < rangeEnd) {
        cursor += 1;
        continue;
      }
      if (value[cursor] === "]") {
        destinationEnd = cursor;
        break;
      }
    }
  }
  if (destinationEnd < 0) return null;
  return {
    label: { start: index + 1, end: labelEnd },
    nextIndex: destinationEnd + 1,
  };
}

function rangeHasSemanticCharacter(value: string, range: SemanticScanRange): boolean {
  for (let index = range.start; index < range.end;) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) break;
    const character = String.fromCodePoint(codePoint);
    if (SEMANTIC_CHARACTER.test(character)) return true;
    index += character.length;
  }
  return false;
}

function entityAt(
  value: string,
  index: number,
): { length: number; semantic: boolean } | null {
  const numeric = value.slice(index).match(/^&#(?:x([0-9a-f]+)|(\d+));/i);
  if (numeric) {
    const codePoint = Number.parseInt(numeric[1] ?? numeric[2], numeric[1] ? 16 : 10);
    if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
      return { length: numeric[0].length, semantic: false };
    }
    return {
      length: numeric[0].length,
      semantic: SEMANTIC_CHARACTER.test(String.fromCodePoint(codePoint)),
    };
  }
  for (const entity of NON_SEMANTIC_NAMED_ENTITIES) {
    if (value.slice(index, index + entity.length).toLowerCase() === entity) {
      return { length: entity.length, semantic: false };
    }
  }
  return null;
}

export function hasSemanticContent(value: string): boolean {
  const pending: SemanticScanRange[] = [{ start: 0, end: value.length }];

  while (pending.length > 0) {
    const range = pending.pop();
    if (!range) break;

    for (let index = range.start; index < range.end;) {
      if (value[index] === "\\" && index + 1 < range.end) {
        const escapedCodePoint = value.codePointAt(index + 1);
        if (escapedCodePoint === undefined) break;
        const escapedCharacter = String.fromCodePoint(escapedCodePoint);
        if (SEMANTIC_CHARACTER.test(escapedCharacter)) return true;
        index += 1 + escapedCharacter.length;
        continue;
      }

      if (value.startsWith("<!--", index)) {
        const commentEnd = value.indexOf("-->", index + 4);
        if (commentEnd < 0 || commentEnd + 3 > range.end) break;
        index = commentEnd + 3;
        continue;
      }

      const code = inlineMarkdownCodeAt(value, index, range.end);
      if (code) {
        if (rangeHasSemanticCharacter(value, code.content)) return true;
        index = code.nextIndex;
        continue;
      }

      const link = inlineMarkdownLinkAt(value, index, range.end);
      if (link) {
        if (link.label.start < link.label.end) pending.push(link.label);
        index = link.nextIndex;
        continue;
      }

      if (value[index] === "<") {
        const markupEnd = value.indexOf(">", index + 1);
        if (markupEnd < 0 || markupEnd >= range.end) break;
        if (HTTP_AUTOLINK.test(value.slice(index + 1, markupEnd))) return true;
        index = markupEnd + 1;
        continue;
      }

      const entity = entityAt(value, index);
      if (entity) {
        if (entity.semantic) return true;
        index += entity.length;
        continue;
      }

      const codePoint = value.codePointAt(index);
      if (codePoint === undefined) break;
      const character = String.fromCodePoint(codePoint);
      if (SEMANTIC_CHARACTER.test(character)) return true;
      index += character.length;
    }
  }

  return false;
}
