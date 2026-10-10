# Project Submission Notes & Engineering Retrospective

---

## 1. What Went Wrong & Debugging Challenges

During the design, development, and iterative testing of the real-time Android streaming platform, several concrete engineering bottlenecks and bugs were encountered:

### 1.1 PowerShell Output Redirection Corrupting Binary Video Data
- **The Issue**: When testing ADB streaming commands in the Windows terminal, piping binary output directly using PowerShell redirection (`adb exec-out screenrecord ... > stream.h264`) produced a corrupt, unplayable video file.
- **Root Cause**: PowerShell’s default pipeline encoding converts byte streams into text/strings, inserting Windows carriage-return linefeeds (`\r\n`) and corrupting H.264 NAL headers.
- **Resolution**: Switched to Node.js binary child process pipes (`child_process.spawn`) with unencoded `Buffer` chunks, bypassing shell encoding completely.

### 1.2 FFmpeg Pipe Format Negotiation & Premature Flag Optimization
- **The Issue**: In an attempt to achieve ultra-low latency, aggressive FFmpeg buffering flags were initially introduced:
  `-fflags nobuffer -flags low_delay -analyzeduration 0 -probesize 32`.
  This caused FFmpeg to crash or exit immediately with `Invalid data found when processing input`.
- **Root Cause**: `adb screenrecord` emits an H.264 Annex B bitstream that requires a minimal initial header probe window for FFmpeg to identify the SPS/PPS (Sequence Parameter Set / Picture Parameter Set) headers. Setting `probesize 32` and `analyzeduration 0` starved the demuxer before headers were parsed.
- **Resolution**: Reverted premature optimization flags to let FFmpeg negotiate the stream cleanly (`-loglevel error -f h264 -i pipe:0 -pix_fmt yuv420p -f rawvideo pipe:1`), and instead handled latency by dropping older uncompressed frames in the Node.js buffer.

### 1.3 Viewport Coordinate Discrepancies During Window Resizing
- **The Issue**: Clicks on the browser screen frequently missed small touch targets (buttons, search bars) or hit entirely different apps, particularly when the browser window was scaled or viewed on a high-DPI display.
- **Root Cause**: There are three distinct coordinate domains:
  1. CSS viewport coordinates: `event.clientX - rect.left` (scaled by browser DPI and CSS layout).
  2. Video stream dimensions: $540 \times 1200$ (the capture resolution).
  3. Android physical device resolution: $1080 \times 2400$ (from `adb shell wm size`).
  Mapping directly from CSS pixels to Android pixels without normalizing against `video.videoWidth / rect.width` resulted in cumulative drift.
- **Resolution**: Implemented a two-stage mathematical transformation in `frontend/js/controls.js` and `backend/src/input.js` that scales CSS pixels to video pixels first, then scales video pixels to physical screen coordinates.

### 1.4 Redundant Subprocess Calls on User Interaction
- **The Issue**: Initial input handling queried `adb shell wm size` inside every single tap and swipe event.
- **Root Cause**: While technically dynamic, invoking a separate `adb` execution on every tap added 60–120 ms of overhead before the actual `adb shell input tap` command was even spawned.
- **Resolution**: Added resolution caching in `backend/src/android.js`, querying the screen dimensions once at startup and reusing the cached values for all subsequent input events.

### 1.5 Orphaned Subprocesses on Tab Disconnect
- **The Issue**: Closing the browser tab left `adb screenrecord` and `ffmpeg` processes running indefinitely in the Windows background, consuming CPU and locking the ADB capture device.
- **Root Cause**: Child processes were not attached to the WebSocket lifecycle.
- **Resolution**: Added process tracking in `backend/src/server.js`, binding `adb.kill()` and `ffmpeg.kill()` to the WebSocket `socket.on("close")` handler.

