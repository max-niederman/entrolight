import {
  INFERENCE_ENDPOINT,
  INFERENCE_MESSAGE_TYPE,
  type InferenceRequestMessage,
  type InferenceResponse,
  isInferenceRequestMessage,
} from "../lib/inference";

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

async function handleInferenceRequest(message: InferenceRequestMessage): Promise<InferenceResponse | null> {
  try {
    console.log("entrolight background: forwarding inference", { length: message.prompt.length });
    const response = await fetch(INFERENCE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: message.prompt }),
    });
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
