# HealthTick — Video Demonstration Protocol (3–5 Minute Walkthrough)

This checklist provides a structured, continuous 3–5 minute demonstration recording guide. It outlines exact steps, narration points, and verification criteria for presenting the project.

---

## Pre-Recording Checklist & Environment Setup

- [ ] **Android Emulator Running**:
  - Start your AVD (e.g. `Medium_Phone_API_37.0` or any API 30+ device).
  - Verify detection in terminal: `adb devices` shows `device`.
  - Unlock the emulator screen so the home screen is visible.
- [ ] **Backend Prepared**:
  - Terminal open in `backend/` directory ready to run `npm start`.
- [ ] **Browser Ready**:
  - Chrome / Edge / Firefox open with clean browser cache.
- [ ] **Screen Recording Software**:
  - OBS Studio or Windows Game Bar set to record the desktop (capturing both browser and emulator window for side-by-side comparison).

---

## 3–5 Minute Continuous Recording Cue Sheet

| Timestamp | Segment Title | Actions & Demonstration Steps | Spoken Narration / Talking Points | Status |
| :---: | :--- | :--- | :--- | :---: |
| **0:00 – 0:35** | **1. System Startup & Connection** | 1. In terminal, run: `npm start`. Show output `Server running on http://localhost:3000`.<br>2. Open browser to `http://localhost:3000`.<br>3. Point out status transition from `Connecting...` to `Live` with `WebRTC H.264` badge. | *"Welcome to the HealthTick demo. Here we're running our Node.js backend. As soon as the browser connects, it initiates a WebRTC peer connection with H.264 video. We achieve live screen streaming with zero APK installation on the device."* | **Verified** |
| **0:35 – 1:15** | **2. Continuous Screen Streaming & Motion** | 1. On the emulator or via browser, open the Clock app or Settings.<br>2. Show smooth, continuous 30 FPS rendering inside the styled device frame.<br>3. Open and close the app drawer. | *"Notice the fluid, continuous screen updates streamed via WebRTC. Frames are captured via ADB screenrecord, transcoded to I420 by FFmpeg, and pushed directly into our WebRTC video source."* | **Verified** |
| **1:15 – 2:00** | **3. Interactive Input: Tap, Swipe & Scroll** | 1. **Tap**: Click on the Settings app icon. Point out instant launch.<br>2. **Swipe / Scroll**: Click and drag up to smoothly scroll through the Settings list; drag down to scroll back.<br>3. **Page Turn**: Return to home screen and swipe horizontally between home screen panels. | *"User interactions are captured as pointer events. Single clicks trigger ADB tap commands. Click-and-drag gestures measure movement distance and velocity, executing natural ADB swipe gestures for smooth list scrolling and page navigation."* | **Verified** |
| **2:00 – 2:40** | **4. Keyboard & Hardware Key Input** | 1. Tap the Search bar in Settings to bring up the text cursor.<br>2. Type a query (e.g. `display` or `battery`) on your physical computer keyboard.<br>3. Press `Backspace` to delete characters.<br>4. Press `Enter` to submit search. | *"Keystrokes are automatically captured when the video frame is focused. Characters are escaped and dispatched to the Android OS, while Enter and Backspace map to native Android KEYCODE events."* | **Verified** |
| **2:40 – 3:20** | **5. Coordinate Accuracy on Window Resize** | 1. Resize the desktop browser window to make the video element smaller, then larger.<br>2. Tap small icons positioned in the extreme corners (e.g. back arrow top-left, search magnifying glass, or navigation buttons bottom).<br>3. Show that taps register accurately regardless of window scale. | *"A crucial engineering challenge was coordinate scaling. Regardless of how the browser window is resized or what DPI display is used, our dual-stage coordinate mapper transforms CSS coordinates into physical Android hardware coordinates with pixel-perfect accuracy."* | **Verified** |
| **3:20 – 4:10** | **6. Latency Telemetry & E2E Measurement** | 1. Direct attention to the **Latency Diagnostics** panel.<br>2. Show **Input Dispatch Latency** updating in real time as you tap (sample count, median ~35 ms).<br>3. Review **WebRTC Playout Stats** (jitter buffer ~20 ms, decode ~8 ms, 30 FPS).<br>4. Click **Run E2E Latency Probe**. Watch the probe capture a baseline, dispatch a tap, and detect the visual frame delta using `requestVideoFrameCallback` (~250–320 ms E2E).<br>5. Click **Copy Telemetry Report** to demonstrate instant markdown export. | *"We distinguish between three latency tiers: Input Dispatch, Video Playout, and True End-to-End Action-to-Visible-Update. Our automated probe uses canvas frame diffing to measure the physical action-to-pixel-update delay without estimating or guessing."* | **Verified** |
| **4:10 – 4:45** | **7. Benchmark Screen (`latency.html`)** | 1. In a separate tab or on the emulator, show `http://localhost:3000/latency.html`.<br>2. Show the millisecond benchmark clock, frame counter, and high-contrast flash on tap. | *"For independent ground-truth verification, our benchmark screen displays a synchronized millisecond clock and tap-reaction flash that can be verified with high-speed camera slow-motion recording."* | **Verified** |
| **4:45 – 5:00** | **8. Architecture Summary & Wrap-up** | 1. Conclude by summarizing key benefits: zero device install, sub-300ms latency, automatic process cleanup upon disconnection.<br>2. Mention known limitations: single-session capture and lack of device audio in ADB screenrecord. | *"In summary, HealthTick provides a robust, zero-install Android remote streaming solution. Thank you for watching."* | **Verified** |

