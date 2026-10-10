const { execFile, spawn } = require("child_process");

let cachedResolution = null;

function getAndroidResolution(forceRefresh = false) {
  if (cachedResolution && !forceRefresh) {
    return Promise.resolve(cachedResolution);
  }

  return new Promise((resolve) => {
    execFile("adb", ["shell", "wm", "size"], (error, stdout) => {
      if (error) {
        console.warn("Could not query adb wm size, using fallback 540x1200:", error.message);
        const fallback = { width: 540, height: 1200 };
        return resolve(fallback);
      }

      const match = stdout.match(/Physical size:\s*(\d+)x(\d+)/);

      if (!match) {
        console.warn("Could not parse Android resolution, using fallback 540x1200");
        const fallback = { width: 540, height: 1200 };
        return resolve(fallback);
      }

      cachedResolution = {
        width: Number(match[1]),
        height: Number(match[2]),
      };

      console.log(`Detected Android physical resolution: ${cachedResolution.width}x${cachedResolution.height}`);
      resolve(cachedResolution);
    });
  });
}

function runAdbInput(args) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const proc = spawn("adb", ["shell", "input", ...args]);

    proc.on("error", (error) => {
      console.error(`ADB input error (${args.join(" ")}):`, error);
      resolve({
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
        dispatchedAt: startTime,
      });
    });

    proc.on("close", (code) => {
      resolve({
        success: code === 0,
        code,
        duration: Date.now() - startTime,
        dispatchedAt: startTime,
      });
    });
  });
}

function tap(x, y) {
  return runAdbInput(["tap", String(x), String(y)]);
}

function swipe(startX, startY, endX, endY, duration = 300) {
  return runAdbInput([
    "swipe",
    String(startX),
    String(startY),
    String(endX),
    String(endY),
    String(duration),
  ]);
}

function sendText(text) {
  const str = String(text);
  // ADB uses %s for spaces
  const adbText = str.replace(/ /g, "%s");

  console.log(`Text received: "${str}"`);
  return runAdbInput(["text", adbText]);
}

function sendKey(key) {
  let keyCode = null;

  if (key === "Backspace") {
    keyCode = "KEYCODE_DEL";
  }

  if (key === "Enter") {
    keyCode = "KEYCODE_ENTER";
  }

  if (keyCode) {
    console.log(`Key received: ${key}`);
    return runAdbInput(["keyevent", keyCode]);
  }

  return Promise.resolve({ success: false, reason: "Unsupported key", duration: 0 });
}

module.exports = {
  getAndroidResolution,
  tap,
  swipe,
  sendText,
  sendKey,
};

