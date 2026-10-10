document.addEventListener("DOMContentLoaded", () => {
  const video = document.getElementById("video");
  const status = document.getElementById("status");

  const socket = new WebSocket(
    "ws://" + window.location.host + "/ws"
  );

  function sendMessage(msg) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  }

  const webrtc = new window.WebRTCClient({
    videoElement: video,
    statusElement: status,
    sendSignal: sendMessage,
  });

  // Initialize Latency Telemetry Manager
  if (window.LatencyManager) {
    window.latencyManager = new window.LatencyManager();
    window.latencyManager.init({
      videoElement: video,
      webrtcClient: webrtc,
      hudContainerId: "latency-hud-container",
    });
  }

  // Initialize Recording Manager
  if (window.RecordingManager) {
    window.RecordingManager.init("recording-container");
  }

  window.setupControls(video, sendMessage);

  // WebSocket connected
  socket.onopen = async () => {
    console.log("WebSocket connected");
    await webrtc.startOffer();
  };

  // Messages from backend
  socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);

      // Session ID assigned by server — pass to recording manager
      if (data.type === "session_id") {
        console.log("Session ID:", data.sessionId);
        if (window.RecordingManager) {
          window.RecordingManager.setSessionId(data.sessionId);
        }
        return;
      }

      if (data.type === "input_ack") {
        if (window.latencyManager) {
          window.latencyManager.recordInputAck(data);
        }
        return;
      }

      if (data.type === "latency") {
        const latency = Date.now() - data.serverTime;
        console.log(`Measured latency: ${latency} ms`);
        return;
      }

      if (data.type === "answer") {
        await webrtc.handleAnswer(data.answer);
        return;
      }

      if (data.type === "candidate") {
        await webrtc.handleCandidate(data.candidate);
        return;
      }
    } catch (error) {
      console.error("Message handling error:", error);
    }
  };

  socket.onerror = (error) => {
    console.error("WebSocket error:", error);
    if (status) {
      status.textContent = "WebSocket error";
    }
  };

  socket.onclose = () => {
    console.log("WebSocket disconnected");
    if (status) {
      status.textContent = "Disconnected";
    }
  };
});
