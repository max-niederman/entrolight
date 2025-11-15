# Repository Guidelines

## Project Structure & Module Organization
- `backend/` hosts the FastAPI + vLLM service. Source lives under `backend/src/entrolight_backend`, and packaging is managed by `pyproject.toml`, `uv.lock`, and `default.nix`.
- `extension/` contains the WXT/Svelte browser extension. UI code resides in `extension/src`, static assets in `extension/public`, and bundler settings in `wxt.config.ts`.
- Top-level `flake.nix` provides reproducible tooling; use it (or `uv`) so CUDA and Python dependencies match the production image.

## Build, Test, and Development Commands
- Install frontend deps with `cd extension && bun install`. Run a live-reload build via `bun run dev` (Chrome) or `bun run dev:firefox`.
- Produce a signed bundle using `bun run build` and (optionally) `bun run zip`. Keep artifacts out of version control.
- For the backend, sync dependencies with `cd backend && uv sync`. Start the API locally using `uv run fastapi dev entrolight_backend:app --reload`.
- Run backend unit tests with `uv run pytest`. Use `nix build .#backend` when validating the deployment derivation.

## Coding Style & Naming Conventions
- Python: 4-space indentation, type-hinted endpoints, and Pydantic models with explicit field types. Favor `snake_case` for functions and modules, `PascalCase` for data models, and ensure FastAPI routes stay in `entrolight_backend`.
- Svelte/TypeScript: keep `<script lang="ts">` blocks typed, prefer `camelCase` for variables, and colocate component-specific styles. Run `bun run check` before opening a PR.

## Testing Guidelines
- Add `pytest` suites under `backend/tests` mirroring the module structure (e.g., `tests/test_inference.py`). Mock vLLM calls; assert logprob ordering and schema validation.
- For the extension, rely on `bun run check` plus targeted browser automation (Playwright or WebDriver) when touching interaction logic. Strive for regression coverage on highlighting heuristics and keep backend-facing mocks deterministic.

## Commit & Pull Request Guidelines
- Existing history favors short, imperative subject lines (e.g., `format extension directory`). Follow that tone, wrap at 72 chars, and separate logical changes.
- Each PR should describe motivation, list testing commands executed, and reference any tracked issue. Include before/after screenshots for UI tweaks or new highlights, and mention GPU/LLM configuration changes explicitly.

## Security & Configuration Tips
- Do not hardcode API keys or CUDA paths; rely on environment variables or `.env` files excluded from git.
- When sharing logs, redact prompts that might contain user data, and ensure CUDA workloads respect the configured memory limit (`gpu_memory_utilization` in `_get_llm`).
