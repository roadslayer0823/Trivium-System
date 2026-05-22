# MAGI | TRIVIUM SYSTEM

<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

## Project Overview

The **Magi Trivium System** is a mobile-first AI teaching assistant and reasoning evaluation pipeline (the "Trivium" system). The application runs entirely on-device, leveraging a locally downloaded **Gemma-4 E2B** Small Language Model (SLM) via LiteRT/MediaPipe inference.

This project is built using a modern **React 19** stack and deployed natively to iOS via **Capacitor**. It features real-time model downloading directly from Hugging Face, extensive device capability checks (storage, network, hardware compatibility), and robust multi-perspective inference streaming—all without requiring any cloud API keys.

---

## Folder Structure

A high-level overview of the root directory and key files:

```text
├── src/                          # React Frontend Source Code
│   ├── App.tsx                   # Main Application UI & Inference Pipeline Logic
│   ├── DownloadConfirmation.tsx  # Modal checking network, storage, & compatibility before downloading model
│   ├── native-llm.ts             # Capacitor Plugin wrapper for MagiNativeLLM (handles device & inference)
│   ├── index.css                 # Tailwind utility injections and custom styling
│   └── main.tsx                  # React Entry Point
│
├── ios/                          # Capacitor native iOS project files (Xcode)
├── assets/                       # Static Application Assets
├── dist/                         # Vite build output directory
├── _archive_prototype/           # Legacy AI Studio boilerplate backup / previous sub-project
│
├── capacitor.config.ts           # App ID (hk.com.eti.magi) & Web directory configuration
├── index.html                    # Root HTML file with iOS meta tags configuration
├── vite.config.ts                # Vite Development & Build configuration
├── tsconfig.json                 # TypeScript compiler options
└── package.json                  # NPM dependencies and scripts
```

---

## Core Components

### 1. `MagiNativeLLM` Plugin (`native-llm.ts`)
The application relies heavily on a custom native bridge plugin built for Capacitor. This plugin manages the lifecycle of the local SLM:
- **Initialization**: Automatically pulls the `gemma-4-E2B-it.litertlm` (or `.gguf` fallback) from Hugging Face.
- **Hardware Checks**: Includes methods to verify `getFreeDiskSpace()`, `checkDeviceCompatibility()`, and `Network.getStatus()`.
- **Streaming Response**: Listens for token-by-token generation via `onTokenGenerated` to populate the Trivium multi-persona reasoning.

### 2. The Download Pipeline (`DownloadConfirmation.tsx`)
Before running any inference, the application ensures the device can handle it. This component:
- Validates the network connection.
- Verifies the iOS device hardware compatibility.
- Ensures the user has enough gigabytes of free storage space for the model file.
- Downloads the model package (`.litertlm`) for permanent offline storage.

### 3. The Trivium System (`App.tsx`)
The core UI orchestrates the "Trivium" logic—evaluating a query from multiple AI personas (e.g., YES/NO votes, confidence scores, and respective reasonings). The parsing logic is strictly designed to handle structured outputs, mitigate hallucinations, and ensure consistent behavior across different languages (including Hong Kong Traditional Chinese).

---

## Setup & Installation

**Prerequisites:**
- Node.js (v18+)
- Xcode (for iOS native deployment)
- CocoaPods

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Run Local Development Web Server:**
   ```bash
   npm run dev
   ```
   *Note: Native LLM functionalities (like local downloading and native inference) will not work properly in a standard web browser and require the Capacitor environment.*

3. **On-Device Model Setup:**
   The application will automatically prompt you to download the **Gemma-4 E2B** model (`.litertlm` or `.gguf`) directly from Hugging Face on its first run within the native iOS container. All inference logic runs entirely locally on your device, meaning **no cloud API keys are required**.

---

## iOS Native Build Instructions

To build and run the native iOS application:

1. **Build the Web Assets:**
   ```bash
   npm run build
   ```

2. **Sync with Capacitor:**
   ```bash
   npx cap sync ios
   ```

3. **Open Xcode:**
   ```bash
   npx cap open ios
   ```
   *Note: System zoom functionality has been disabled via `index.html` meta tags (`user-scalable=no`) and native project settings are configured for production readiness on mobile.*

---

## Maintenance & Commands

To clear the Vite build artifacts:
```bash
npm run clean
```

To run TypeScript type-checking:
```bash
npm run lint
```
