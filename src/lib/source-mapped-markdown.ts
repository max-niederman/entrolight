type SourceSegment = {
  markdownStart: number;
  markdownEnd: number;
  node: Text;
  nodeStart: number;
  nodeEnd: number;
};

export type DomTextSlice = {
  node: Text;
  nodeStart: number;
  nodeEnd: number;
  markdownStart: number;
  markdownEnd: number;
};

export class MarkdownSourceMap {
  constructor(private readonly segments: SourceSegment[]) {}

  slice(markdownStart: number, markdownEnd: number): DomTextSlice[] {
    const normalizedStart = Math.max(0, Math.min(markdownStart, markdownEnd));
    const normalizedEnd = Math.max(normalizedStart, markdownEnd);
    if (normalizedEnd === normalizedStart || this.segments.length === 0) {
      return [];
    }

    const slices: DomTextSlice[] = [];
    let index = this.findSegmentIndex(normalizedStart);
    while (index < this.segments.length) {
      const segment = this.segments[index];
      if (segment.markdownStart >= normalizedEnd) {
        break;
      }
      if (segment.markdownEnd <= normalizedStart) {
        index += 1;
        continue;
      }

      const overlapStart = Math.max(segment.markdownStart, normalizedStart);
      const overlapEnd = Math.min(segment.markdownEnd, normalizedEnd);
      const shift = overlapStart - segment.markdownStart;
      slices.push({
        node: segment.node,
        nodeStart: segment.nodeStart + shift,
        nodeEnd: segment.nodeStart + shift + (overlapEnd - overlapStart),
        markdownStart: overlapStart,
        markdownEnd: overlapEnd,
      });

      if (segment.markdownEnd >= normalizedEnd) {
        break;
      }
      index += 1;
    }

    return slices;
  }

  resolve(markdownOffset: number): DomTextSlice | null {
    const foundIndex = this.findSegmentIndex(markdownOffset);
    if (foundIndex >= this.segments.length) {
      return null;
    }
    const segment = this.segments[foundIndex];
    if (markdownOffset < segment.markdownStart || markdownOffset >= segment.markdownEnd) {
      return null;
    }
    const shift = markdownOffset - segment.markdownStart;
    return {
      node: segment.node,
      nodeStart: segment.nodeStart + shift,
      nodeEnd: segment.nodeStart + shift + 1,
      markdownStart: markdownOffset,
      markdownEnd: markdownOffset + 1,
    };
  }

  createDomRanges(doc: Document, markdownStart: number, markdownEnd: number): Range[] {
    return this.slice(markdownStart, markdownEnd).map((slice) => {
      const range = doc.createRange();
      range.setStart(slice.node, slice.nodeStart);
      range.setEnd(slice.node, slice.nodeEnd);
      return range;
    });
  }

  private findSegmentIndex(offset: number): number {
    let low = 0;
    let high = this.segments.length - 1;
    let answer = this.segments.length;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.segments[mid].markdownEnd > offset) {
        answer = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return answer;
  }
}

export type SourceMappedMarkdown = {
  markdown: string;
  sourceMap: MarkdownSourceMap;
};

export type MarkdownChunk = {
  markdownStart: number;
  markdownEnd: number;
  text: string;
};

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "canvas",
  "dd",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
]);

const SKIP_TAGS = new Set(["script", "style", "noscript", "template"]);

interface SerializeContext {
  listIndent: string;
  inline: boolean;
  insideLink: boolean;
}

class MarkdownBuilder {
  private chunks: string[] = [];
  private segments: SourceSegment[] = [];
  private totalLength = 0;
  private trailingNewlines = 0;

  appendLiteral(text: string) {
    if (!text) {
      return;
    }
    this.chunks.push(text);
    this.totalLength += text.length;
    this.trailingNewlines = this.updateTrailingNewlines(text);
  }

  appendTextNode(node: Text, rawText: string, { escape = true }: { escape?: boolean } = {}) {
    if (!rawText) {
      return;
    }
    for (let i = 0; i < rawText.length; i += 1) {
      let char = rawText[i];
      if (char === "\r") {
        continue;
      }
      if (char === "\u00a0") {
        char = " ";
      }
      const escaped = escape ? escapeMarkdownChar(char) : char;
      if (!escaped) {
        continue;
      }
      const offsetBefore = this.totalLength;
      this.appendLiteral(escaped);
      for (let delta = 0; delta < escaped.length; delta += 1) {
        this.segments.push({
          markdownStart: offsetBefore + delta,
          markdownEnd: offsetBefore + delta + 1,
          node,
          nodeStart: i,
          nodeEnd: i + 1,
        });
      }
    }
  }

