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
