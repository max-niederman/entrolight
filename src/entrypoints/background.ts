import {
  INFERENCE_MESSAGE_TYPE,
  type InferenceRequestMessage,
  type InferenceResponse,
  type InferenceResult,
  isInferenceRequestMessage,
} from "../lib/inference";
import { loadSettings } from "../lib/settings";

const FIREWORKS_COMPLETIONS_URL = "https://api.fireworks.ai/inference/v1/completions";

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
    console.log("entrolight background: requesting Fireworks inference", { length: message.prompt.length });
    const settings = await loadSettings();
    if (!settings.fireworksApiKey) {
      console.error("entrolight background: missing Fireworks API key");
      return null;
    }
    if (!settings.fireworksModel) {
      console.error("entrolight background: missing Fireworks model code");
      return null;
    }
    const response = await fetch(FIREWORKS_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.fireworksApiKey}`,
      },
      body: JSON.stringify({
        model: settings.fireworksModel,
        prompt: message.prompt,
        max_tokens: 0,
        echo: true,
        logprobs: 1,
        temperature: 0,
      }),
    });
    if (!response.ok) {
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
      console.error("entrolight background inference failed", response.status, response.statusText, detail);
      return null;
    }
    const body = (await response.json()) as FireworksCompletionResponse;
    const normalized = normalizeCompletion(body, message.prompt);
    if (!normalized) {
      console.error("entrolight background: Fireworks response missing logprobs");
      return null;
    }
    console.log("entrolight background: inference success", { tokens: normalized.tokens.length });
    return normalized;
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

type FireworksCompletionResponse = {
  choices?: Array<{
    logprobs?: {
      tokens?: Array<string | null>;
      token_logprobs?: Array<number | null>;
      text_offset?: Array<number | null>;
    };
  }>;
};

function normalizeCompletion(response: FireworksCompletionResponse, prompt: string): InferenceResponse | null {
  const choice = response.choices?.[0];
  if (!choice || !choice.logprobs) {
    return null;
  }
  const tokens = extractTokens(choice.logprobs, prompt);
  return { tokens };
}

function extractTokens(
  logprobs: NonNullable<FireworksCompletionResponse["choices"]>[number]["logprobs"],
  prompt: string,
): InferenceResponse["tokens"] {
  const normalized: InferenceResponse["tokens"] = [];
  const tokens = logprobs?.tokens ?? [];
  const logprobValues = logprobs?.token_logprobs ?? [];
  const offsets = logprobs?.text_offset ?? [];
  let fallbackPosition = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const tokenText = tokens[index] ?? "";
    const logprob = logprobValues[index];
    if (typeof tokenText !== "string") {
      continue;
    }
    if (typeof logprob !== "number" || Number.isNaN(logprob)) {
      continue;
    }
    const providedOffset = offsets[index];
    const position = resolveTokenStart({
      prompt,
      tokenText,
      fallbackPosition,
      providedOffset: typeof providedOffset === "number" ? providedOffset : null,
    });
    normalized.push({
      position,
      token: tokenText,
      logprob,
    });
    fallbackPosition = position + tokenText.length;
  }
  return normalized;
}

function resolveTokenStart({
  prompt,
  tokenText,
  fallbackPosition,
  providedOffset,
}: {
  prompt: string;
  tokenText: string;
  fallbackPosition: number;
  providedOffset: number | null;
}): number {
  if (typeof providedOffset === "number" && Number.isFinite(providedOffset)) {
    return clampPosition(providedOffset, prompt.length);
  }
  if (!tokenText) {
    return clampPosition(fallbackPosition, prompt.length);
  }
  const directMatch = prompt.slice(fallbackPosition, fallbackPosition + tokenText.length);
  if (directMatch === tokenText) {
    return clampPosition(fallbackPosition, prompt.length);
  }
  const nextIndex = prompt.indexOf(tokenText, fallbackPosition);
  if (nextIndex !== -1) {
    return clampPosition(nextIndex, prompt.length);
  }
  return clampPosition(fallbackPosition, prompt.length);
}

function clampPosition(position: number, maxLength: number): number {
  if (!Number.isFinite(position)) {
    return 0;
  }
  if (position < 0) {
    return 0;
  }
  if (position > maxLength) {
    return maxLength;
  }
  return position;
}

function extractPromptTooLongDetail(detail: unknown):
  | { maxTokens: number; tokenCount: number }
  | null {
  const payload = unwrapErrorPayload(detail);
  if (!payload) {
    return null;
  }
  const maxTokensCandidate =
    (payload as Record<string, unknown>)["max_prompt_tokens"] ??
    (payload as Record<string, unknown>)["maximum_context_length"];
  const tokenCountCandidate =
    (payload as Record<string, unknown>)["token_count"] ??
    (payload as Record<string, unknown>)["prompt_tokens"];
  const maxTokens = parseMaybeNumber(maxTokensCandidate);
  const tokenCount = parseMaybeNumber(tokenCountCandidate);
  if (Number.isFinite(maxTokens) && Number.isFinite(tokenCount)) {
    return { maxTokens: maxTokens!, tokenCount: tokenCount! };
  }
  const message = typeof (payload as Record<string, unknown>).message === "string"
    ? ((payload as Record<string, unknown>).message as string)
    : "";
  const regex = /maximum (?:context )?length is (\d+)[^\d]+requested (\d+)/i;
  const match = message.match(regex);
  if (match) {
    const [, maxTokensRaw, requestedRaw] = match;
    const max = Number(maxTokensRaw);
    const requested = Number(requestedRaw);
    if (Number.isFinite(max) && Number.isFinite(requested)) {
      return { maxTokens: max, tokenCount: requested };
    }
  }
  return null;
}

function unwrapErrorPayload(detail: unknown): Record<string, unknown> | null {
  if (!detail || typeof detail !== "object") {
    return null;
  }
  const container = detail as { detail?: unknown; error?: unknown };
  const payload =
    container.error && typeof container.error === "object"
      ? (container.error as Record<string, unknown>)
      : container.detail && typeof container.detail === "object"
        ? (container.detail as Record<string, unknown>)
        : (detail as Record<string, unknown>);
  if (!payload || typeof payload !== "object") {
    return null;
  }
  return payload;
}

function parseMaybeNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
