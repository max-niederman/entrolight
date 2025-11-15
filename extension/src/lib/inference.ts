export type InferenceToken = {
  position: number;
  token: string;
  logprob: number;
};

export type InferenceResponse = {
  tokens: InferenceToken[];
};

export const INFERENCE_ENDPOINT = "http://127.0.0.1:8000/api/v1/infer";
export const INFERENCE_MESSAGE_TYPE = "entrolight:perform-inference";

export type InferenceRequestMessage = {
  type: typeof INFERENCE_MESSAGE_TYPE;
  prompt: string;
};

export function isInferenceRequestMessage(message: unknown): message is InferenceRequestMessage {
  if (!message || typeof message !== "object") {
    return false;
  }
  const candidate = message as Partial<InferenceRequestMessage>;
  return candidate.type === INFERENCE_MESSAGE_TYPE && typeof candidate.prompt === "string";
}
