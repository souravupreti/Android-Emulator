/**
 * clipboard.js — Two-Way Clipboard Frontend Manager
 *
 * Provides UI controls and API integration for:
 *   1. Sending PC/browser text into the Android device
 *   2. Reading the Android device clipboard into the browser
 *   3. Browser Clipboard API integration with manual-copy fallbacks
 */

(function () {
  "use strict";

  // ————————————————————————————————————————————————
  // State
  // ————————————————————————————————————————————————
  let _sessionId = null;
  let _sendSocketMessage = null;

  // DOM Elements
  let _sendInputEl, _btnSend, _btnPasteSend, _sendCountEl;
  let _androidTextEl, _btnRead, _btnCopyPc, _statusEl;

  // ————————————————————————————————————————————————
  // Public API
  // ————————————————————————————————————————————————

  function setSessionId(id) {
    _sessionId = id;
    _updateControlsState();
  }

  function setSocketSender(sender) {
    _sendSocketMessage = sender;
  }

  function init(containerId, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (options.sendMessage) {
      _sendSocketMessage = options.sendMessage;
    }

    container.innerHTML = _buildHTML();

    _sendInputEl   = document.getElementById("clip-send-input");
    _btnSend       = document.getElementById("clip-btn-send");
    _btnPasteSend  = document.getElementById("clip-btn-paste-send");
    _sendCountEl   = document.getElementById("clip-send-count");
    _androidTextEl = document.getElementById("clip-android-text");
    _btnRead       = document.getElementById("clip-btn-read");
    _btnCopyPc     = document.getElementById("clip-btn-copy-pc");
    _statusEl      = document.getElementById("clip-status");

    // Event listeners
    _btnSend.addEventListener("click", _handleSend);
    _btnPasteSend.addEventListener("click", _handlePasteAndSend);
    _btnRead.addEventListener("click", _handleReadFromAndroid);
    _btnCopyPc.addEventListener("click", _handleCopyToPc);

    _sendInputEl.addEventListener("input", _handleInputChange);

    _updateControlsState();
  }

  /**
   * Handle incoming WebSocket clipboard messages from the backend.
   */
  function handleSocketMessage(data) {
    if (data.type === "clipboard_ack") {
      if (data.success) {
        _setStatus(`Sent ${data.charactersSent || ""} chars to Android`, "ok");
      } else {
        _setStatus(`Send failed: ${data.error || "unknown error"}`, "error");
      }
      _btnSend.disabled = false;
      return true;
    }

    if (data.type === "clipboard_data") {
      if (data.success) {
        _displayAndroidText(data.text || "");
        if (data.text) {
          _setStatus(`Retrieved ${data.text.length} chars from Android`, "ok");
        } else {
          _setStatus("Android clipboard is empty", "info");
        }
      } else {
        _setStatus(`Read error: ${data.error || "could not query clipboard"}`, "error");
      }
      _btnRead.disabled = false;
      return true;
    }

    return false;
  }

  // ————————————————————————————————————————————————
  // Action Handlers
  // ————————————————————————————————————————————————

  async function _handleSend() {
    const text = _sendInputEl.value;
    if (!text) {
      _setStatus("Please enter text to send", "warn");
      return;
    }

    if (!_sessionId) {
      _setStatus("Waiting for active session...", "warn");
      return;
    }

    _btnSend.disabled = true;
    _setStatus("Sending to Android...", "info");

    try {
      const res = await fetch("/api/clipboard/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: _sessionId, text }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        _setStatus(`Send failed: ${data.error || res.statusText}`, "error");
      } else {
        _setStatus(`Sent ${data.charactersSent} characters to Android`, "ok");
      }
    } catch (err) {
      _setStatus(`Network error: ${err.message}`, "error");
    } finally {
      _btnSend.disabled = false;
    }
  }

  async function _handlePasteAndSend() {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      _setStatus("Browser clipboard reading not supported (requires HTTPS / localhost)", "warn");
      _sendInputEl.focus();
      return;
    }

    try {
      _setStatus("Reading PC clipboard...", "info");
      const text = await navigator.clipboard.readText();
      if (!text) {
        _setStatus("PC clipboard is empty", "warn");
        return;
      }

      _sendInputEl.value = text;
      _handleInputChange();
      await _handleSend();
    } catch (err) {
      _setStatus("Clipboard access denied. Paste into the box manually.", "warn");
      _sendInputEl.focus();
    }
  }

  async function _handleReadFromAndroid() {
    _btnRead.disabled = true;
    _setStatus("Reading from Android...", "info");

    try {
      // First trigger a copy shortcut so current selection is copied if applicable
      const res = await fetch("/api/clipboard/trigger-copy", { method: "POST" });
      const data = await res.json();

      if (!res.ok || !data.success) {
        _setStatus(`Read failed: ${data.error || res.statusText}`, "error");
        return;
      }

      const text = data.text || "";
      _displayAndroidText(text);

      if (text) {
        _setStatus(`Retrieved ${text.length} chars from Android`, "ok");
      } else {
        _setStatus("No text on Android clipboard. Copy text on Android first.", "info");
      }
    } catch (err) {
      _setStatus(`Network error: ${err.message}`, "error");
    } finally {
      _btnRead.disabled = false;
    }
  }

  async function _handleCopyToPc() {
    const text = _androidTextEl.value;
    if (!text) {
      _setStatus("Nothing to copy", "warn");
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        _setStatus("Copied to PC clipboard!", "ok");
        return;
      } catch (e) {
        // Fallback below
      }
    }

    // Fallback: select text in textarea for manual copy
    _androidTextEl.select();
    try {
      document.execCommand("copy");
      _setStatus("Copied to PC clipboard!", "ok");
    } catch (e) {
      _setStatus("Press Ctrl+C to copy selected text", "info");
    }
  }

  // ————————————————————————————————————————————————
  // UI Helpers
  // ————————————————————————————————————————————————

  function _displayAndroidText(text) {
    if (_androidTextEl) {
      _androidTextEl.value = text;
    }
    if (_btnCopyPc) {
      _btnCopyPc.disabled = !text;
    }
  }

  function _handleInputChange() {
    const count = _sendInputEl ? _sendInputEl.value.length : 0;
    if (_sendCountEl) {
      _sendCountEl.textContent = `${count} chars`;
    }
    if (_btnSend) {
      _btnSend.disabled = count === 0 || !_sessionId;
    }
  }

  function _updateControlsState() {
    const count = _sendInputEl ? _sendInputEl.value.length : 0;
    if (_btnSend) _btnSend.disabled = count === 0 || !_sessionId;
    if (_btnPasteSend) _btnPasteSend.disabled = !_sessionId;
    if (_btnRead) _btnRead.disabled = !_sessionId;
  }

  function _setStatus(text, type = "info") {
    if (!_statusEl) return;
    _statusEl.textContent = text;
    _statusEl.className = `clip-status-text clip-status-${type}`;
  }

  function _buildHTML() {
    return `
      <div class="clipboard-panel">
        <div class="clipboard-header">
          <span class="clipboard-title">Two-Way Clipboard</span>
          <span id="clip-send-count" class="clip-char-count">0 chars</span>
        </div>

        <!-- Section 1: PC -> Android -->
        <div class="clip-section">
          <div class="clip-section-title">Send to Android</div>
          <textarea
            id="clip-send-input"
            class="clip-textarea"
            placeholder="Type or paste text to send into Android..."
            rows="2"
            maxlength="10000"
          ></textarea>
          <div class="clip-actions">
            <button id="clip-btn-send" class="btn btn-primary btn-sm" disabled>
              ➤ Send to Android
            </button>
            <button id="clip-btn-paste-send" class="btn btn-outline btn-sm" disabled title="Paste current PC clipboard and send directly">
              📋 Paste & Send
            </button>
          </div>
        </div>

        <!-- Section 2: Android -> PC -->
        <div class="clip-section">
          <div class="clip-section-title">Copy from Android</div>
          <textarea
            id="clip-android-text"
            class="clip-textarea clip-readonly"
            placeholder="Android clipboard text will appear here..."
            rows="2"
            readonly
          ></textarea>
          <div class="clip-actions">
            <button id="clip-btn-read" class="btn btn-secondary btn-sm" disabled>
              ⟳ Copy from Android
            </button>
            <button id="clip-btn-copy-pc" class="btn btn-outline btn-sm" disabled>
              📋 Copy to PC
            </button>
          </div>
        </div>

        <div id="clip-status" class="clip-status-text clip-status-info">
          Clipboard ready
        </div>
      </div>`;
  }

  // Export module
  window.ClipboardManager = {
    init,
    setSessionId,
    setSocketSender,
    handleSocketMessage,
  };
})();
