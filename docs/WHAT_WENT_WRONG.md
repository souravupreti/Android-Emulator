# What Went Wrong & Challenges Encountered

During the initial development of the real-time Android browser streaming system, several technical challenges were encountered:

1. **PowerShell Redirection Issue with Binary Output**
   - Directing binary screen captures using PowerShell output redirection initially resulted in corrupted/invalid image data due to default encoding and newline conversions.

2. **FFmpeg Raw Frame Output Integration**
   - Piping H.264 video from ADB `screenrecord` into FFmpeg initially failed to emit expected raw video frames due to buffering flags and format negotiation between pipes (`yuv420p` / `rawvideo`).

3. **WebRTC Browser Video MediaStream Handling**
   - The browser `<video>` element initially required explicit `MediaStream` attachment and transceiver negotiation (`recvonly`) for tracks received over `peerConnection.ontrack`.

4. **Coordinate Mapping Discrepancy**
   - Browser viewport dimensions differed significantly from the physical Android resolution and the capture stream dimensions. Input events initially landed on incorrect coordinates until dynamic coordinate mapping using `adb shell wm size` was implemented.

5. **Swipe Handling & Gesture Detection**
   - Distinguishing taps from swipes required tracking pointer travel distances and duration thresholds, as well as capturing pointer events properly across the video element.

6. **Video Latency**
   - Video latency is currently high due to default buffer behavior and pipeline stages; latency optimization is planned for a subsequent phase.
