const { spawn } = require("child_process");

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
    "-",
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
      console.log(`ADB: ${(adbBytes / 1024 / 1024).toFixed(2)} MB`);
    }
  });

  let buffer = Buffer.alloc(0);

  ffmpeg.stdout.on("data", (chunk) => {
    ffmpegBytes += chunk.length;

    buffer = Buffer.concat([buffer, chunk]);

    const completeFrames = Math.floor(buffer.length / frameSize);

    if (completeFrames === 0) {
      return;
    }

    // Find the newest complete frame
    const latestOffset = (completeFrames - 1) * frameSize;

    const latestFrame = buffer.subarray(
      latestOffset,
      latestOffset + frameSize
    );

    // Remove all complete frames from the buffer.
    // This intentionally discards older frames.
    buffer = buffer.subarray(completeFrames * frameSize);

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

  return { adb, ffmpeg };
}

module.exports = {
  startAndroidCapture,
};
