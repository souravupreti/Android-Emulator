const { execFile, spawn } = require("child_process");

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

function tap(x, y) {
  const tapProc = spawn("adb", [
    "shell",
    "input",
    "tap",
    String(x),
    String(y),
  ]);

  tapProc.on("error", (error) => {
    console.error("ADB tap error:", error);
  });
}

function swipe(startX, startY, endX, endY, duration = 300) {
  const swipeProc = spawn("adb", [
    "shell",
    "input",
    "swipe",
    String(startX),
    String(startY),
    String(endX),
    String(endY),
    String(duration),
  ]);

  swipeProc.on("error", (error) => {
    console.error("ADB swipe error:", error);
  });
}

function sendText(text) {
  const str = String(text);
  // ADB uses %s for spaces
  const adbText = str.replace(/ /g, "%s");

  console.log(`Text received: "${str}"`);

  const inputProc = spawn("adb", [
    "shell",
    "input",
    "text",
    adbText,
  ]);

  inputProc.on("error", (error) => {
    console.error("ADB text error:", error);
  });
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

    const keyProc = spawn("adb", [
      "shell",
      "input",
      "keyevent",
      keyCode,
    ]);

    keyProc.on("error", (error) => {
      console.error("ADB key error:", error);
    });
  }
}

module.exports = {
  getAndroidResolution,
  tap,
  swipe,
  sendText,
  sendKey,
};
