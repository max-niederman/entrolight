import {
  INFERENCE_MESSAGE_TYPE,
  type InferenceErrorResponse,
  type InferenceResponse,
  type InferenceToken,
} from "../lib/inference";
import {
  chunkMarkdown,
  type MarkdownChunk,
  type MarkdownSourceMap,
  serializeDocumentWithSourceMap,
} from "../lib/source-mapped-markdown";
import { loadSettings } from "../lib/settings";

const MAX_CHUNK_CHARACTERS = 4000;
const PREFERRED_MIN_CHUNK_CHARACTERS = 2000;
const MAX_CHUNK_SPLIT_DEPTH = 4;
const HIGHLIGHT_DEBOUNCE_MS = 500;
const HIGHLIGHT_NAME = "entrolight-surprise";
const HIGHLIGHT_STYLE_ID = "entrolight-highlight-style";

let scheduledRunHandle: number | null = null;
let latestScheduledRunId = 0;
let suppressMutationScheduling = false;
let rerunQueuedDuringSuppression = false;
let domObserver: MutationObserver | null = null;
let ignoredMutationDepth = 0;

export default defineContentScript({
  matches: ["*://*/*"],
  async main() {
    if (document.readyState === "loading") {
      await new Promise<void>((resolve) => {
        document.addEventListener(
          "DOMContentLoaded",
          () => resolve(),
          { once: true },
        );
      });
    }

    observeDomChanges();
    scheduleHighlightRun();
  },
});

