const {
  getAndroidResolution,
  tap,
  swipe,
  sendText,
  sendKey,
} = require("./android");

async function handleTap(data) {
  try {
    const android = await getAndroidResolution();

    const x = Math.round(data.x * (android.width / 540));
    const y = Math.round(data.y * (android.height / 1200));

    console.log(
      `Tap: video(${data.x.toFixed(1)}, ${data.y.toFixed(1)}) -> Android(${x}, ${y})`
    );

    tap(x, y);
  } catch (error) {
    console.error("Tap mapping error:", error);
  }
}

async function handleSwipe(data) {
  try {
    const android = await getAndroidResolution();

    const startX = Math.round(data.startX * (android.width / 540));
    const startY = Math.round(data.startY * (android.height / 1200));
    const endX = Math.round(data.endX * (android.width / 540));
    const endY = Math.round(data.endY * (android.height / 1200));
    const duration = Math.round(data.duration || 300);

    console.log(
      `Swipe: (${startX}, ${startY}) -> (${endX}, ${endY}) ${duration}ms`
    );

    swipe(startX, startY, endX, endY, duration);
  } catch (error) {
    console.error("Swipe mapping error:", error);
  }
}

function handleText(data) {
  try {
    sendText(data.text);
  } catch (error) {
    console.error("Text input error:", error);
  }
}

function handleKey(data) {
  try {
    sendKey(data.key);
  } catch (error) {
    console.error("Key event error:", error);
  }
}

async function handleInputMessage(data) {
  if (data.type === "tap") {
    await handleTap(data);
    return true;
  }

  if (data.type === "swipe") {
    await handleSwipe(data);
    return true;
  }

  if (data.type === "text") {
    handleText(data);
    return true;
  }

  if (data.type === "key") {
    handleKey(data);
    return true;
  }

  return false;
}

module.exports = {
  handleTap,
  handleSwipe,
  handleText,
  handleKey,
  handleInputMessage,
};
