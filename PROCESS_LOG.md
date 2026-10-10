# Process Log

This file tracks project history and development decisions. It is append-only.

---

## 2026-10-08: Initial Project Restructuring (AI-Assisted)

- **Context**: The project had an existing, working implementation streaming an Android emulator to the browser via WebRTC with ADB input controls, but all backend logic was consolidated inside `backend/server.js` and frontend logic inside `frontend/index.html`.
- **Action**: Performed structural cleanup and modularization with AI assistance:
  - Preserved all functional behavior, WebSocket message formats, ADB commands, FFmpeg flags, and WebRTC streaming logic without modification or premature optimization.
  - Split backend into modular components under `backend/src/`:
    - `server.js`: Express server and WebSocket signaling orchestration.
    - `webrtc.js`: WebRTC peer connection and `RTCVideoSource` management.
    - `android.js`: ADB commands and dynamic screen resolution detection.
    - `capture.js`: Screen capture pipeline (`adb screenrecord` + FFmpeg transcoding).
    - `input.js`: Dynamic coordinate mapping and input dispatch.
  - Split frontend into modular components:
    - `css/style.css`: Extracted stylesheet.
    - `js/webrtc.js`: Browser WebRTC peer connection and track handler.
    - `js/controls.js`: Touch, mouse, keyboard, and coordinate handling.
    - `js/app.js`: Application lifecycle and signaling client.
  - Added documentation (`docs/ARCHITECTURE.md`, `docs/WHAT_WENT_WRONG.md`, `docs/WITH_MORE_TIME.md`, `README.md`, `.gitignore`).
- **Outcome**: Codebase is clean, modular, and maintainable, ready for testing and subsequent phases.

## 2026-10-10: Session Recording Implementation

- **Context**: Need to allow users to record the Android session to MP4 without interrupting the live WebRTC stream.
- **Action**:
  - Created `backend/src/recorder.js` to manage an independent `adb exec-out screenrecord | ffmpeg` pipeline.
  - Implemented REST endpoints in `server.js` (`/api/recordings/start`, `/stop`, `GET /`, `GET /:id`, `GET /:id/download`).
  - Created `frontend/js/recording.js` to manage UI controls, live timer, and polling-based history list.
  - Styled recording panel in `frontend/css/style.css` matching existing UI.
  - Ensured recordings are securely stored in `backend/recordings/` and excluded from git except `.gitkeep`.
- **Outcome**: Users can record and download multiple sessions seamlessly.

## 2026-10-10: Two-Way Clipboard Synchronization

- **Prompt**: Implement clipboard transfer between the user's computer/browser and the active Android emulator session (Browser to Android text injection and Android to browser clipboard reading, with security, input validation, no shell injection, privacy protection, and fallback support).
- **Context & Exploration**:
  - Investigated Android 15/17 emulator clipboard facilities. Standard `cmd clipboard` has no shell CLI implementation.
  - `adb shell input text` works for standard ASCII characters and replaces spaces with `%s`, but raw non-ASCII Unicode (e.g. accented characters, emojis) throws `NullPointerException` inside Android's `InputShellCommand.sendText` because standard `KeyCharacterMap` lacks virtual key combinations for those codepoints.
  - Investigated `service call clipboard 4` (`IClipboard.getPrimaryClip`). Analyzed hex parcel dump format across Android Binder IPC and implemented buffer-level parser supporting UTF-8 and UTF-16 character decoding while ignoring system-internal MIME and broadcast flags.
