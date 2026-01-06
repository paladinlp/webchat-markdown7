# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WeChat Markdown Editor (微信 Markdown 编辑器) - A lightweight editor that renders Markdown to WeChat-compatible HTML. Supports multiple distribution targets: web app, Chrome/Firefox extensions, VS Code extension, CLI tool, and uTools plugin.

## Build & Development Commands

**Prerequisites:** Node.js >= 22.16.0, pnpm >= 10

```bash
# Install dependencies
pnpm install

# Development
pnpm web dev                    # Start web editor at http://localhost:5173/md/

# Build
pnpm web build                  # Build for /md path deployment
pnpm web build:h5-netlify       # Build for root path deployment

# Code quality
pnpm lint                       # ESLint + Prettier (auto-fix)
pnpm type-check                 # TypeScript type checking

# Browser extensions
pnpm web ext:dev                # Chrome extension dev mode
pnpm web ext:zip                # Package Chrome extension
pnpm web firefox:dev            # Firefox extension dev mode
pnpm web firefox:zip            # Package Firefox extension

# Other targets
pnpm web wrangler:dev           # Cloudflare Workers dev mode
pnpm web wrangler:deploy        # Deploy to Cloudflare Workers
pnpm utools:package             # Package uTools plugin
pnpm build:cli                  # Build CLI package
```

## Architecture

**Monorepo structure (pnpm workspaces):**

- `apps/web` - Main Vue 3 web editor + browser extensions (WXT framework)
- `apps/vscode` - VS Code extension
- `apps/utools` - uTools plugin packaging
- `packages/core` - Markdown rendering engine (marked, mermaid, highlight.js)
- `packages/shared` - Shared configs, constants, types, and CodeMirror editor setup
- `packages/config` - Base TypeScript configurations
- `packages/md-cli` - CLI tool with Express server for local hosting

**Key technologies:**

- Vue 3 + Pinia (state management)
- Vite 7 (bundler)
- CodeMirror 6 (editor)
- Tailwind CSS 4
- WXT (browser extension framework)

**Entry points:**

- `apps/web/src/views/CodemirrorEditor.vue` - Main editor component
- `apps/web/src/entrypoints/` - Browser extension entry points
- `apps/web/src/stores/` - Pinia state stores
- `packages/core/src/renderer/` - Markdown to HTML rendering

## Validation

No test runner. Validate changes with:

```bash
pnpm lint
pnpm type-check
pnpm web build
```

Manual verification in the editor UI is expected for user-facing changes.

## Commit Conventions

Branch naming: `feat/*`, `fix/*`, `docs/*`

Commit types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `chore`

PR titles should match the first commit with optional scope: `feat(editor): add shortcut`

## Configuration

Local dev settings: `apps/web/.env.local` (e.g., `VITE_LAUNCH_EDITOR=cursor`)

## AI Image Generation (Gemini + Ali OSS)

**Backend service (md-cli):**

```bash
cd packages/md-cli
node index.js                    # Start on port 8800
# Or with environment variables:
GEMINI_API_KEY=xxx node index.js
```

**Key files:**

- `packages/md-cli/server.js` - Express backend with Gemini proxy and OSS upload
- `apps/web/src/components/ai/image-generator/AIImageGeneratorPanel.vue` - AI image UI
- `apps/web/src/stores/geminiImageConfig.ts` - Gemini config store (endpoint, model, apiKey)

**API endpoints:**

- `POST /images/generations` - Gemini image generation (OpenAI-compatible format)
- `GET /ai/images` - List history dates
- `GET /ai/images?date=YYYY-MM-DD` - Get images for a specific date

**Configuration:**

- Gemini API Key: via `GEMINI_API_KEY` env var or frontend `x-goog-api-key` header
- Ali OSS: configured in frontend upload settings, passed as `ossConfig` in request body
- Default model: `gemini-3-pro-image-preview`
- Image history stored in: `packages/md-cli/data/ai-images/YYYY-MM-DD.jsonl`

**Response parsing:**
The `extractInlineImageData()` function supports both snake_case (`inline_data`, `mime_type`) and camelCase (`inlineData`, `mimeType`) field names from Gemini API responses.
