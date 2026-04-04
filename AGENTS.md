# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the Vite + React client. Keep UI code under `src/components/`, shared hooks in `src/hooks/`, state in `src/stores/`, and reusable helpers in `src/lib/`, `src/utils/`, and `src/types/`. Localization files live in `src/i18n/`.

`server/` contains the Node/Express backend, split by `routes/`, `services/`, `middleware/`, `database/`, and provider adapters in `server/providers/{claude,codex,cursor,gemini}`. Shared constants belong in `shared/`. Static assets ship from `public/`; production output is generated into `dist/`. Utility scripts live in `scripts/`, and plugin examples live in `plugins/starter/`.

## Build, Test, and Development Commands
- `npm run dev`: restart-aware local development entrypoint.
- `npm run dev:raw`: run backend and Vite dev server side by side.
- `npm run server`: start only the Express server.
- `npm run client`: start only the Vite frontend.
- `npm run build`: create the production bundle in `dist/`.
- `npm run preview`: preview the built frontend locally.
- `npm run typecheck`: run TypeScript checks with no emit.
- `npm run lint` / `npm run lint:fix`: lint `src/` and optionally auto-fix issues.

## Coding Style & Naming Conventions
Use 2-space indentation and ES module syntax. Prefer TypeScript and `.tsx` for React views. Name React components and stores in `PascalCase`, hooks as `useSomething`, utilities in `camelCase`, and keep provider-specific logic inside `server/providers/*`.

ESLint is the primary style gate (`eslint.config.js`). It enforces React hooks rules, import ordering, unused import cleanup, and Tailwind class hygiene. Follow the existing import grouping and avoid dead exports.

## Testing Guidelines
There is no dedicated automated test suite configured yet. Before opening a PR, run `npm run typecheck` and `npm run lint`, then smoke-test the affected flow with `npm run dev` or `npm run preview`. If you add tests later, colocate them near the feature and use `*.test.ts` or `*.test.tsx`.

## Commit & Pull Request Guidelines
Commits follow Conventional Commits, e.g. `feat: add workflow session handling` or `fix: support subpath routing`. Husky runs `lint-staged` on pre-commit and `commitlint` on commit messages, so keep messages short, typed, and imperative.

PRs should explain user-visible impact, note config or migration changes, and link the related issue when applicable. Include screenshots for UI changes and the exact verification commands you ran.

## Security & Configuration Tips
Do not commit secrets, local database files, or generated `dist/` output. Treat changes to CLI permissions, provider integration, auth, and files under `server/database/` or `server/providers/` as high-risk and document them clearly in the PR.
