/**
 * clipboard.js — Two-way Android Clipboard Integration Module
 *
 * Provides bidirectional clipboard synchronization between the browser and Android emulator:
 *   1. Send to Android: Injects text into active Android input fields via escaped ADB input
 *   2. Read from Android: Retrieves text from Android system clipboard via IPC parcel parsing
 *
 * Security & Reliability:
 *   - No shell-injection: Uses execFile without shell invocation.
 *   - Shell-escaping: Escapes Android sh metacharacters.
 *   - Private data protection: Clipboard text is NEVER written to server logs.
 *   - Input size limit: Max 10,000 characters per transfer.
 */

const { execFile } = require("child_process");

const MAX_CLIPBOARD_TEXT_LENGTH = 10000;

// Internal Android system strings that appear in parcel headers to ignore
const SYSTEM_IGNORED_STRINGS = new Set([
  "host clipboard",
  "BNDL",
  "text/plain",
  "text/html",
  "text/uri-list",
]);

/**
 * Escapes characters for Android shell `input text`.
 * In Android sh, metacharacters need backslash escaping and spaces need %s.
 */
function escapeForAdbInput(text) {
  let escaped = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === " ") {
      escaped += "%s";
    } else if (char === "\t") {
      escaped += "%s%s%s%s";
    } else if (
      char === "\\" || char === '"' || char === "'" || char === "`" ||
      char === "$" || char === "&" || char === "|" || char === ";" ||
      char === "<" || char === ">" || char === "(" || char === ")" ||
      char === "*" || char === "?" || char === "~" || char === "#" ||
      char === "!" || char === "^" || char === "%"
    ) {
      escaped += "\\" + char;
    } else {
      escaped += char;
    }
  }
  return escaped;
}

/**
 * Sends text from the browser to the active Android device.
 * Splits on newlines and dispatches ADB keyevents for lines/Enter.
 *
 * @param {string} text - Untrusted text from user
 * @returns {Promise<{ success: boolean, charactersSent?: number, error?: string }>}
 */