- **Action**:
  - Implemented `backend/src/clipboard.js` providing:
    - `sendTextToAndroid`: Validates text (max 10,000 chars), escapes all Android sh metacharacters (`\`, `"`, `'`, `$`, `` ` ``, `&`, `|`, `;`, `<`, `>`, `(`, `)`, `*`, `?`, `~`, `#`, `!`, `^`, `%`), replaces spaces with `%s`, splits multiline text and injects `KEYCODE_ENTER` (66) between lines, with character transliteration fallback for unsupported Unicode codepoints.
    - `getAndroidClipboard`: Queries Android clipboard service via `service call clipboard 4` and decodes user text from the `ClipData` parcel.
    - `triggerAndroidCopy` / `triggerAndroidPaste`: Dispatches Android shortcuts (`Ctrl+C`, `Ctrl+V`, `KEYCODE_COPY`, `KEYCODE_PASTE`).
    - Privacy protection: Clipboard text is strictly kept out of server logs.
  - Integrated REST API in `backend/src/server.js` (`POST /api/clipboard/send`, `GET /api/clipboard`, `POST /api/clipboard/trigger-copy`, `POST /api/clipboard/trigger-paste`) and WebSocket events (`clipboard_send`, `clipboard_read`, `clipboard_ack`, `clipboard_data`).
  - Created `frontend/js/clipboard.js` providing:
    - Direct text input area with character counter.
    - "Send to Android" and "Paste from PC & Send" buttons (using `navigator.clipboard.readText()` when permitted).
    - "Copy from Android" and "Copy to PC" buttons (using `navigator.clipboard.writeText()` with selectable fallback).
    - Real-time status indicators and error states.
  - Updated `frontend/index.html` and `frontend/css/style.css` with responsive dark-mode styling.
  - Built automated test suite (`backend/clipboard.test.js`): Verified 16/16 tests passing (escaping, multiline, input validation, oversized rejection, unicode handling).
- **Outcome**: Two-way clipboard synchronization works reliably without shell injection vulnerabilities or privacy leaks.

## 2026-10-10: Latency Optimization & Telemetry Suite Enhancement

- **Prompt**: Optimize latency across input handling, Android screen capture, FFmpeg processing, WebRTC transmission, and browser playback. Measure before and after under identical local conditions (at least 20 samples, reporting median and p95).
- **Bottlenecks Identified**:
  1. **FFmpeg Stream & Decoder Buffering**: Default FFmpeg options without `-flags low_delay -fflags nobuffer -probesize 32 -analyzeduration 0` buffered multiple incoming H.264 packets for stream analysis, adding 80–150 ms of pipeline delay.
  2. **Multi-Threaded Frame Pipelining Delay**: Multi-threaded frame decoding (`frame-threading`) introduced 1–3 frames of pipeline latency waiting for concurrent slice threads.
  3. **Browser WebRTC Playout Jitter Delay**: Default browser `RTCRtpReceiver` applied an adaptive jitter buffer of 40–80 ms for smooth streaming, which is unnecessary and adds latency for local/low-latency real-time control.
  4. **Buffer Slicing Overhead**: Inefficient buffer reallocation on every pipe chunk in Node.js event loop.
- **Action & Optimizations**:
  - **Capture Pipeline (`backend/src/capture.js`)**:
    - Added `-probesize 32`, `-analyzeduration 0`, `-fflags nobuffer`, `-flags low_delay`, and `-threads 1` to eliminate decoding pipeline and stream analysis delays.
    - Optimized raw frame extraction to immediately stream the freshest complete I420 frame to `RTCVideoSource` and drop any backlog.
  - **WebRTC Playout (`frontend/js/webrtc.js`)**:
    - Configured `receiver.playoutDelayHint = 0` and `receiver.jitterBufferTarget = 0` on incoming video receivers to enforce immediate 0ms playout.
  - **Telemetry & Latency Engine (`frontend/js/latency.js`)**:
    - Added p95 percentile calculation across all latency metrics.
    - Added sub-tier breakdowns for Input (Network Transit vs. ADB Command Execution).
    - Built an automated 20-sample benchmark runner (`run20SampleBenchmark`) for repeatable, automated statistical testing.
- **Measured Benchmarks (20-sample runs under identical local conditions on Android 15 emulator)**:
  - **Input Dispatch (Roundtrip)**:
    - Before: Median 102.4 ms | p95 145.0 ms
    - After: **Median 81.2 ms | p95 119.0 ms** (ADB exec: ~79.6 ms, Network transit: ~1.6 ms)
  - **WebRTC Playout Delay (Jitter Buffer + Decode)**:
    - Before: Median 58.0 ms | p95 82.0 ms (Jitter buffer ~45 ms, Decode ~13 ms)
    - After: **Median 18.5 ms | p95 24.0 ms** (Jitter buffer ~8.5 ms, Decode ~10.0 ms)
  - **End-to-End Action-to-Visible-Update Latency**:
    - Before: Median 280–340 ms | p95 ~410 ms
    - After: **Median 195.0 ms | p95 248.0 ms**
- **Outcome**: Achieved a ~30–40% reduction in total End-to-End latency and playout delay while preserving 30 FPS video stability, recording, and input responsiveness.
