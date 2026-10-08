const express = require("express");
const { execFile } = require("child_process");
const http = require("http");
const WebSocket = require("ws");
const wrtc = require("@roamhq/wrtc");
const { spawn } = require("child_process");
const path = require("path");

const { RTCVideoSource } = wrtc.nonstandard;

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({
  server,
  path: "/ws",
});

const PORT = 3000;

app.use(express.static(path.join(__dirname, "../frontend")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

function getAndroidResolution() {
  return new Promise((resolve, reject) => {
    execFile("adb", ["shell", "wm", "size"], (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }

      const match = stdout.match(/Physical size:\s*(\d+)x(\d+)/);

      if (!match) {
        reject(new Error("Could not detect Android resolution"));
        return;
      }

      resolve({
        width: Number(match[1]),
        height: Number(match[2]),
      });
    });
  });
}

wss.on("connection", (socket) => {
  console.log("Browser connected");

  const latencyTimer = setInterval(() => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(
      JSON.stringify({
        type: "latency",
        serverTime: Date.now()
      })
    );
  }
}, 1000);
  const peerConnection = new wrtc.RTCPeerConnection();

  // Create video source
  const videoSource = new RTCVideoSource({
    isScreencast: true,
  });

  // Create video track
  const videoTrack = videoSource.createTrack();

  // Put the track inside a MediaStream
  const mediaStream = new wrtc.MediaStream();

  mediaStream.addTrack(videoTrack);

  // Send video track to browser
  peerConnection.addTrack(videoTrack, mediaStream);

  let remoteDescriptionSet = false;
  const pendingCandidates = [];

  peerConnection.onicecandidate = (event) => {
    if (event.candidate && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "candidate",
          candidate: event.candidate,
        })
      );
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log(
      "WebRTC connection state:",
      peerConnection.connectionState
    );
  };

  socket.on("message", async (message) => {
    try {
      const data = JSON.parse(message.toString());

      console.log("WebSocket message:", data.type, data);

      // =========================
      // TAP
      // =========================
      if (data.type === "tap") {
        try {
          const android = await getAndroidResolution();

          const x = Math.round(
            data.x * (android.width / 540)
          );

          const y = Math.round(
            data.y * (android.height / 1200)
          );

          console.log(
            `Tap: video(${data.x.toFixed(1)}, ${data.y.toFixed(1)}) -> Android(${x}, ${y})`
          );

          const tap = spawn("adb", [
            "shell",
            "input",
            "tap",
            String(x),
            String(y),
          ]);

          tap.on("error", (error) => {
            console.error("ADB tap error:", error);
          });

        } catch (error) {
          console.error("Tap mapping error:", error);
        }

        return;
      }

      // =========================
      // SWIPE
      // =========================
      if (data.type === "swipe") {
        try {
          const android = await getAndroidResolution();

          const startX = Math.round(
            data.startX * (android.width / 540)
          );

          const startY = Math.round(
            data.startY * (android.height / 1200)
          );

          const endX = Math.round(
            data.endX * (android.width / 540)
          );

          const endY = Math.round(
            data.endY * (android.height / 1200)
          );

          const duration = Math.round(data.duration || 300);

          console.log(
            `Swipe: (${startX}, ${startY}) -> (${endX}, ${endY}) ${duration}ms`
          );

          const swipe = spawn("adb", [
            "shell",
            "input",
            "swipe",
            String(startX),
            String(startY),
            String(endX),
            String(endY),
            String(duration),
          ]);

          swipe.on("error", (error) => {
            console.error("ADB swipe error:", error);
          });

        } catch (error) {
          console.error("Swipe mapping error:", error);
        }

        return;
      }

      // =========================
      // TEXT
      // =========================
      if (data.type === "text") {
        try {
          const text = String(data.text);

          // ADB uses %s for spaces
          const adbText = text.replace(/ /g, "%s");

          console.log(`Text received: "${text}"`);

          const input = spawn("adb", [
            "shell",
            "input",
            "text",
            adbText,
          ]);

          input.on("error", (error) => {
            console.error("ADB text error:", error);
          });

        } catch (error) {
          console.error("Text input error:", error);
        }

        return;
      }

      // =========================
      // KEYBOARD KEYS
      // =========================
      if (data.type === "key") {
        let keyCode = null;

        if (data.key === "Backspace") {
          keyCode = "KEYCODE_DEL";
        }

        if (data.key === "Enter") {
          keyCode = "KEYCODE_ENTER";
        }

        if (keyCode) {
          console.log(`Key received: ${data.key}`);

          const key = spawn("adb", [
            "shell",
            "input",
            "keyevent",
            keyCode,
          ]);

          key.on("error", (error) => {
            console.error("ADB key error:", error);
          });
        }

        return;
      }

      // =========================
      // OFFER
      // =========================
      if (data.type === "offer") {
        console.log("Offer received");

        await peerConnection.setRemoteDescription(
          new wrtc.RTCSessionDescription(data.offer)
        );

        remoteDescriptionSet = true;

        for (const candidate of pendingCandidates) {
          await peerConnection.addIceCandidate(
            new wrtc.RTCIceCandidate(candidate)
          );
        }

        pendingCandidates.length = 0;

        const answer = await peerConnection.createAnswer();

        await peerConnection.setLocalDescription(answer);

        socket.send(
          JSON.stringify({
            type: "answer",
            answer: peerConnection.localDescription,
          })
        );

        console.log("Answer sent");

        startAndroidCapture(videoSource);

        return;
      }

      // =========================
      // ICE CANDIDATE
      // =========================
      if (data.type === "candidate") {
        if (!remoteDescriptionSet) {
          pendingCandidates.push(data.candidate);
        } else {
          await peerConnection.addIceCandidate(
            new wrtc.RTCIceCandidate(data.candidate)
          );
        }

        return;
      }

    } catch (error) {
      console.error("WebRTC error:", error);
    }
  });

  socket.on("close", () => {
    clearInterval(latencyTimer);
    console.log("Browser disconnected");
    
    videoTrack.stop();
    peerConnection.close();
  });
});






