/**
 * recorder.js — Session recording module
 *
 * Manages a separate ADB+FFmpeg pipeline that saves the Android screen to an MP4
 * file in backend/recordings/. This is independent from the live WebRTC streaming
 * pipeline so it does not interrupt video playback or WebRTC negotiation.
 *
 * Limits:
 *   - One active recording per session
 *   - Maximum 30 minutes per recording
 *   - Maximum 2 GB file size (FFmpeg limit flag)
 *   - Recordings are kept on disk; not deleted when sessions end
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// Directory where MP4 files are saved — kept outside node_modules and src
const RECORDINGS_DIR = path.join(__dirname, "..", "recordings");

// Per-recording limits
const MAX_DURATION_SECONDS = 30 * 60; // 30 minutes
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

// In-memory metadata store — survives the process lifetime, not persisted between restarts
const recordings = new Map(); // id -> RecordingMeta

/**
 * RecordingMeta shape:
 * {
 *   id: string,
 *   sessionId: string,
 *   filename: string,
 *   filepath: string,
 *   status: "recording" | "completed" | "error",
 *   startTime: number (Date.now()),
 *   endTime: number | null,
 *   durationMs: number | null,
 *   fileSizeBytes: number | null,
 *   error: string | null,
 * }
 */

/**
 * Make sure the recordings directory exists.
 */
function ensureRecordingsDir() {
  if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  }
}

/**
 * Generate a URL-safe unique recording ID (no filesystem traversal possible).
 */
function generateId() {
  return crypto.randomBytes(12).toString("hex");
}

/**
 * Validate a recording ID: only hex lowercase, length 24.
 */
function isValidId(id) {
  return typeof id === "string" && /^[0-9a-f]{24}$/.test(id);
}

/**
 * Return a safe filename for a given ID.
 */
function idToFilename(id) {
  return `rec_${id}.mp4`;
}

/**
 * Start a new recording for the given sessionId.
 *
 * Launches: adb exec-out screenrecord --output-format h264 - | ffmpeg ... output.mp4
 *
 * Returns the RecordingMeta object.
 * Throws if a recording is already active for this sessionId or if ADB is unavailable.
 */
function startRecording(sessionId) {
  ensureRecordingsDir();

  // Guard: one active recording per session
  for (const meta of recordings.values()) {
    if (meta.sessionId === sessionId && meta.status === "recording") {
      throw new Error(`Session ${sessionId} already has an active recording (${meta.id})`);
    }
  }

  const id = generateId();
  const filename = idToFilename(id);
  const filepath = path.join(RECORDINGS_DIR, filename);

  const meta = {
    id,
    sessionId,
    filename,
    filepath,
    status: "recording",
    startTime: Date.now(),
    endTime: null,
    durationMs: null,
    fileSizeBytes: null,
    error: null,
  };

  recordings.set(id, meta);

  console.log(`[recorder] Starting recording ${id} for session ${sessionId}`);

  // ADB captures H.264 bitstream at 540x1200 — same resolution as live stream
  const adb = spawn("adb", [
    "exec-out",
    "screenrecord",
    "--size", "540x1200",
    "--bit-rate", "2000000",
    "--output-format", "h264",
    "--time-limit", String(MAX_DURATION_SECONDS),
    "-",
  ]);

  // FFmpeg receives H.264 and writes a properly-finalized MP4
  const ffmpeg = spawn("ffmpeg", [
    "-loglevel", "error",
    "-f", "h264",
    "-framerate", "30",
    "-i", "pipe:0",
    "-c:v", "copy",          // no re-encode — fast, no CPU overhead
    "-movflags", "+faststart", // web-compatible: moov atom at front
    "-fs", String(MAX_FILE_SIZE_BYTES),
    filepath,
  ]);

  adb.stdout.pipe(ffmpeg.stdin);

  adb.on("error", (err) => {
    console.error(`[recorder ${id}] ADB error:`, err.message);
    _finalizeError(id, `ADB process error: ${err.message}`);
  });

  ffmpeg.on("error", (err) => {
    console.error(`[recorder ${id}] FFmpeg error:`, err.message);
    _finalizeError(id, `FFmpeg process error: ${err.message}`);
  });

  ffmpeg.stderr.on("data", (data) => {
    const msg = data.toString().trim();
    if (msg) console.error(`[recorder ${id}] FFmpeg: ${msg}`);
  });

  adb.on("close", (code) => {
    console.log(`[recorder ${id}] ADB closed (code ${code})`);
    // When ADB closes (including natural 180s/30min limit), close FFmpeg stdin to
    // flush and finalize the MP4.
    if (ffmpeg.stdin && !ffmpeg.stdin.destroyed) {
      try { ffmpeg.stdin.end(); } catch (e) {}
    }
  });

  ffmpeg.on("close", (code) => {
    console.log(`[recorder ${id}] FFmpeg closed (code ${code})`);
    const current = recordings.get(id);
    if (!current || current.status !== "recording") return; // already handled

    if (code === 0) {
      _finalizeSuccess(id);
    } else {
      _finalizeError(id, `FFmpeg exited with code ${code}`);
    }
  });

  // Store process references on the meta for stop()
  meta._adb = adb;
  meta._ffmpeg = ffmpeg;

  return _publicMeta(meta);
}

