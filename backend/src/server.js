const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const { WebRTCManager } = require("./webrtc");
const { handleInputMessage } = require("./input");
const { startAndroidCapture } = require("./capture");
const {
  startRecording,
  stopRecording,
  stopAllRecordings,
  getRecording,
  listRecordings,
  getDownloadPath,
} = require("./recorder");

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({
  server,
  path: "/ws",
});

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "../../frontend")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../../frontend/index.html"));
});

app.get("/time", (req, res) => {
  res.json({ time: Date.now() });
});

// ============================================================
// Recording REST API
// ============================================================

/**
 * POST /api/recordings/start
 * Body: { sessionId: string }
 * Starts a new recording for the given session.
 * Returns 409 if session already has an active recording.
 */
app.post("/api/recordings/start", (req, res) => {
  const sessionId = req.body && req.body.sessionId;
  if (!sessionId || typeof sessionId !== "string" || sessionId.trim() === "") {
    return res.status(400).json({ error: "sessionId is required" });
  }

  try {
    const meta = startRecording(sessionId.trim());
    console.log(`[server] Recording started: ${meta.id}`);
    return res.status(201).json(meta);
  } catch (err) {
    const isConflict = err.message && err.message.includes("already has an active recording");
    return res.status(isConflict ? 409 : 500).json({ error: err.message });
  }
});

/**
 * POST /api/recordings/:id/stop
 * Sends stop signal to the recording. The recording may not be
 * fully finalized immediately (FFmpeg needs a moment to write the moov atom).
 */
app.post("/api/recordings/:id/stop", (req, res) => {
  const { id } = req.params;

  try {
    const meta = stopRecording(id);
    return res.json(meta);
  } catch (err) {
    const isNotFound = err.message && err.message.includes("not found");
    const isInvalid = err.message && err.message.includes("Invalid");
    return res.status(isNotFound || isInvalid ? 404 : 500).json({ error: err.message });
  }
});

/**
 * GET /api/recordings
 * Returns all recording metadata, newest first.
 */
app.get("/api/recordings", (req, res) => {
  return res.json(listRecordings());
});

/**
 * GET /api/recordings/:id
 * Returns metadata for a specific recording.
 */
app.get("/api/recordings/:id", (req, res) => {
  const { id } = req.params;
  const meta = getRecording(id);
  if (!meta) {
    return res.status(404).json({ error: "Recording not found" });
  }
  return res.json(meta);
});

/**
 * GET /api/recordings/:id/download
 * Streams the MP4 file for a completed recording.
 * Rejected if status !== "completed" or file does not exist.
 */
app.get("/api/recordings/:id/download", (req, res) => {
  const { id } = req.params;

  const filepath = getDownloadPath(id);
  if (!filepath) {
    const meta = getRecording(id);
    if (!meta) return res.status(404).json({ error: "Recording not found" });
    if (meta.status === "recording") return res.status(409).json({ error: "Recording is still in progress" });
    if (meta.status === "error") return res.status(500).json({ error: "Recording failed: " + meta.error });
    return res.status(404).json({ error: "Recording file not available" });
  }

  const stat = require("fs").statSync(filepath);
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Length", stat.size);
  res.setHeader("Content-Disposition", `attachment; filename="recording_${id}.mp4"`);

  const fs = require("fs");
  const stream = fs.createReadStream(filepath);
  stream.on("error", (err) => {
    console.error("[server] Download stream error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Stream error" });
  });
  stream.pipe(res);
});

// ============================================================
// WebSocket signaling
// ============================================================

wss.on("connection", (socket) => {
  // Assign a stable session ID for this connection
  const sessionId = require("crypto").randomBytes(8).toString("hex");
  console.log(`Browser connected (session: ${sessionId})`);

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

  // Send session ID to client on connect
  socket.send(JSON.stringify({ type: "session_id", sessionId }));

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
    console.log(`Browser disconnected (session: ${sessionId})`);
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

    // Note: completed recordings are NOT deleted when sessions end
  });
});

// ============================================================
// Graceful shutdown — stop all in-progress recordings
// ============================================================

function gracefulShutdown(signal) {
  console.log(`[server] Received ${signal}, stopping recordings and shutting down...`);
  stopAllRecordings();
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