  ensureBlankLines(count: number) {
    if (this.totalLength === 0) {
      return;
    }
    while (this.trailingNewlines < count) {
      this.appendLiteral("\n");
    }
  }

  build(): SourceMappedMarkdown {
    return {
      markdown: this.chunks.join(""),
      sourceMap: new MarkdownSourceMap(this.segments),
    };
  }

  private updateTrailingNewlines(text: string): number {
    if (!text) {
      return this.trailingNewlines;
    }
    let trailing = 0;
    for (let i = text.length - 1; i >= 0; i -= 1) {
      if (text[i] === "\n") {
        trailing += 1;
      } else {
        break;
      }
    }
    if (trailing === text.length) {
      return this.trailingNewlines + trailing;
    }
    return trailing;
  }
}

export function serializeDocumentWithSourceMap(root: Element): SourceMappedMarkdown {
  const builder = new MarkdownBuilder();
  serializeChildren(root, builder, { inline: false, listIndent: "", insideLink: false });
  return builder.build();
}

function serializeChildren(node: Node, builder: MarkdownBuilder, context: SerializeContext) {
  node.childNodes.forEach((child) => serializeNode(child, builder, context));
}

function serializeNode(node: Node, builder: MarkdownBuilder, context: SerializeContext) {
  if (node.nodeType === Node.TEXT_NODE) {
    const textNode = node as Text;
    builder.appendTextNode(textNode, textNode.textContent ?? "");
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return;
  }

  const element = node as Element;
  const tagName = element.tagName.toLowerCase();

  if (SKIP_TAGS.has(tagName)) {
    return;
  }

  if (tagName === "br") {
    builder.appendLiteral("\n");
    return;
  }

  if (tagName === "hr") {
    builder.ensureBlankLines(2);
    builder.appendLiteral("---\n\n");
    return;
  }

  if (tagName === "img") {
    const alt = element.getAttribute("alt") ?? "";
    const src = element.getAttribute("src") ?? "";
    builder.appendLiteral(`![${escapeAttribute(alt)}](${escapeAttribute(src)})`);
    return;
  }

  if (tagName === "a") {
    const href = element.getAttribute("href") ?? "";
    builder.appendLiteral("[");
    serializeChildren(element, builder, { ...context, insideLink: true, inline: true });
    builder.appendLiteral(`](${escapeAttribute(href)})`);
    return;
  }

  if (tagName === "code" && element.closest("pre") !== element.parentElement) {
    builder.appendLiteral("`");
    element.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        builder.appendTextNode(child as Text, (child.textContent ?? ""), { escape: false });
      } else {
        serializeNode(child, builder, { ...context, inline: true });
      }
    });
    builder.appendLiteral("`");
    return;
  }

  if (tagName === "pre") {
    builder.ensureBlankLines(2);
    const language = element.getAttribute("data-language") ?? "";
    builder.appendLiteral("```" + language + "\n");
    element.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        builder.appendTextNode(child as Text, child.textContent ?? "", { escape: false });
      } else {
        serializeNode(child, builder, { ...context, inline: false });
      }
    });
    builder.appendLiteral("\n```\n\n");
    return;
  }

  if (tagName === "ul") {
    serializeList(element, builder, context, false);
    return;
  }

  if (tagName === "ol") {
    serializeList(element, builder, context, true);
    return;
  }

  if (tagName === "blockquote") {
    builder.ensureBlankLines(2);
    builder.appendLiteral("> ");
    serializeChildren(element, builder, { ...context, inline: false });
    builder.ensureBlankLines(2);
    return;
  }

  if (tagName.startsWith("h") && tagName.length === 2 && /[1-6]/.test(tagName[1]!)) {
    const level = parseInt(tagName[1]!, 10);
    builder.ensureBlankLines(2);
    builder.appendLiteral("#".repeat(level) + " ");
    serializeChildren(element, builder, { ...context, inline: true });
    builder.ensureBlankLines(2);
    return;
  }

  if (tagName === "strong" || tagName === "b") {
    builder.appendLiteral("**");
    serializeChildren(element, builder, { ...context, inline: true });
    builder.appendLiteral("**");
    return;
  }

  if (tagName === "em" || tagName === "i") {
    builder.appendLiteral("*");
    serializeChildren(element, builder, { ...context, inline: true });
    builder.appendLiteral("*");
    return;
  }

  if (tagName === "s" || tagName === "del") {
    builder.appendLiteral("~~");
    serializeChildren(element, builder, { ...context, inline: true });
    builder.appendLiteral("~~");
    return;
  }

  if (BLOCK_TAGS.has(tagName)) {
    builder.ensureBlankLines(2);
    serializeChildren(element, builder, { ...context, inline: false });
    builder.ensureBlankLines(2);
    return;
  }

  serializeChildren(element, builder, context);
}