/**
 * Stop an active recording by ID.
 * Sends SIGTERM to ADB (which causes FFmpeg to flush and finalize).
 * Returns the final metadata once FFmpeg closes, or a snapshot if already stopped.
 */
function stopRecording(id) {
  if (!isValidId(id)) {
    throw new Error("Invalid recording ID");
  }

  const meta = recordings.get(id);
  if (!meta) {
    throw new Error(`Recording ${id} not found`);
  }
  if (meta.status !== "recording") {
    return _publicMeta(meta); // already completed or errored
  }

  console.log(`[recorder] Stopping recording ${id}`);

  // Kill ADB — this causes its stdout to close, which ends FFmpeg stdin pipe,
  // which causes FFmpeg to finalize the MP4 and exit cleanly.
  try {
    if (meta._adb && !meta._adb.killed) {
      meta._adb.kill("SIGTERM");
    }
  } catch (e) {
    console.error(`[recorder ${id}] Error killing ADB:`, e);
  }

  return _publicMeta(meta);
}

/**
 * Stop all active recordings — called on server shutdown.
 */
function stopAllRecordings() {
  for (const [id, meta] of recordings) {
    if (meta.status === "recording") {
      console.log(`[recorder] Shutdown: stopping recording ${id}`);
      stopRecording(id);
    }
  }
}

/**
 * Return the public metadata for a recording by ID.
 * Returns null if not found or invalid ID.
 */
function getRecording(id) {
  if (!isValidId(id)) return null;
  const meta = recordings.get(id);
  return meta ? _publicMeta(meta) : null;
}

/**
 * Return all recordings metadata as an array, newest first.
 */
function listRecordings() {
  return Array.from(recordings.values())
    .sort((a, b) => b.startTime - a.startTime)
    .map(_publicMeta);
}

/**
 * Return the absolute filepath for a completed recording, or null if not downloadable.
 * Validates: ID must be valid, recording must exist, status must be "completed".
 */
function getDownloadPath(id) {
  if (!isValidId(id)) return null;
  const meta = recordings.get(id);
  if (!meta || meta.status !== "completed") return null;
  if (!fs.existsSync(meta.filepath)) return null;
  return meta.filepath;
}

// ——————————————————————————————————————————
// Internal helpers
// ——————————————————————————————————————————

function _finalizeSuccess(id) {
  const meta = recordings.get(id);
  if (!meta) return;

  const endTime = Date.now();
  let fileSizeBytes = null;
  try {
    const stat = fs.statSync(meta.filepath);
    fileSizeBytes = stat.size;
  } catch (e) {
    console.warn(`[recorder ${id}] Could not stat output file:`, e.message);
  }

  meta.status = "completed";
  meta.endTime = endTime;
  meta.durationMs = endTime - meta.startTime;
  meta.fileSizeBytes = fileSizeBytes;

  console.log(
    `[recorder ${id}] Completed. Duration: ${(meta.durationMs / 1000).toFixed(1)}s, ` +
    `Size: ${fileSizeBytes ? (fileSizeBytes / 1024 / 1024).toFixed(2) + " MB" : "unknown"}`
  );
}

function _finalizeError(id, errorMsg) {
  const meta = recordings.get(id);
  if (!meta) return;
  if (meta.status !== "recording") return; // already finalized

  meta.status = "error";
  meta.endTime = Date.now();
  meta.durationMs = meta.endTime - meta.startTime;
  meta.error = errorMsg;

  // Kill the other process if still alive
  try {
    if (meta._ffmpeg && !meta._ffmpeg.killed) meta._ffmpeg.kill();
  } catch (e) {}
  try {
    if (meta._adb && !meta._adb.killed) meta._adb.kill();
  } catch (e) {}

  console.error(`[recorder ${id}] Error: ${errorMsg}`);
}

function _publicMeta(meta) {
  return {
    id: meta.id,
    sessionId: meta.sessionId,
    filename: meta.filename,
    status: meta.status,
    startTime: meta.startTime,
    endTime: meta.endTime,
    durationMs: meta.durationMs,
    fileSizeBytes: meta.fileSizeBytes,
    error: meta.error,
  };
}

module.exports = {
  startRecording,
  stopRecording,
  stopAllRecordings,
  getRecording,
  listRecordings,
  getDownloadPath,
  isValidId,
};
