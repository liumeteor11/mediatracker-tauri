# MediaTracker AI

[English](README.md) | [中文](README.zh.md)

A cross-platform desktop application to search, collect, and track your media journey (Movies, TV Series, Books, Comics, Short Dramas, Music). 

Built with **React + Vite** (Frontend) and **Tauri/Rust** (Backend). 

Designed for speed, privacy, and an excellent user experience.

## ✨ Key Features

### 🔍 AI-Powered Search & Discovery
- **Smart Search**: Find movies, books, and more using natural language queries (e.g., "Cyberpunk novels from the 90s").
- **Trending Recommendations**: Get personalized "Hot Recommendations" based on current trends, with auto-refresh logic that avoids repeating recently seen items.
- **Fast First-Screen**: Instant results return from AI context, followed by asynchronous metadata enrichment.

### 📚 Comprehensive Collection Management
- **Multi-Type Support**: Manage Movies, TV Series, Books, Comics, Short Dramas, and Music albums in one place.
- **Status Tracking**: Organize items into "To Watch", "Watched", and "Favorites".
- **Ongoing Updates**: Track ongoing series (TV shows, comics) with automatic update checks for new episodes/chapters.

### 🛠️ Advanced Editing & Customization
- **Manual Entry**: Create custom media cards directly without searching.
- **Metadata Editing**: Full control over title, director, description, release date, and cast.
- **Custom Posters**: Upload your own cover images or let the app auto-fetch high-quality posters from the web.

### 📊 Insights & Analytics
- **Yearly Report**: Visualize your activity with annual statistics, including total items added, most active month, and favorite categories.
- **Search Diagnostics**: View detailed logs of AI interactions and search provider performance (Token usage, latency, API calls).

## 🚀 Technical Highlights

- **Privacy First**: API Keys (OpenAI, Google, etc.) are stored locally using **AES encryption**. No data is sent to our servers.
- **Offline Friendly**: Works gracefully with intermittent internet; caches metadata locally for instant loading.
- **Async Hydration**: Posters and detailed info are fetched in the background to keep the UI responsive.
- **Internationalization**: Full support for English and Chinese (Simplified), with auto-detection.

## 🛠️ Quick Start

### Prerequisites
- Node.js (v18+)
- Rust (latest stable)

### Development
1. **Install dependencies**:
   ```bash
   npm install
   ```
2. **Run desktop app**:
   ```bash
   npm run tauri dev
   ```
3. **Run web-only mode**:
   ```bash
   npm run dev
   ```

### Build
To build the application for your OS:
```bash
npm run tauri build
```

## 📦 GitHub Actions Release
Push a tag starting with `v` (e.g., `v0.1.0`) to automatically trigger the build workflow. It will generate installers for Windows, macOS, and Linux and publish them to GitHub Releases.

## 🔒 Privacy & Security
- **Local Storage**: All collection data is stored locally on your device.
- **Encrypted Keys**: Sensitive API keys are encrypted before storage.
- **No Tracking**: We do not track your search history or collection data.

## 📄 License
This project is for personal learning and usage. Please add an appropriate license if you plan to distribute it publicly.
