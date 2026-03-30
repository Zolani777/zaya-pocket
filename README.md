# Zaya Pocket

Zaya Pocket is a local-first PWA built to put an offline-capable AI chat on a phone. The core text chat path is designed around WebLLM running in a dedicated Web Worker, IndexedDB for local conversation storage, and a PWA shell for installability and offline caching.

## What ships in this phase

- mobile-first React + TypeScript app
- installable PWA with custom icons from the provided Zaya swirl mark
- dedicated Web Worker for local WebLLM inference
- IndexedDB storage for conversations and settings
- local model boot flow with progress bar
- offline/online status, Home Screen install UX, model cache removal
- strong default UI for iPhone-sized screens

## Core product lane

- **v1 model:** `Llama-3.2-1B-Instruct-q4f16_1-MLC`
- **upgrade tier:** `Llama-3.2-3B-Instruct-q4f16_1-MLC`
- **default promise:** after first successful model download, Zaya Pocket is designed to open and chat locally with no backend dependency for core text chat.

## Commands

```bash
npm install
npm run dev
npm run build
npm run preview
```

## Important reality check

This repo is intentionally local-first, not native iOS. It does not try to become a system-wide assistant or a background daemon. It is a Home Screen web app with a local model path.

## Deployment notes

Serve this over HTTPS for installability on iPhone. Once installed and the model is cached, the app shell and local chat history stay on-device.

## Folder structure

```text
public/
  icons/
  offline.html
src/
  components/
  config/
  constants/
  hooks/
  lib/
  services/
  types/
  workers/
  App.tsx
  main.tsx
  sw.ts
```

## Next build lane

- add conversation export/import
- add compact settings sheet for temperature and response mode
- add local memory summarization
- add optional cloud sync later without breaking local-first mode
