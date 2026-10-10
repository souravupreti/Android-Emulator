/**
 * recording.js — Session recording UI module
 *
 * Provides Start/Stop recording controls, an elapsed-time counter,
 * and a history list showing all recordings with download links.
 * Communicates with the backend recording REST API.
 */

(function () {
  "use strict";

  // ————————————————————————————————————————————————
  // State
  // ————————————————————————————————————————————————
  let _sessionId = null;      // Assigned by server on WebSocket open
  let _activeRecordingId = null;
  let _timerInterval = null;
  let _timerStartMs = null;

  // ————————————————————————————————————————————————
  // DOM refs (populated in init)
  // ————————————————————————————————————————————————
  let _btnStart, _btnStop, _statusEl, _timerEl, _listEl, _panelEl;

  // ————————————————————————————————————————————————
  // Public API
  // ————————————————————————————————————————————————

  /**
   * Call this once the WebSocket session ID has been received from the server.
   * @param {string} id  Session ID sent by the server in { type: "session_id", sessionId }
   */
  function setSessionId(id) {
    _sessionId = id;
    if (_btnStart) _btnStart.disabled = false;
  }

  /**
   * Initialise the recording panel, attaching it to containerId.
   * @param {string} containerId  ID of the DOM element to mount into
   */
  function init(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = _buildHTML();

    _panelEl  = container.querySelector(".recording-panel");
    _btnStart = document.getElementById("rec-btn-start");
    _btnStop  = document.getElementById("rec-btn-stop");
    _statusEl = document.getElementById("rec-status");
    _timerEl  = document.getElementById("rec-timer");
    _listEl   = document.getElementById("rec-history-list");

    _btnStart.addEventListener("click", _handleStart);
    _btnStop.addEventListener("click",  _handleStop);

    // Disable start until we have a session ID
    _btnStart.disabled = !_sessionId;

    // Load existing recordings immediately
    _refreshList();
  }

  // ————————————————————————————————————————————————
  // Actions
  // ————————————————————————————————————————————————

  async function _handleStart() {
    if (!_sessionId) {
      _setStatus("Waiting for session ID…", "warn");
      return;
    }
    if (_activeRecordingId) {
      _setStatus("A recording is already active.", "warn");
      return;
    }

    _btnStart.disabled = true;
    _setStatus("Starting…", "info");

    try {
      const res = await fetch("/api/recordings/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: _sessionId }),
      });
      const data = await res.json();

      if (!res.ok) {
        _setStatus("Error: " + (data.error || res.statusText), "error");
        _btnStart.disabled = false;
        return;
      }

      _activeRecordingId = data.id;
      _timerStartMs = data.startTime;
      _startTimer();
      _setRecordingActive(true);
      _setStatus("● Recording", "recording");
      _refreshList();
    } catch (err) {
      _setStatus("Network error: " + err.message, "error");
      _btnStart.disabled = false;
    }
  }

  async function _handleStop() {
    if (!_activeRecordingId) return;

    _btnStop.disabled = true;
    _setStatus("Stopping…", "info");

    const id = _activeRecordingId;

    try {
      const res = await fetch(`/api/recordings/${id}/stop`, { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        _setStatus("Error: " + (data.error || res.statusText), "error");
        _btnStop.disabled = false;
        return;
      }

      _activeRecordingId = null;
      _stopTimer();
      _setRecordingActive(false);
      _setStatus("Finalizing…", "info");

      // Poll until FFmpeg closes and status flips to "completed" or "error"
      _pollUntilFinalized(id);
    } catch (err) {
      _setStatus("Network error: " + err.message, "error");
      _btnStop.disabled = false;
    }
  }

  // ————————————————————————————————————————————————
  // Polling for finalization
  // ————————————————————————————————————————————————

  async function _pollUntilFinalized(id, attempts = 0) {
    const MAX_ATTEMPTS = 30; // 30 × 500 ms = 15 s
    if (attempts > MAX_ATTEMPTS) {
      _setStatus("Timeout waiting for recording to finalize.", "warn");
      _refreshList();
      return;
    }

    try {
      const res = await fetch(`/api/recordings/${id}`);
      if (!res.ok) {
        await _sleep(500);
        return _pollUntilFinalized(id, attempts + 1);
      }
      const data = await res.json();

      if (data.status === "recording") {
        await _sleep(500);
        return _pollUntilFinalized(id, attempts + 1);
      }

      if (data.status === "completed") {
        const dur = data.durationMs ? _formatDuration(data.durationMs) : "?";
        const size = data.fileSizeBytes ? _formatBytes(data.fileSizeBytes) : "?";
        _setStatus(`Saved — ${dur} / ${size}`, "ok");
      } else {
        _setStatus("Recording error: " + (data.error || "unknown"), "error");
      }

      _refreshList();
    } catch (err) {
      await _sleep(500);
      _pollUntilFinalized(id, attempts + 1);
    }
  }

  // ————————————————————————————————————————————————
  // Recordings list
  // ————————————————————————————————————————————————

  async function _refreshList() {
    if (!_listEl) return;
    try {
      const res = await fetch("/api/recordings");
      if (!res.ok) return;
      const recordings = await res.json();
      _renderList(recordings);
    } catch (e) {
      // silently ignore — list is non-critical
    }
  }

  function _renderList(recordings) {
    if (!_listEl) return;

    if (!recordings || recordings.length === 0) {
      _listEl.innerHTML = `<li class="rec-empty">No recordings yet.</li>`;
      return;
    }

    _listEl.innerHTML = recordings.map((r) => {
      const date = new Date(r.startTime).toLocaleTimeString();
      const dur  = r.durationMs  ? _formatDuration(r.durationMs)  : "—";
      const size = r.fileSizeBytes ? _formatBytes(r.fileSizeBytes) : "—";

      const statusClass = {
        recording: "rec-status-active",
        completed: "rec-status-done",
        error:     "rec-status-error",
      }[r.status] || "";

      const statusLabel = {
        recording: "● REC",
        completed: "✓ Done",
        error:     "✕ Error",
      }[r.status] || r.status;

      const downloadBtn = r.status === "completed"
        ? `<a class="btn btn-outline btn-xs rec-download-btn"
              href="/api/recordings/${r.id}/download"
              download="recording_${r.id}.mp4">↓ Download</a>`
        : "";

      return `
        <li class="rec-item" data-id="${r.id}">
          <div class="rec-item-row">
            <span class="rec-item-id">${r.id.slice(0, 8)}…</span>
            <span class="rec-item-badge ${statusClass}">${statusLabel}</span>
          </div>
          <div class="rec-item-row rec-item-meta">
            <span>🕐 ${date}</span>
            <span>⏱ ${dur}</span>
            <span>💾 ${size}</span>
          </div>
          ${r.status === "error" && r.error
            ? `<div class="rec-item-error">${r.error}</div>`
            : ""}
          ${downloadBtn}
        </li>`;
    }).join("");
  }

  // ————————————————————————————————————————————————
  // Timer
  // ————————————————————————————————————————————————

  function _startTimer() {
    _stopTimer();
    _timerInterval = setInterval(() => {
      if (!_timerEl || !_timerStartMs) return;
      const elapsed = Date.now() - _timerStartMs;
      _timerEl.textContent = _formatDuration(elapsed);
    }, 500);
  }

  function _stopTimer() {
    if (_timerInterval) {
      clearInterval(_timerInterval);
      _timerInterval = null;
    }
    if (_timerEl) _timerEl.textContent = "";
  }

  // ————————————————————————————————————————————————
  // UI helpers
  // ————————————————————————————————————————————————

  function _setRecordingActive(active) {
    if (!_btnStart || !_btnStop) return;
    _btnStart.disabled = active;
    _btnStop.disabled  = !active;
    if (_panelEl) {
      _panelEl.classList.toggle("recording-active", active);
    }
  }

  function _setStatus(text, type) {
    if (!_statusEl) return;
    _statusEl.textContent = text;
    _statusEl.className = "rec-status-text rec-status-" + (type || "info");
  }

  function _buildHTML() {
    return `
      <div class="recording-panel">
        <div class="recording-header">
          <span class="recording-title">Session Recording</span>
          <span id="rec-timer" class="rec-timer"></span>
        </div>
        <div class="recording-controls">
          <button id="rec-btn-start" class="btn btn-record" disabled>
            <span class="rec-dot"></span> Start Recording
          </button>
          <button id="rec-btn-stop" class="btn btn-stop-record" disabled>
            ■ Stop
          </button>
        </div>
        <div id="rec-status" class="rec-status-text rec-status-info">
          Waiting for session…
        </div>
        <div class="rec-history">
          <div class="rec-history-label">Recordings</div>
          <ul id="rec-history-list" class="rec-history-list">
            <li class="rec-empty">No recordings yet.</li>
          </ul>
        </div>
      </div>`;
  }

  // ————————————————————————————————————————————————
  // Formatting utilities
  // ————————————————————————————————————————————————

  function _formatDuration(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function _formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
  }

  function _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ————————————————————————————————————————————————
  // Export
  // ————————————————————————————————————————————————

  window.RecordingManager = {
    init,
    setSessionId,
  };
})();
