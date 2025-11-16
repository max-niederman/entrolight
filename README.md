# Entrolight

Entrolight is a browser extension which uses LLMs to automatically highlight high-entropy parts of webpages.
It uses Fireworks' serverless inference API to fetch input logprobs on the semantic parts of the page, then highlights the tokens below a logprob threshold.
Provide your Fireworks API key plus a model code in the popup settings before running the extension locally.

## Usage Instructions

Entrolight is currently very much an alpha project and has way too many bugs to reasonably use for general browsing, so it's not published on any extension stores.
You can, however, build it with Bun ([installation instructions](https://bun.com/docs/installation)) if you're interested in trying it out:

```bash
# install dependencies
bun install

# run the development build with live reload in chrome/chromium
bun run dev

# build an unpacked chrome manifest v3 bundle
bun run build
```

You'll need to add a [Fireworks](https://fireworks.ai/) API key in the settings for inference to work.
