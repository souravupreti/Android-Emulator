# With More Time: Future Improvements

The following improvements and architectural extensions represent realistic future work:

1. **Lower Video Latency**
   - Tune ADB `screenrecord` parameters, reduce FFmpeg probe and analysis durations, evaluate direct H.264 packet forwarding into WebRTC tracks to eliminate YUV raw frame transcoding overhead.

2. **Multiple Isolated Android Instances**
   - Support concurrent multi-device routing and multi-user sessions by targeting specific ADB device serials (`adb -s <serial>`) and managing separate device pools.

3. **Session Lifecycle & Cleanup**
   - Implement robust cleanup hooks to terminate child processes (`adb`, `ffmpeg`) immediately when client connections drop, preventing orphaned background tasks.

4. **Clipboard Synchronization**
   - Enable bidirectional clipboard sharing between the client browser and the Android emulator (`adb shell am broadcast` or clipboard services).

5. **Session Recording & Audit Logs**
   - Provide server-side session recording for debugging, quality assurance, or user telemetry.

6. **Stronger Security & Authentication**
   - Add token-based authentication on WebSocket signaling endpoints, restrict ADB command injection, and isolate network perimeters.

7. **Production Deployment Improvements**
   - Containerize emulator and backend environments (e.g. Docker with KVM acceleration or cloud Android instances) and add reverse proxy / TURN server support.
