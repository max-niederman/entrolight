# Repository Guidelines

## Project Structure & Module Organization
- The repository root hosts the WXT/Svelte browser extension. WXT artifacts live in `.wxt/` during development and `.output/` for builds—do not commit either directory.
- UI code lives in `src/`, static assets in `public/`, and bundler/extension settings in `wxt.config.ts`, `tsconfig.json`, and `wxt-env.d.ts`.
- Dependency pins and scripts are managed through `package.json`, `bun.lock`, and the Bun toolchain (`bun install`, `bun run …`).

## Build, Test, and Development Commands
- Install dependencies with `bun install`. Run a live-reload build for Chromium via `bun run dev` or Firefox via `bun run dev:firefox`.
- Produce a signed bundle with `bun run build` (and `bun run build:firefox` if needed). Optionally create distributable archives via `bun run zip` / `bun run zip:firefox`; do not commit the zips.
- Run static checks with `bun run check`. Use `bun run postinstall` (or re-run `bun install`) if WXT manifests need regeneration.

## Coding Style & Naming Conventions
- Svelte/TypeScript: keep `<script lang="ts">` blocks typed, prefer `camelCase` for variables, colocate component-specific styles, and favor derived stores/helpers over ad-hoc DOM queries.
- Follow WXT’s module conventions (e.g., background scripts under `src/background/`, content scripts in `src/content/`). Document extension messaging contracts alongside their helpers.

## Testing Guidelines
- Rely on `bun run check` plus targeted browser automation (Playwright or WebDriver) when touching interaction logic. Strive for regression coverage on highlighting heuristics and keep backend-facing mocks deterministic.
- When modifying LLM/highlighting heuristics, log expected entropy thresholds and confirm ordering manually or through scripted fixtures under `src/lib/tests` (or similar) to prevent regressions.

## Commit & Pull Request Guidelines
- Existing history favors short, imperative subject lines (e.g., `format extension directory`). Follow that tone, wrap at 72 chars, and separate logical changes.
- Each PR should describe motivation, list testing commands executed, and reference any tracked issue. Include before/after screenshots for UI tweaks or new highlights, and mention GPU/LLM configuration changes explicitly.

## Security & Configuration Tips
- Do not hardcode API keys; rely on environment variables or `.env` files excluded from git. The Fireworks token should only be read inside background scripts and proxied to content scripts through message passing when necessary.
- When sharing logs, redact prompts that might contain user data, and take care not to leak Fireworks responses in screenshots or console captures destined for issues.