### 1.6 Post-Swipe Phantom Click Event Interruption & Fling Duration
- **The Issue**: Swiping or scrolling with the mouse on the video viewport frequently failed or immediately stopped scrolling, accidentally opening apps or clicking buttons at the release point.
- **Root Cause**: Two issues combined:
  1. Standard browser DOM behavior emits a synthetic `click` event immediately after `pointerup`. This caused a phantom `tap` event to be dispatched to Android right after the `swipe`, instantly cancelling Android's fling momentum or clicking the item under the release coordinates.
  2. The swipe duration was directly derived from user mouse drag time (up to 1000 ms). In Android OS, touch hold durations $> 400\text{ ms}$ are interpreted as a long-press-and-drag instead of a scroll/fling.
- **Resolution**: In `frontend/js/controls.js`, suppressed `click` events occurring within 450 ms of a completed swipe gesture (`lastSwipeTime`), scaled swipe duration into the optimal Android fling range ($150\text{ ms} - 300\text{ ms}$), clamped edge coordinates in `backend/src/input.js`, and added mouse wheel event listener support for desktop scrolling.

### 1.7 Android Screenrecord 180-Second (3-Minute) Stream Interruption
- **The Issue**: Video streaming abruptly froze and terminal logged `ADB stopped: 0` and `FFmpeg stopped:` after approximately 3 minutes of continuous streaming.
- **Root Cause**: Android's built-in `screenrecord` binary has an OS-level hard execution limit of 180 seconds.
- **Resolution**: In `backend/src/capture.js`, added an auto-restart loop that immediately re-spawns `adb screenrecord` and FFmpeg when the process exits cleanly while the browser session is still active, keeping the WebRTC video track continuous.

---

## 2. With More Time: Architectural Improvements

If allocated additional development cycles, the following architectural enhancements would be prioritized:

### 2.1 Lower Video Latency & Direct H.264 RTP Packetization
- **Current Limitation**: The pipeline converts H.264 &rarr; Raw I420 (via FFmpeg) &rarr; WebRTC video track (which re-encodes it in `@roamhq/wrtc`). This double-transcode adds ~35–50 ms of CPU overhead.
- **Improvement**: Implement direct H.264 Annex B parsing to extract NAL units and package them directly into WebRTC RTP packets using an H.264 payloader (RFC 6184), completely eliminating FFmpeg and software transcoding.

### 2.2 Multi-Device Routing & Session Isolation
- **Current Limitation**: The backend targets the default connected device (`adb`), preventing concurrent multi-user sessions.
- **Improvement**: Introduce a device pool manager that accepts an `emulatorId` query parameter, routes commands using `adb -s <serial>`, and isolates WebRTC ports and sessions per connected user.

### 2.3 Audio Capture Support
- **Current Limitation**: `adb screenrecord` does not capture audio.
- **Improvement**: Deploy a lightweight companion audio agent on the device or stream via the Android 10+ `AudioPlaybackCapture` API, synchronizing an Opus audio track into the WebRTC `MediaStream`.

### 2.4 Multi-Touch & Native Gestures
- **Current Limitation**: Pointer input currently maps to single-touch ADB commands (`input tap` and `input swipe`).
- **Improvement**: Utilize ADB `sendevent` or a low-latency Unix domain socket server on Android to support pinch-to-zoom, two-finger rotate, and continuous touch movement.

### 2.5 Security, Authentication & Reverse Proxying
- **Current Limitation**: Unauthenticated local WebSocket connection.
- **Improvement**: Wrap the signaling server with JWT authentication, rate limiting, and deploy TURN/STUN servers (e.g. Coturn) to enable connectivity across NAT and enterprise firewalls.

---

## 3. Decisions Made Independently of AI

*This section provides a dedicated space for the developer's independent architectural decisions, product trade-offs, and critical choices made without AI suggestion.*

- **Zero-Install Client Policy**:
  - *Decision*: Chose not to require an on-device Android APK or custom Accessibility Service.
  - *Developer Reflection*: Selected standard ADB `screenrecord` and `input` commands to ensure any stock Android emulator or device can be tested instantly without pre-configuration, sideloading, or rooting.
