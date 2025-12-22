# MediaTracker Companion App Guide

## Overview

The MediaTracker ecosystem is designed to be cross-platform. While the current implementation is a Tauri-based desktop application (Windows/macOS/Linux), the architecture is ready for mobile adaptation.

## Mobile App Strategy

### Option 1: Tauri Mobile (Recommended)

Tauri v2 supports iOS and Android targets. This allows reusing the majority of the existing React codebase.

#### Prerequisites
- Rust installed
- Android Studio (for Android)
- Xcode (for iOS, requires macOS)

#### Steps to Migrate
1. **Initialize Mobile Project**:
   Run the following command in the project root:
   ```bash
   npm run tauri android init
   # or
   npm run tauri ios init
   ```

2. **UI Adaptation**:
   - The current UI uses Tailwind CSS, which is responsive by default.
   - Verify that `src/components/MediaCard.tsx` and `src/pages/DashboardPage.tsx` render correctly on smaller screens.
   - Adjust `AIConfigPanel.tsx` to stack columns on mobile (already using `md:grid-cols-2`).

3. **Touch Interactions**:
   - Ensure buttons are large enough for touch targets.
   - Swiping gestures can be added using libraries like `react-use-gesture`.

4. **Data Sync**:
   - Currently, data is stored in `localStorage` (browser/webview storage).
   - For a robust mobile experience, consider syncing data via a cloud service (e.g., Supabase, Firebase) or using a file-based sync (e.g., exporting JSON to iCloud/Google Drive).
   - *Note*: The current `importService.ts` allows importing/exporting data, which can serve as a manual sync mechanism.

### Option 2: React Native / Expo Companion

If a native feel is preferred, a separate React Native app can be built.

- **Shared Logic**: Extract `src/types`, `src/services` (excluding Tauri-specific code), and `src/store` into a shared package or monorepo.
- **UI**: Re-implement components using React Native primitives (`View`, `Text`, `Image`).

## Features Roadmap for Mobile

1. **Scan to Add**: Use the phone camera to scan ISBN barcodes (books) or search by voice.
2. **Push Notifications**: Notify users when a new episode is aired (requires backend server or local notifications).
3. **Offline Mode**: Cache images and data for offline access.

## Current Readiness

- **Responsive Design**: The web interface is built with mobile-first CSS classes (`md:`, `lg:` breakpoints).
- **Touch-Friendly**: Buttons and inputs are standard HTML elements that work on touch screens.
- **Performance**: The app is lightweight, making it suitable for mobile devices.
