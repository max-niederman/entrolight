import asyncio
from fastapi import FastAPI
from pydantic import BaseModel
from vllm import LLM, SamplingParams
from vllm.logprobs import PromptLogprobs

app = FastAPI()


class InferenceRequest(BaseModel):
    prompt: str


class InferenceToken(BaseModel):
    position: int
    token: str
    logprob: float


class InferenceResponse(BaseModel):
    tokens: list[InferenceToken]


_llm = None


def _get_llm() -> LLM:
    global _llm
    if _llm is None:
        _llm = LLM(model="google/gemma-3-270m", gpu_memory_utilization=0.5)
    return _llm


@app.post("/api/v1/infer")
async def infer(request: InferenceRequest) -> InferenceResponse:
    llm = _get_llm()
    [output] = llm.generate(
        request.prompt, SamplingParams(max_tokens=1, prompt_logprobs=True)
    )

    assert output.prompt_logprobs is not None

    inference_tokens = []
    position = 0
    for position_token, position_logprobs in zip(
        output.prompt_token_ids, output.prompt_logprobs
    ):
        if position_logprobs is None:
            continue

        logprob = position_logprobs[position_token]
        inference_tokens.append(
            InferenceToken(
                position=position,
                token=logprob.decoded_token,
                logprob=logprob.logprob,
            )
        )
        position += len(logprob.decoded_token)

    assert position == len(request.prompt)

    return InferenceResponse(tokens=inference_tokens)