- **Adoption of Vanilla Web Stack**:
  - *Decision*: Built the frontend strictly in Vanilla HTML5, CSS3, and ES6 JavaScript rather than pulling in React, Vue, or Next.js.
  - *Developer Reflection*: Eliminates bundler overhead, minimizes runtime memory usage, and ensures that WebRTC video rendering and pointer event handling run with zero framework delay.
- **Pragmatic Frame Buffer Strategy**:
  - *Decision*: Chose the "drop-oldest-frame" queue policy over queuing every frame.
  - *Developer Reflection*: In an interactive remote streaming context, a dropped frame is vastly preferable to accumulating latency. Users require the freshest available frame at the expense of historical frames.
- **Developer's Personal Notes & Reflections**:
  <!-- Add any additional personal decisions or reflections here -->
  - *Architecture choice*: Kept the backend in standard CommonJS Node.js to ensure rock-solid compatibility with the native `@roamhq/wrtc` binary bindings on Windows.
  - *Design choice*: Embedded the latency telemetry suite directly into the primary UI as a developer HUD so latency can be diagnosed continuously during real-world usage.

---

## 4. Where AI Was Wrong or Unhelpful

During development, relying blindly on AI suggestions generated several real technical errors that were discovered and corrected through hands-on testing:

### 4.1 AI Suggested Fragile FFmpeg Latency Flags That Broke Demuxing
- **AI Suggestion**: The AI suggested passing `-fflags nobuffer -flags low_delay -analyzeduration 0 -probesize 32` to FFmpeg to "eliminate all latency".
- **What Actually Happened**: FFmpeg failed to initialize because ADB's pipe stream does not contain continuous container metadata. Setting `probesize 32` gave FFmpeg insufficient bytes to detect H.264 SPS/PPS parameters, crashing the capture pipeline.
- **How Testing Revealed It**: The server repeatedly printed `Invalid data found when processing input` and emitted zero video frames. Reverting to standard input flags and handling buffering in Node.js resolved the issue.

### 4.2 AI Suggested PowerShell Output Redirection for Binary Captures
- **AI Suggestion**: When asked how to test ADB screen recording, the AI recommended running `adb exec-out screenrecord --output-format h264 - > test.h264` in PowerShell.
- **What Actually Happened**: The resulting file was completely corrupted due to PowerShell converting binary stdout into UTF-16 strings.
- **How Testing Revealed It**: FFmpeg and VLC both reported `Header missing / corrupt stream`. The issue was solved by using Node.js child process binary stream pipes.

### 4.3 AI Neglected Coordinate Normalization on Window Resizing
- **AI Suggestion**: The AI provided initial touch event listeners that computed coordinates simply as `event.offsetX` and `event.offsetY`.
- **What Actually Happened**: On any screen where the `<video>` element was displayed at a size different from its intrinsic resolution (e.g. responsive scaling or CSS borders), `offsetX` caused touches to register far away from the intended button.
- **How Testing Revealed It**: Clicking an icon in the upper right corner clicked the center of the emulator screen. Corrected by calculating `videoX = (clientX - rect.left) * (videoWidth / rect.width)`.

### 4.4 AI Confused Signaling Time with Full End-to-End Latency
- **AI Suggestion**: The AI originally implemented a 1-second WebSocket timestamp roundtrip ping and logged it in the console as `Measured latency: X ms`.
- **What Actually Happened**: This only measured network WebSocket ping time (~1–5 ms), completely ignoring ADB execution, encoding, transcoding, and video playout delay.
- **How Testing Revealed It**: Recognizing that user action-to-pixel-update delay was visibly higher than 5 ms prompted the implementation of the three-tier latency telemetry suite (Input Dispatch, WebRTC Playout, and Visual Frame-Diff).

---

## 5. Development Audit Trail & Preserved Records

All historical audit records, refactoring logs, and development sessions have been preserved without destructive changes:
- `PROCESS_LOG.md`: Detailed chronological log of restructuring and modularization.
- `docs/WHAT_WENT_WRONG.md`: Initial record of technical challenges.
- `docs/WITH_MORE_TIME.md`: Initial roadmap of future extensions.
- `git log`: Complete repository commit history (`8e54065`, `17b3b9d`, `a00c05e`).
