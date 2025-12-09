# MediaTracker AI

[English](README.md) | [中文](README.zh.md)

Cross‑platform desktop app to search, collect and track media (movies, TV, books, comics, short dramas, music). Frontend: React + Vite. Backend: Tauri (Rust). Fast first-screen results, async poster hydration, local cache, i18n, and privacy by default.

## Features
- AI search and trending with first-screen return
- Async poster hydration; 2‑hour local cache
- Offline‑friendly: return from context, verify async
- Collections (Favorites / To Watch / Watched) & ongoing tracking
- Image loading/failed states (i18n)
- AES‑encrypted local storage for API keys

## Quick Start
- Dev (desktop): `npm run tauri dev`
- Dev (web only): `npm run dev`
- Build (desktop): `npm run tauri build`

## GitHub Actions Release
- Push a tag `vX.Y.Z` or run the workflow manually to build Windows executable and publish a GitHub Release with artifacts.

## Privacy
- API keys stay local (AES encrypted)
- `.env` is ignored by Git, no secrets committed

## License
For personal and learning use. Add your preferred license before public distribution.
