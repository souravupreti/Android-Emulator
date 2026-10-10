const { spawn, execFile } = require("child_process");

function startAndroidCapture(videoSource) {
  let isRunning = true;
  let currentAdb = null;
  let currentFfmpeg = null;
  let restartTimeout = null;

  const width = 540;
  const height = 1200;

  // I420 frame size:
  // Y = width * height
  // U + V = width * height / 2
  const frameSize = Math.floor(width * height * 1.5);

  let frameCount = 0;
  let adbBytes = 0;
  let ffmpegBytes = 0;

  function launchPipeline() {
    if (!isRunning) return;

    console.log("Starting Android screen capture pipeline...");

    // Local references — close handlers MUST use these, not currentAdb/currentFfmpeg,
    // to avoid killing the next pipeline's processes when this one exits.
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

    const ffmpeg = spawn("ffmpeg", [
      "-loglevel",
      "error",
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

    // Update shared pointers so stop() can clean up the active pipeline
    currentAdb = adb;
    currentFfmpeg = ffmpeg;

    adb.on("error", (error) => {
      console.error("ADB process error:", error);
    });

    ffmpeg.on("error", (error) => {
      console.error("FFmpeg process error:", error);
    });

    // Safe error handlers to prevent unhandled EPIPE crashes
    if (ffmpeg.stdin) {
      ffmpeg.stdin.on("error", (err) => {
        if (err.code !== "EPIPE" && err.code !== "EOF") {
          console.error("FFmpeg stdin error:", err.message);
        }
      });
    }

    if (adb.stdout) {
      adb.stdout.on("error", (err) => {
        if (err.code !== "EPIPE") {
          console.error("ADB stdout error:", err.message);
        }
      });
    }

    adb.stdout.pipe(ffmpeg.stdin);

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

      // Use the newest complete frame.
      const latestOffset =
        (completeFrames - 1) * frameSize;

      const latestFrame = buffer.subarray(
        latestOffset,
        latestOffset + frameSize
      );

      // Discard older complete frames.
      buffer = buffer.subarray(
        completeFrames * frameSize
      );

      try {
        videoSource.onFrame({
          width,
          height,
          data: new Uint8ClampedArray(latestFrame),
        });
      } catch (err) {
        console.error("Error feeding frame to videoSource:", err);
      }

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

    // Use LOCAL adb/ffmpeg variables here — NOT currentAdb/currentFfmpeg.
    // This prevents the old pipeline's close handler from killing the NEW pipeline
    // that was already started 200ms later.
    adb.on("close", (code) => {
      console.log("ADB stopped:", code);

      // Kill THIS pipeline's ffmpeg (local ref)
      if (!ffmpeg.killed) {
        try { adb.stdout.unpipe(ffmpeg.stdin); } catch (e) {}
        try { ffmpeg.kill(); } catch (e) {}
      }

      // Android screenrecord automatically exits after 180 seconds.
      // Only restart if this is still the active pipeline.
      if (isRunning && currentAdb === adb) {
        console.log("Auto-restarting ADB screenrecord for continuous streaming...");
        restartTimeout = setTimeout(launchPipeline, 300);
      }
    });

    ffmpeg.on("close", (code) => {
      console.log("FFmpeg stopped:", code);

      // If FFmpeg dies unexpectedly and this is still the active pipeline,
      // kill THIS pipeline's ADB (local ref) which will trigger the ADB close → restart.
      if (isRunning && currentFfmpeg === ffmpeg && !adb.killed) {
        try { adb.stdout.unpipe(ffmpeg.stdin); } catch (e) {}
        try { adb.kill(); } catch (e) {}
      }
    });
  }

  launchPipeline();

  return {
    stop: () => {
      isRunning = false;
      if (restartTimeout) {
        clearTimeout(restartTimeout);
        restartTimeout = null;
      }
      if (currentAdb && currentAdb.stdout && currentFfmpeg && currentFfmpeg.stdin) {
        try { currentAdb.stdout.unpipe(currentFfmpeg.stdin); } catch (e) {}
      }
      if (currentAdb && !currentAdb.killed) {
        try { currentAdb.kill(); } catch (e) {}
      }
      if (currentFfmpeg && !currentFfmpeg.killed) {
        try { currentFfmpeg.kill(); } catch (e) {}
      }
      // Clean up device-side screenrecord process
      try {
        execFile("adb", ["shell", "pkill", "-9", "screenrecord"], () => {});
      } catch (e) {}
    },
    get adb() {
      return currentAdb;
    },
    get ffmpeg() {
      return currentFfmpeg;
    },
  };
}

module.exports = {
  startAndroidCapture,
};