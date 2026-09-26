# Repository Guidelines

MediaTracker is a cross-platform desktop app for searching and tracking media. The frontend is React + TypeScript + Vite with Tailwind CSS; the backend is a Tauri (Rust) shell that also supports Android.

## Project Structure

- `src/` - React frontend: `pages/`, `components/`, `services/` (TMDb, Bangumi, AI), `store/` (Zustand), `types/`, `locales/` (i18n JSON).
- `src-tauri/` - Rust backend: `src/` (`models.rs`, `database.rs`, `sync.rs`, etc.) and `tests.rs` for unit tests; `icons/` and `gen/` hold app assets and generated schemas.
- `public/` - static assets; `dist/` - Vite build output.
- `.github/workflows/release.yml` - CI/CD for desktop and Android releases.

## Build, Test, and Development Commands

- `npm install` - install frontend and Tauri CLI dependencies.
- `npm run dev` - run the web-only dev server (Vite).
- `npm run tauri dev` - run the desktop app in development.
- `npm run build` - type-check (`tsc`) and bundle with Vite.
- `npm run tauri build` - compile the Rust backend and produce installers.
- `cargo test` (in `src-tauri/`) - run Rust unit tests.

## Coding Style & Naming Conventions

- TypeScript/React: 2-space indentation, single quotes, PascalCase component files, camelCase functions.
- State stores follow `useXStore.ts` (e.g., `useCollectionStore.ts`); services are `*.ts` files named by domain (`tmdbService.ts`).
- Use TypeScript types in `src/types/`; prefer functional components with hooks.
- Rust: follow `rustfmt` defaults and `cargo clippy`; keep database and sync logic out of the UI.
- UI: use Tailwind utility classes and existing `i18n.ts` translation keys rather than hard-coded strings.

## Testing Guidelines

- Rust unit tests live in `src-tauri/src/tests.rs`, named `test_<unit_under_test>` (e.g., `test_media_item_serialization`); run via `cargo test` in `src-tauri/`.
- There is no frontend test framework yet; `npm run build` serves as the type gate. If you add tests, keep them colocated and runnable via one command.

## Commit & Pull Request Guidelines

Git history uses Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `ci:`), optionally scoped like `fix(android):`. Release commits bump the version (`chore: bump version to v0.1.x`).

PRs should describe what changed and why, reference the linked issue, and include screenshots for UI changes. Keep changes focused; version bumps belong in the release commit, not a separate PR.

## Security & Configuration

- API keys (OpenAI, Google, etc.) are AES-encrypted before local storage; never commit real keys or secrets.
- Releases trigger on a `v*` tag (e.g., `v0.1.16`); the workflow builds Windows, macOS, Linux, and Android artifacts and publishes a draft release.
