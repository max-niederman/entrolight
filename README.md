# Entrolight

Entrolight is a browser extension which uses LLMs to automatically highlight high-entropy parts of webpages.
It uses a vLLM-based hosted backend to compute input logprobs on the semantic parts of the page, then highlights the tokens below a logprob threshold.