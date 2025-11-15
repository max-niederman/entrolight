import {
  INFERENCE_MESSAGE_TYPE,
  type InferenceRequestMessage,
  type InferenceResponse,
  type InferenceResult,
  isInferenceRequestMessage,
} from "../lib/inference";
import { loadSettings } from "../lib/settings";

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isInferenceRequestMessage(message)) {
      return undefined;
    }
    handleInferenceRequest(message)
      .then((response) => sendResponse(response))
      .catch((error) => {
        console.error("entrolight background: unhandled inference error", error);
        sendResponse(null);
      });
    return true;
  });
});

async function handleInferenceRequest(message: InferenceRequestMessage): Promise<InferenceResult | null> {
  try {
    console.log("entrolight background: forwarding inference", { length: message.prompt.length });
    const settings = await loadSettings();
    const response = await fetch(settings.backendEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: message.prompt }),
    });
    if (response.status === 413) {
      const detail = await parseDetail(response);
      const parsed = extractPromptTooLongDetail(detail);
      if (parsed) {
        console.warn("entrolight background: prompt exceeded token limit", parsed);
        return {
          error: "PROMPT_TOO_LONG",
          maxTokens: parsed.maxTokens,
          tokenCount: parsed.tokenCount,
        };
      }
      console.error("entrolight background inference failed with 413 but detail missing");
      return null;
    }
    if (!response.ok) {
      console.error("entrolight background inference failed", response.status, response.statusText);
      return null;
    }
    const body = (await response.json()) as InferenceResponse;
    console.log("entrolight background: inference success", { tokens: body.tokens.length });
    return body;
  } catch (error) {
    console.error("entrolight background inference errored", error);
    return null;
  }
}

async function parseDetail(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    console.warn("entrolight background: failed to parse error detail", error);
    return null;
  }
}

function extractPromptTooLongDetail(detail: unknown):
  | { maxTokens: number; tokenCount: number }
  | null {
  if (!detail || typeof detail !== "object") {
    return null;
  }
  const container = detail as { detail?: unknown };
  const payload = typeof container.detail === "object" && container.detail !== null ? container.detail : detail;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const maxTokensCandidate = (payload as Record<string, unknown>)["max_prompt_tokens"];
  const tokenCountCandidate = (payload as Record<string, unknown>)["token_count"];
  const maxTokens = typeof maxTokensCandidate === "number" ? maxTokensCandidate : Number(maxTokensCandidate);
  const tokenCount = typeof tokenCountCandidate === "number" ? tokenCountCandidate : Number(tokenCountCandidate);
  if (!Number.isFinite(maxTokens) || !Number.isFinite(tokenCount)) {
    return null;
  }
  return { maxTokens, tokenCount };
}