function serializeList(
  element: Element,
  builder: MarkdownBuilder,
  context: SerializeContext,
  ordered: boolean,
) {
  builder.ensureBlankLines(1);
  const items = Array.from(element.children).filter((child) => child.tagName.toLowerCase() === "li");
  items.forEach((item, index) => {
    const marker = ordered ? `${index + 1}. ` : "- ";
    builder.appendLiteral(context.listIndent + marker);
    serializeChildren(item, builder, {
      ...context,
      inline: false,
      listIndent: context.listIndent + "  ",
    });
    builder.appendLiteral("\n");
  });
  builder.ensureBlankLines(1);
}

function escapeMarkdownChar(char: string): string {
  if (/[`*_{}\[\]()#+\-!.>~|]/.test(char)) {
    return `\\${char}`;
  }
  return char;
}

function escapeAttribute(value: string): string {
  return value.replace(/([()\[\]\\])/g, "\\$1");
}

export function chunkMarkdown(
  markdown: string,
  {
    maxChunkLength = 4000,
    preferredMinChunkLength = 2000,
  }: { maxChunkLength?: number; preferredMinChunkLength?: number } = {},
): MarkdownChunk[] {
  const normalizedMax = Math.max(1, Math.floor(maxChunkLength));
  const normalizedMin = Math.max(1, Math.min(Math.floor(preferredMinChunkLength), normalizedMax));
  const chunks: MarkdownChunk[] = [];
  let start = 0;
  while (start < markdown.length) {
    const hardEnd = Math.min(start + normalizedMax, markdown.length);
    const boundary = findChunkBoundary(markdown, start, hardEnd, normalizedMin);
    const end = boundary === -1 ? hardEnd : boundary;
    chunks.push({
      markdownStart: start,
      markdownEnd: end,
      text: markdown.slice(start, end),
    });
    start = end;
  }
  if (chunks.length === 0 && markdown.length === 0) {
    return [];
  }
  return chunks.filter((chunk) => chunk.markdownEnd > chunk.markdownStart);
}

function findChunkBoundary(
  markdown: string,
  chunkStart: number,
  hardEnd: number,
  preferredMinLength: number,
): number {
  if (hardEnd - chunkStart <= 0) {
    return -1;
  }
  const available = hardEnd - chunkStart;
  const searchAnchor =
    available > preferredMinLength ? chunkStart + preferredMinLength : chunkStart + Math.floor(available / 2);
  const searchStart = Math.min(Math.max(chunkStart + 1, searchAnchor), hardEnd);
  if (searchStart >= hardEnd) {
    return -1;
  }
  const doubleBreak = findLastIndex(markdown, "\n\n", searchStart, hardEnd);
  if (doubleBreak !== -1) {
    return doubleBreak + 2;
  }
  const singleBreak = findLastIndex(markdown, "\n", searchStart, hardEnd);
  if (singleBreak !== -1) {
    return singleBreak + 1;
  }
  const sentenceBreak = findSentenceBoundary(markdown, searchStart, hardEnd);
  if (sentenceBreak !== -1) {
    return sentenceBreak;
  }
  return -1;
}

function findLastIndex(text: string, needle: string, start: number, end: number): number {
  const window = text.slice(start, end);
  const location = window.lastIndexOf(needle);
  if (location === -1) {
    return -1;
  }
  return start + location;
}

function findSentenceBoundary(text: string, start: number, end: number): number {
  for (let index = end - 1; index >= start; index -= 1) {
    const char = text[index];
    if (char === "." || char === "?" || char === "!") {
      const nextChar = text[index + 1] ?? "";
      if (nextChar === "" || /\s/.test(nextChar)) {
        return index + 1;
      }
    }
  }
  return -1;
}
