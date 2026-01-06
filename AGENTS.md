# Repository Guidelines

## Project Structure & Module Organization

This is a pnpm monorepo. Key locations:

- `apps/web`: main web editor + browser extension assets.
- `apps/vscode`: VS Code extension.
- `apps/utools`: uTools plugin packaging.
- `packages/core`: Markdown rendering engine.
- `packages/shared`: shared configs, constants, and editor setup.
- `packages/md-cli`: local CLI server and upload proxy.
- `public` and `apps/web/src/assets`: static assets.

## Build, Test, and Development Commands

Use Node.js >= 22 and pnpm >= 10.

```bash
pnpm install            # install workspace deps
pnpm web dev            # start web editor (http://localhost:5173/md/)
pnpm web build          # build web app for /md
pnpm web build:h5-netlify  # build for root deployment
pnpm run lint           # ESLint + Prettier checks (fixes)
pnpm run type-check     # TypeScript type checks
```

For extension debugging: `pnpm web ext:dev` (Chrome) or `pnpm web firefox:dev`.

## Coding Style & Naming Conventions

Follow existing formatting and lint rules. Tooling: ESLint, Prettier, and Stylelint (per `CONTRIBUTING.md`). Prefer 2‑space indentation as used in existing TS/Vue files. Keep module names aligned with the monorepo layout (`apps/*`, `packages/*`). Avoid introducing new global conventions without discussion.

## Testing Guidelines

There is no dedicated test runner in the root scripts. Validate changes with:

- `pnpm run lint`
- `pnpm run type-check`
- `pnpm web build` for production output
  Manual verification in the editor UI is expected for user‑facing changes.

## Commit & Pull Request Guidelines

Commit types follow Conventional Commits: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `chore`. Branches use `feat/*`, `fix/*`, `docs/*`. PR titles should match the first commit and may include scope, e.g. `feat(editor): add shortcut`. Keep PRs focused, include rationale, and update docs when behavior changes. Ensure lint/type-check/build pass.

## Configuration & Secrets

Use `apps/web/.env.local` for local settings (e.g., `VITE_LAUNCH_EDITOR`). Never commit secrets or tokens.
