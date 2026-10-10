# System Architecture & Technical Design

> For the comprehensive, primary architecture document, see [ARCHITECTURE.md](../ARCHITECTURE.md) at the repository root.

## Architectural Summary

HealthTick connects a browser client and an Android device via a Node.js backend using WebRTC for media delivery and WebSockets for input and signaling:

```
[ Android Device / Emulator ]
       │
       ├─ adb exec-out screenrecord (H.264 bitstream stdout)
       │         │
       │         ▼
       │   [ FFmpeg Process: H.264 -> Raw I420 (yuv420p) ]
       │         │
       │         ▼
       │   [ RTCVideoSource (@roamhq/wrtc) ]
       │         │
       │         ▼
       │   [ WebRTC RTP / SRTP Stream ] ──────────────► [ Browser <video> Element ]
       │                                                         │
       ▲                                                         ▼
       │                                                [ Pointer / Key Events ]
       │                                                         │
       ├─ adb shell input tap / swipe / text ◄───────────────────┘
       │         (Dynamic Coordinate Mapping)
       │
[ Node.js Backend: WebSocket Signaling & Input Dispatch (Port 3000) ]
```

### Component Structure
- **Screen Capture (`backend/src/capture.js`)**: Pipes `adb exec-out screenrecord` into `ffmpeg` to produce raw I420 video frames, dropping older frames to maintain real-time responsiveness.
- **WebRTC Server (`backend/src/webrtc.js`)**: Wraps `@roamhq/wrtc` to create headless `RTCPeerConnection` and inject raw video frames into an `RTCVideoSource` track.
- **Input Management (`backend/src/android.js`, `backend/src/input.js`)**: Queries device physical screen size (`adb shell wm size`), maps coordinates from the browser's video viewport, and executes native input actions with timing metrics.
- **Frontend Streaming Client (`frontend/js/webrtc.js`, `frontend/js/controls.js`, `frontend/js/latency.js`)**: Manages browser peer connection, mouse/touch event scaling, and three-tier latency telemetry.