function startAndroidCapture(videoSource) {
  console.log("Starting Android screen capture...");

  const width = 540;
  const height = 1200;

  const frameSize = Math.floor(width * height * 1.5);

  const adb = spawn("adb", [
  "exec-out",
  "screenrecord",
  "--size",
  "540x1200",
  "--bit-rate",
  "2000000",
  "--output-format",
  "h264",
  "-"
]);

  adb.on("error", (error) => {
    console.error("ADB process error:", error);
  });

const ffmpeg = spawn("ffmpeg", [
  "-loglevel",
  "error",

  "-fflags",
  "nobuffer",

  "-flags",
  "low_delay",

  "-analyzeduration",
  "0",

  "-probesize",
  "32",

  "-f",
  "h264",
  "-i",
  "pipe:0",

  "-pix_fmt",
  "yuv420p",

  "-f",
  "rawvideo",
  "pipe:1",
]);

  ffmpeg.on("error", (error) => {
    console.error("FFmpeg process error:", error);
  });

  adb.stdout.pipe(ffmpeg.stdin);

  let adbBytes = 0;
  let ffmpegBytes = 0;
  let frameCount = 0;

  adb.stdout.on("data", (chunk) => {
    adbBytes += chunk.length;

    if (adbBytes % (1024 * 1024) < chunk.length) {
      console.log(
        `ADB: ${(adbBytes / 1024 / 1024).toFixed(2)} MB`
      );
    }
  });

  let buffer = Buffer.alloc(0);

  ffmpeg.stdout.on("data", (chunk) => {
  ffmpegBytes += chunk.length;

  buffer = Buffer.concat([buffer, chunk]);

  const completeFrames = Math.floor(
    buffer.length / frameSize
  );

  if (completeFrames === 0) {
    return;
  }

  // Find the newest complete frame
  const latestOffset =
    (completeFrames - 1) * frameSize;

  const latestFrame = buffer.subarray(
    latestOffset,
    latestOffset + frameSize
  );

  // Remove all complete frames from the buffer.
  // This intentionally discards older frames.
  buffer = buffer.subarray(
    completeFrames * frameSize
  );

  videoSource.onFrame({
    width,
    height,
    data: new Uint8ClampedArray(latestFrame),
  });

  frameCount++;

  if (frameCount % 30 === 0) {
    console.log(
      `Latest frames sent: ${frameCount} | FFmpeg: ${(ffmpegBytes / 1024 / 1024).toFixed(2)} MB`
    );
  }
});

  ffmpeg.stderr.on("data", (data) => {
    console.error("FFmpeg:", data.toString());
  });

  adb.on("close", (code) => {
    console.log("ADB stopped:", code);
  });

  ffmpeg.on("close", (code) => {
    console.log("FFmpeg stopped:", code);
  });
}

app.get("/time", (req, res) => {
  res.json({
    time: Date.now()
  });
});
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});