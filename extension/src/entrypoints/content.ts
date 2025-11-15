import {
  INFERENCE_MESSAGE_TYPE,
  type InferenceResponse,
  type InferenceToken,
} from "../lib/inference";
import { MarkdownSourceMap, serializeDocumentWithSourceMap } from "../lib/source-mapped-markdown";

const SURPRISE_THRESHOLD = 8;
const HIGHLIGHT_DEBOUNCE_MS = 500;
const HIGHLIGHT_NAME = "entrolight-surprise";
const HIGHLIGHT_STYLE_ID = "entrolight-highlight-style";

let scheduledRunHandle: number | null = null;
let latestScheduledRunId = 0;
let suppressMutationScheduling = false;
let rerunQueuedDuringSuppression = false;
let domObserver: MutationObserver | null = null;

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
    const { markdown, sourceMap } = serializeDocumentWithSourceMap(root);
    console.log("entrolight: markdown", markdown);
    console.log("entrolight: requesting inference", { length: markdown.length, runId });
    const response = await requestInference(markdown);
    if (!response || runId !== latestScheduledRunId) {
      console.log("entrolight: inference aborted or stale", {
        hasResponse: Boolean(response),
        runId,
        latestRunId: latestScheduledRunId,
        scheduledHandleActive: scheduledRunHandle !== null,
      });
      return;
    }

    console.log("entrolight: inference complete", { tokens: response.tokens.length, runId });
    const ranges = collectHighlightRanges(response.tokens, sourceMap, document);
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

async function requestInference(prompt: string): Promise<InferenceResponse | null> {
  try {
    console.log("entrolight: sending inference message", { length: prompt.length });
    const result = (await browser.runtime.sendMessage({
      type: INFERENCE_MESSAGE_TYPE,
      prompt,
    })) as InferenceResponse | null;
    console.log("entrolight: inference message resolved", {
      hasResult: Boolean(result),
      tokenCount: result?.tokens.length ?? 0,
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
): Range[] {
  const ranges: Range[] = [];
  for (const token of tokens) {
    const surprise = -token.logprob;
    if (surprise < SURPRISE_THRESHOLD) {
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
  CSS.highlights!.delete(HIGHLIGHT_NAME);
  if (ranges.length === 0) {
    console.log("entrolight: cleared existing highlights (no ranges)");
    return;
  }
  CSS.highlights!.set(HIGHLIGHT_NAME, new Highlight(...ranges));
  console.log("entrolight: applied CSS highlights", { count: ranges.length });
}

function ensureHighlightStyles(doc: Document) {
  if (doc.getElementById(HIGHLIGHT_STYLE_ID)) {
    return;
  }
  const style = doc.createElement("style");
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `::highlight(${HIGHLIGHT_NAME}) { background-color: rgba(255, 145, 0, 0.4); border-radius: 0.2em; box-shadow: 0 0 0 1px rgba(255, 145, 0, 0.25); }`;
  const parent = doc.head ?? doc.documentElement;
  if (!parent) {
    return;
  }
  parent.appendChild(style);
}

function isHighlightApiAvailable(): boolean {
  return typeof Highlight !== "undefined" && typeof CSS !== "undefined" && !!CSS.highlights;
}
