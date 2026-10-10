const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const { WebRTCManager } = require("./webrtc");
const { handleInputMessage } = require("./input");
const { startAndroidCapture } = require("./capture");

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({
  server,
  path: "/ws",
});

const PORT = 3000;

app.use(express.static(path.join(__dirname, "../../frontend")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../../frontend/index.html"));
});

app.get("/time", (req, res) => {
  res.json({
    time: Date.now(),
  });
});

wss.on("connection", (socket) => {
  console.log("Browser connected");

  const latencyTimer = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "latency",
          serverTime: Date.now(),
        })
      );
    }
  }, 1000);

  const webrtc = new WebRTCManager({
    onIceCandidate: (candidate) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "candidate",
            candidate,
          })
        );
      }
    },
  });

  let captureProcesses = null;

  socket.on("message", async (message) => {
    try {
      const data = JSON.parse(message.toString());

      console.log("WebSocket message:", data.type, data);

      // Handle input events (tap, swipe, text, key)
      const handled = await handleInputMessage(data, socket);
      if (handled) {
        return;
      }

      // =========================
      // OFFER
      // =========================
      if (data.type === "offer") {
        const answer = await webrtc.handleOffer(data.offer);

        socket.send(
          JSON.stringify({
            type: "answer",
            answer,
          })
        );

        if (!captureProcesses) {
          captureProcesses = startAndroidCapture(webrtc.getVideoSource());
        }
        return;
      }

      // =========================
      // ICE CANDIDATE
      // =========================
      if (data.type === "candidate") {
        await webrtc.handleCandidate(data.candidate);
        return;
      }
    } catch (error) {
      console.error("Message processing error:", error);
    }
  });

  socket.on("close", () => {
    clearInterval(latencyTimer);
    console.log("Browser disconnected");
    webrtc.close();

    if (captureProcesses) {
      console.log("Cleaning up capture processes (ADB & FFmpeg)...");
      try {
        if (typeof captureProcesses.stop === "function") {
          captureProcesses.stop();
        } else {
          if (captureProcesses.adb && !captureProcesses.adb.killed) {
            captureProcesses.adb.kill();
          }
          if (captureProcesses.ffmpeg && !captureProcesses.ffmpeg.killed) {
            captureProcesses.ffmpeg.kill();
          }
        }
      } catch (e) {
        console.error("Error stopping capture processes:", e);
      }
      captureProcesses = null;
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
