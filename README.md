# Entrolight

Entrolight is a browser extension which uses LLMs to automatically highlight high-entropy parts of webpages.
It uses Fireworks' serverless inference API to fetch input logprobs on the semantic parts of the page, then highlights the tokens below a logprob threshold.
Provide your Fireworks API key plus a model code in the popup settings before running the extension locally.