async function sendTextToAndroid(text) {
  if (typeof text !== "string") {
    return { success: false, error: "Invalid text payload: expected string" };
  }

  if (text.length === 0) {
    return { success: false, error: "Text is empty" };
  }

  if (text.length > MAX_CLIPBOARD_TEXT_LENGTH) {
    return {
      success: false,
      error: `Text exceeds maximum allowed length (${MAX_CLIPBOARD_TEXT_LENGTH} characters)`,
    };
  }

  // Split text by lines to handle newlines via KEYCODE_ENTER (66)
  const lines = text.split(/\r?\n/);
  let charactersSent = 0;

  try {
    for (let l = 0; l < lines.length; l++) {
      const line = lines[l];

      if (line.length > 0) {
        const escaped = escapeForAdbInput(line);

        await new Promise((resolve, reject) => {
          execFile("adb", ["shell", "input", "text", escaped], (err) => {
            if (err) {
              // If input text failed (e.g. non-ASCII Unicode in line), try sanitized fallback
              return _sendSafeFallback(line)
                .then(resolve)
                .catch(reject);
            }
            resolve();
          });
        });

        charactersSent += line.length;
      }

      // If there are more lines, send KEYCODE_ENTER (66)
      if (l < lines.length - 1) {
        await new Promise((resolve, reject) => {
          execFile("adb", ["shell", "input", "keyevent", "66"], (err) => {
            if (err) return reject(err);
            resolve();
          });
        });
        charactersSent += 1;
      }
    }

    return {
      success: true,
      charactersSent,
      method: "adb_input_text",
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to send text to Android: ${err.message}`,
    };
  }
}

/**
 * Fallback sender for strings containing characters that throw NPE in ADB input text.
 * Sanitizes characters to nearest ASCII representation.
 */
function _sendSafeFallback(text) {
  return new Promise((resolve, reject) => {
    // Transliterate common unicode or strip unsupported control codes
    const ascii = text.normalize("NFKD").replace(/[^\x00-\x7F]/g, "");
    if (!ascii) return resolve();

    const escaped = escapeForAdbInput(ascii);
    execFile("adb", ["shell", "input", "text", escaped], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

/**
 * Parses raw hex Parcel dump from `adb shell service call clipboard 4`
 * and extracts any textual content stored in the primary ClipData.
 */
function parseClipboardParcel(rawOutput) {
  if (!rawOutput || typeof rawOutput !== "string") return "";

  const lines = rawOutput.split("\n");
  const words = [];

  for (const line of lines) {
    const match = line.match(/0x[0-9a-fA-F]+:\s+((?:[0-9a-fA-F]{8}\s*)+)/);
    if (match) {
      const parts = match[1].trim().split(/\s+/);
      for (const part of parts) {
        if (part.length === 8) {
          words.push(parseInt(part, 16));
        }
      }
    }
  }

  if (words.length === 0) return "";

  // Check exception code at word 0
  if (words[0] !== 0) {
    return "";
  }

  // Convert to raw byte buffer for unified UTF-8 and UTF-16 decoding
  const buf = Buffer.alloc(words.length * 4);
  for (let i = 0; i < words.length; i++) {
    buf.writeUInt32LE(words[i], i * 4);
  }

  const candidates = [];

  // 1. Scan UTF-16 strings
  let curUtf16 = "";
  for (let i = 0; i < buf.length - 1; i += 2) {
    const code = buf.readUInt16LE(i);
    if (code >= 32 && code <= 0xd7ff) {
      curUtf16 += String.fromCharCode(code);
    } else {
      if (curUtf16.trim().length >= 1) {
        candidates.push(curUtf16.trim());
      }
      curUtf16 = "";
    }
  }
  if (curUtf16.trim().length >= 1) {
    candidates.push(curUtf16.trim());
  }

  // 2. Scan UTF-8 strings
  let curUtf8 = "";
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    if (byte >= 32 && byte <= 126) {
      curUtf8 += String.fromCharCode(byte);
    } else {
      if (curUtf8.trim().length >= 1) {
        candidates.push(curUtf8.trim());
      }
      curUtf8 = "";
    }
  }
  if (curUtf8.trim().length >= 1) {
    candidates.push(curUtf8.trim());
  }

  // Filter out system tags and package identifiers
  const filtered = candidates.filter((s) => {
    if (!s || s.length < 1) return false;
    if (SYSTEM_IGNORED_STRINGS.has(s)) return false;
    if (s.startsWith("com.android.")) return false;
    if (s.startsWith("android.")) return false;
    return true;
  });

  // The actual clipboard payload is in the Item segment (end of candidate list)
  return filtered.length > 0 ? filtered[filtered.length - 1] : "";
}

/**
 * Reads text from the Android system clipboard.
 *
 * @returns {Promise<{ success: boolean, text: string, hasContent: boolean, error?: string }>}
 */
function getAndroidClipboard() {
  return new Promise((resolve) => {
    // Transaction 4: getPrimaryClip(callingPackage, userId, deviceId)
    execFile(
      "adb",
      ["shell", "service", "call", "clipboard", "4", "s16", "com.android.shell", "i32", "0", "i32", "0"],
      (err, stdout) => {
        if (err) {
          return resolve({
            success: false,
            text: "",
            hasContent: false,
            error: `ADB error querying clipboard: ${err.message}`,
          });
        }

        const text = parseClipboardParcel(stdout);
        resolve({
          success: true,
          text: text || "",
          hasContent: Boolean(text && text.length > 0),
        });
      }
    );
  });
}

/**
 * Triggers a copy keycombination on the Android device (Ctrl+C).
 */
function triggerAndroidCopy() {
  return new Promise((resolve) => {
    // Key combination: KEYCODE_CTRL_LEFT (113) + KEYCODE_C (31)
    execFile("adb", ["shell", "input", "keycombination", "113", "31"], (err) => {
      if (err) {
        // Fallback to keyevent KEYCODE_COPY (277)
        execFile("adb", ["shell", "input", "keyevent", "277"], () => resolve());
        return;
      }
      resolve();
    });
  });
}

/**
 * Triggers a paste keycombination on the Android device (Ctrl+V).
 */
function triggerAndroidPaste() {
  return new Promise((resolve) => {
    // Key combination: KEYCODE_CTRL_LEFT (113) + KEYCODE_V (50)
    execFile("adb", ["shell", "input", "keycombination", "113", "50"], (err) => {
      if (err) {
        // Fallback to keyevent KEYCODE_PASTE (279)
        execFile("adb", ["shell", "input", "keyevent", "279"], () => resolve());
        return;
      }
      resolve();
    });
  });
}

module.exports = {
  sendTextToAndroid,
  getAndroidClipboard,
  triggerAndroidCopy,
  triggerAndroidPaste,
  escapeForAdbInput,
  parseClipboardParcel,
  MAX_CLIPBOARD_TEXT_LENGTH,
};