function observeDomChanges() {
  const target = document.body ?? document.documentElement;
  if (!target) {
    return;
  }
  domObserver = new MutationObserver(() => {
    if (ignoredMutationDepth > 0) {
      return;
    }
    if (suppressMutationScheduling) {
      rerunQueuedDuringSuppression = true;
      return;
    }
    scheduleHighlightRun();
  });
  domObserver.observe(target, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

function scheduleHighlightRun() {
  const runId = ++latestScheduledRunId;
  console.log("entrolight: scheduled highlight run", { runId });
  if (scheduledRunHandle !== null) {
    window.clearTimeout(scheduledRunHandle);
  }
  scheduledRunHandle = window.setTimeout(() => {
    scheduledRunHandle = null;
    console.log("entrolight: executing highlight run", { runId });
    highlightHighEntropyText(runId).catch((error) => {
      console.error("entrolight highlight failed", error);
    });
  }, HIGHLIGHT_DEBOUNCE_MS);
}

async function highlightHighEntropyText(runId: number) {
  const root = document.body ?? document.documentElement;
  if (!root) {
    return;
  }

  suppressMutationScheduling = true;
  try {
    const settings = await loadSettings();
    const { markdown, sourceMap } = serializeDocumentWithSourceMap(root);
    console.log("entrolight: markdown", { length: markdown.length });
    const chunks = chunkMarkdown(markdown, {
      maxChunkLength: MAX_CHUNK_CHARACTERS,
      preferredMinChunkLength: PREFERRED_MIN_CHUNK_CHARACTERS,
    });
    const aggregatedTokens: InferenceToken[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index]!;
      if (!chunk.text.trim()) {
        continue;
      }
      if (runId !== latestScheduledRunId) {
        console.log("entrolight: highlight run aborted before chunk inference", {
          runId,
          chunkIndex: index,
          latestRunId: latestScheduledRunId,
        });
        return;
      }
      const chunkTokens = await inferChunkWithRetries(chunk, runId);
      if (chunkTokens === null) {
        console.warn("entrolight: inference chunk failed after retries", { chunkIndex: index });
        return;
      }
      aggregatedTokens.push(...chunkTokens);
      console.log("entrolight: inference chunk complete", {
        runId,
        chunkIndex: index,
        chunkTokenCount: chunkTokens.length,
      });
      if (runId !== latestScheduledRunId) {
        console.log("entrolight: inference chunk became stale", {
          runId,
          chunkIndex: index,
          latestRunId: latestScheduledRunId,
        });
        return;
      }
    }

    const surpriseThreshold = computeSurpriseThreshold(aggregatedTokens, settings.surpriseQuantile);
    console.log("entrolight: surprise threshold computed", {
      surpriseQuantile: settings.surpriseQuantile,
      surpriseThreshold,
      tokenCount: aggregatedTokens.length,
      runId,
    });
    const ranges =
      surpriseThreshold === null
        ? []
        : collectHighlightRanges(aggregatedTokens, sourceMap, document, surpriseThreshold);
    console.log("entrolight: highlight ranges ready", { count: ranges.length, runId });
    applyCssHighlights(document, ranges);
    console.log("entrolight: highlight run finished", { runId });
  } finally {
    suppressMutationScheduling = false;
    if (rerunQueuedDuringSuppression) {
      console.log("entrolight: rerun queued during suppression");
      rerunQueuedDuringSuppression = false;
      scheduleHighlightRun();
    }
  }
}

async function requestInference(prompt: string): Promise<InferenceResponse | InferenceErrorResponse | null> {
  try {
    console.log("entrolight: sending inference message", { length: prompt.length });
    const result = (await browser.runtime.sendMessage({
      type: INFERENCE_MESSAGE_TYPE,
      prompt,
    })) as InferenceResponse | InferenceErrorResponse | null;
    console.log("entrolight: inference message resolved", {
      hasResult: Boolean(result),
      tokenCount: result && "tokens" in result ? result.tokens.length : 0,
    });
    return result;
  } catch (error) {
    console.error("entrolight inference messaging failed", error);
    return null;
  }
}

function collectHighlightRanges(
  tokens: InferenceToken[],
  sourceMap: MarkdownSourceMap,
  doc: Document,
  surpriseThreshold: number,
): Range[] {
  const ranges: Range[] = [];
  for (const token of tokens) {
    const surprise = -token.logprob;
    if (surprise < surpriseThreshold) {
      continue;
    }
    if (!token.token.trim()) {
      continue;
    }
    const start = token.position;
    const end = token.position + token.token.length;
    const tokenRanges = sourceMap.createDomRanges(doc, start, end);
    if (tokenRanges.length === 0) {
      console.warn("entrolight: token produced no DOM ranges", { token, start, end });
    }
    for (const range of tokenRanges) {
      if (range.collapsed) {
        continue;
      }
      ranges.push(range);
    }
  }
  return ranges;
}

function applyCssHighlights(doc: Document, ranges: Range[]) {
  if (!isHighlightApiAvailable()) {
    console.warn("entrolight: CSS Highlight API unavailable");
    return;
  }
  ensureHighlightStyles(doc);
  runWithIgnoredMutations(() => {
    CSS.highlights!.delete(HIGHLIGHT_NAME);
  });
  const mergedRanges = mergeRanges(ranges);
  if (mergedRanges.length === 0) {
    console.log("entrolight: cleared existing highlights (no ranges)");
    return;
  }
  runWithIgnoredMutations(() => {
    CSS.highlights!.set(HIGHLIGHT_NAME, new Highlight(...mergedRanges));
  });
  console.log("entrolight: applied CSS highlights", { count: mergedRanges.length, original: ranges.length });
}

function ensureHighlightStyles(doc: Document) {
  if (doc.getElementById(HIGHLIGHT_STYLE_ID)) {
    return;
  }
  const parent = doc.head ?? doc.documentElement;
  if (!parent) {
    return;
  }
  runWithIgnoredMutations(() => {
    const style = doc.createElement("style");
    style.id = HIGHLIGHT_STYLE_ID;
    style.textContent = `::highlight(${HIGHLIGHT_NAME}) { background-color: rgba(255, 145, 0, 0.4); border-radius: 0.2em; box-shadow: 0 0 0 1px rgba(255, 145, 0, 0.25); }`;
    parent.appendChild(style);
  });
}

function isHighlightApiAvailable(): boolean {
  return typeof Highlight !== "undefined" && typeof CSS !== "undefined" && !!CSS.highlights;
}

async function inferChunkWithRetries(
  chunk: MarkdownChunk,
  runId: number,
  depth = 0,
): Promise<InferenceToken[] | null> {
  if (!chunk.text.trim()) {
    return [];
  }
  console.log("entrolight: requesting inference chunk", {
    runId,
    chunkDepth: depth,
    chunkLength: chunk.text.length,
    markdownStart: chunk.markdownStart,
    markdownEnd: chunk.markdownEnd,
  });
  const result = await requestInference(chunk.text);
  if (!result) {
    return null;
  }
  if ("error" in result) {
    if (result.error === "PROMPT_TOO_LONG" && depth < MAX_CHUNK_SPLIT_DEPTH) {
      const nextChunks = splitChunkForTokenLimit(chunk);
      if (nextChunks.length === 0) {
        console.warn("entrolight: unable to split chunk further after token limit", {
          chunkLength: chunk.text.length,
          markdownStart: chunk.markdownStart,
          markdownEnd: chunk.markdownEnd,
        });
        return null;
      }
      const aggregated: InferenceToken[] = [];
      for (const nextChunk of nextChunks) {
        const tokens = await inferChunkWithRetries(nextChunk, runId, depth + 1);
        if (tokens === null) {
          return null;
        }
        aggregated.push(...tokens);
      }
      return aggregated;
    }
    console.warn("entrolight: inference returned error", result);
    return null;
  }
  return result.tokens.map((token) => ({
    ...token,
    position: token.position + chunk.markdownStart,
  }));
}

function splitChunkForTokenLimit(chunk: MarkdownChunk): MarkdownChunk[] {
  const absoluteLength = chunk.markdownEnd - chunk.markdownStart;
  if (absoluteLength <= 1) {
    return [];
  }
  const desiredMax = Math.max(1, Math.floor(absoluteLength / 2));
  const desiredMin = Math.max(1, Math.floor(absoluteLength / 4));
  const relativeChunks = chunkMarkdown(chunk.text, {
    maxChunkLength: desiredMax,
    preferredMinChunkLength: desiredMin,
  });
  if (relativeChunks.length > 1) {
    return relativeChunks.map((relative) => ({
      markdownStart: chunk.markdownStart + relative.markdownStart,
      markdownEnd: chunk.markdownStart + relative.markdownEnd,
      text: relative.text,
    }));
  }
  const midpoint = chunk.markdownStart + Math.floor(absoluteLength / 2);
  if (midpoint <= chunk.markdownStart || midpoint >= chunk.markdownEnd) {
    return [];
  }
  const relativeMidpoint = midpoint - chunk.markdownStart;
  return [
    {
      markdownStart: chunk.markdownStart,
      markdownEnd: midpoint,
      text: chunk.text.slice(0, relativeMidpoint),
    },
    {
      markdownStart: midpoint,
      markdownEnd: chunk.markdownEnd,
      text: chunk.text.slice(relativeMidpoint),
    },
  ];
}

function computeSurpriseThreshold(tokens: InferenceToken[], quantile: number): number | null {
  if (tokens.length === 0) {
    return null;
  }
  const meaningfulSurprises = tokens
    .filter((token) => token.token.trim().length > 0)
    .map((token) => -token.logprob)
    .sort((a, b) => a - b);
  if (meaningfulSurprises.length === 0) {
    return null;
  }
  const clampedQuantile = Math.min(1, Math.max(0, quantile));
  const index = Math.floor(clampedQuantile * (meaningfulSurprises.length - 1));
  return meaningfulSurprises[index]!;
}

function mergeRanges(ranges: Range[]): Range[] {
  if (ranges.length === 0) {
    return [];
  }
  const sorted = [...ranges].sort((a, b) => {
    const startComparison = a.compareBoundaryPoints(Range.START_TO_START, b);
    if (startComparison !== 0) {
      return startComparison;
    }
    return a.compareBoundaryPoints(Range.END_TO_END, b);
  });
  const merged: Range[] = [];
  let current = sorted[0]!.cloneRange();
  for (let i = 1; i < sorted.length; i += 1) {
    const candidate = sorted[i]!;
    const gap = current.compareBoundaryPoints(Range.END_TO_START, candidate);
    if (gap >= 0) {
      if (current.compareBoundaryPoints(Range.END_TO_END, candidate) < 0) {
        current.setEnd(candidate.endContainer, candidate.endOffset);
      }
      continue;
    }
    merged.push(current);
    current = candidate.cloneRange();
  }
  merged.push(current);
  return merged;
}

function runWithIgnoredMutations(callback: () => void) {
  ignoredMutationDepth += 1;
  try {
    callback();
  } finally {
    ignoredMutationDepth = Math.max(0, ignoredMutationDepth - 1);
  }
}
