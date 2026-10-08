# System Architecture

## Overview

The application provides real-time streaming and interaction with an Android Emulator directly from a web browser using WebRTC and WebSockets.

---

## Data & Control Flow

### 1. Control & Input Pipeline (Browser to Device)

User interactions (tap, swipe, text, key events) are captured in the browser, mapped to the emulator's coordinate space, and dispatched to Android via ADB:

```
Browser
  ↓ (WebSocket JSON events: tap, swipe, text, key)
Node.js Backend (src/server.js -> src/input.js)
  ↓ (Coordinate translation & ADB commands)
ADB (src/android.js)
  ↓ (adb shell input tap/swipe/text/keyevent)
Android Emulator
```

---

### 2. Video Capture & Streaming Pipeline (Device to Browser)

The Android emulator screen is captured in real-time, transcoded into raw video frames, injected into a WebRTC video source, and streamed to the client:

```
Android Emulator
  ↓ (adb exec-out screenrecord --output-format h264)
ADB screenrecord
  ↓ (H.264 video stream via stdout pipe)
FFmpeg
  ↓ (Raw I420 / yuv420p frames via stdout pipe)
RTCVideoSource (@roamhq/wrtc)
  ↓ (WebRTC MediaStream video track)
WebRTC
  ↓ (RTP video packets over peer connection)
Browser (<video> element)
```

---

## Component Responsibilities

- **Frontend (`frontend/`)**:
  - `index.html`: Main container rendering the emulator viewport.
  - `css/style.css`: Viewport styling and responsive layout.
  - `js/webrtc.js`: WebRTC peer connection, SDP negotiation, and media track playback.
  - `js/controls.js`: Captures mouse/touch pointer events and keyboard input; translates coordinates relative to video resolution.
  - `js/app.js`: Connects to WebSocket signaling and initializes modules.
  - `latency.html`: Standalone verification page for latency diagnostics.

- **Backend (`backend/src/`)**:
  - `server.js`: Express HTTP server and WebSocket signaling server.
  - `webrtc.js`: Node.js WebRTC peer connection and `RTCVideoSource` management using `@roamhq/wrtc`.
  - `capture.js`: Manages ADB screenrecord and FFmpeg transcoding pipeline.
  - `android.js`: Dynamic screen resolution query via `adb shell wm size` and ADB input execution.
  - `input.js`: Dynamic coordinate mapping between browser video dimensions and physical Android screen resolution.