---

## Feature Verification Matrix

| Feature | Implementation File | Verification Method | Status |
| :--- | :--- | :--- | :---: |
| **Live WebRTC H.264 Video Streaming** | `backend/src/capture.js`, `webrtc.js` | Browser `<video>` renders live emulator screen | **Verified & Working** |
| **WebSocket SDP / ICE Signaling** | `backend/src/server.js`, `frontend/js/webrtc.js` | Peer connection establishes state `connected` | **Verified & Working** |
| **Single Tap Interaction** | `backend/src/input.js`, `frontend/js/controls.js` | Tapping icons opens apps at exact coordinates | **Verified & Working** |
| **Swipe & Drag Gestures** | `backend/src/input.js`, `frontend/js/controls.js` | Dragging scrolls Settings and home screen | **Verified & Working** |
| **Keyboard & Text Entry** | `backend/src/android.js`, `frontend/js/controls.js` | Typing text into input fields, Enter & Backspace | **Verified & Working** |
| **Dynamic Coordinate Mapping** | `frontend/js/controls.js`, `backend/src/input.js` | Accurate touches across window resize | **Verified & Working** |
| **Input Dispatch Telemetry (`input_ack`)** | `backend/src/input.js`, `frontend/js/latency.js` | Live samples recorded on each input action | **Verified & Working** |
| **WebRTC Receiver Telemetry (`getStats`)** | `frontend/js/latency.js` | Displays live jitter delay, decode time, FPS | **Verified & Working** |
| **Automated E2E Frame-Diff Probe** | `frontend/js/latency.js` | Measures millisecond delta to first screen update | **Verified & Working** |
| **MP4 Session Recording** | `backend/src/recorder.js`, `frontend/js/recording.js` | Start/stop saves MP4 file, download link in UI | **Verified & Working** |
| **Subprocess Cleanup on Disconnect** | `backend/src/server.js` | ADB and FFmpeg processes terminate on socket close | **Verified & Working** |
| **Audio Capture** | N/A | Not supported by ADB `screenrecord` | *Documented Limitation* |
| **Multi-Device Concurrent Routing** | N/A | Single active session architecture | *Documented Roadmap* |
