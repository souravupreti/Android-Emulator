# Real-Time Android Device in the Browser

## Overview

A web-based platform that streams a live Android emulator screen into the browser via WebRTC and allows real-time interactive control (tap, swipe, scroll, text, and keyboard input) through ADB.

## Current Features

- live Android screen streaming
- WebRTC video
- WebSocket signaling
- tap
- swipe
- scroll through swipe
- text input
- keyboard input
- dynamic Android coordinate mapping
- latency measurement page

## Architecture

The system connects the browser and an Android emulator via a Node.js backend:
- **Signaling & Input**: Browser communicates with the backend over WebSockets. User gestures and keystrokes are dynamically translated to emulator screen coordinates and executed via ADB.
- **Media Streaming**: Android screen frames are captured via `adb screenrecord`, transcoded to raw I420 frames using FFmpeg, and streamed to the browser via WebRTC (`@roamhq/wrtc`).

For detailed architectural flow diagrams, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Local Setup

### Prerequisites
- **Android Studio / Android Emulator** installed and running
- **ADB** (Android Debug Bridge) installed and accessible in `PATH`
- **FFmpeg** installed and accessible in `PATH`
- **Node.js** (v18+ recommended)

### Installation & Run

1. Verify emulator is detected by ADB:
   ```bash
   adb devices
   ```

2. Install backend dependencies:
   ```bash
   cd backend
   npm install
   ```

3. Start the backend:
   ```bash
   npm start
   ```
   *(or `node src/server.js`)*

4. Open the browser:
   - Device stream: [http://localhost:3000](http://localhost:3000)
   - Latency test: [http://localhost:3000/latency.html](http://localhost:3000/latency.html)

## Current Limitations

- Video latency still needs optimization.
- Deployment has not yet been completed.

## Deployment

*Deployment configurations and containerization will be added in a future phase.*

## AI Usage

AI was used as a development assistant during the project development and restructuring. A detailed audit trail of changes is maintained in [PROCESS_LOG.md](PROCESS_LOG.md).
