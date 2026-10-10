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

    return await tap(x, y);
  } catch (error) {
    console.error("Tap mapping error:", error);
    return { success: false, error: error.message };
  }
}

async function handleSwipe(data) {
  try {
    const android = await getAndroidResolution();

    let startX = Math.round(data.startX * (android.width / 540));
    let startY = Math.round(data.startY * (android.height / 1200));
    let endX = Math.round(data.endX * (android.width / 540));
    let endY = Math.round(data.endY * (android.height / 1200));

    // Clamp coordinates slightly within screen boundaries to avoid Android system gesture bars
    startX = Math.max(10, Math.min(android.width - 10, startX));
    endX = Math.max(10, Math.min(android.width - 10, endX));
    startY = Math.max(20, Math.min(android.height - 20, startY));
    endY = Math.max(20, Math.min(android.height - 20, endY));

    // Android input swipe requires 150ms-350ms for a natural fling/scroll
    const duration = Math.min(350, Math.max(150, Math.round(data.duration || 220)));

    console.log(
      `Swipe: (${startX}, ${startY}) -> (${endX}, ${endY}) ${duration}ms`
    );

    return await swipe(startX, startY, endX, endY, duration);
  } catch (error) {
    console.error("Swipe mapping error:", error);
    return { success: false, error: error.message };
  }
}

async function handleText(data) {
  try {
    return await sendText(data.text);
  } catch (error) {
    console.error("Text input error:", error);
    return { success: false, error: error.message };
  }
}

async function handleKey(data) {
  try {
    return await sendKey(data.key);
  } catch (error) {
    console.error("Key event error:", error);
    return { success: false, error: error.message };
  }
}

async function handleInputMessage(data, socket = null) {
  const receiveTime = Date.now();
  let result = null;

  if (data.type === "tap") {
    result = await handleTap(data);
  } else if (data.type === "swipe") {
    result = await handleSwipe(data);
  } else if (data.type === "text") {
    result = await handleText(data);
  } else if (data.type === "key") {
    result = await handleKey(data);
  } else {
    return false;
  }

  // Send input acknowledgement with timing breakdown if client requested it or provided requestId/clientTimestamp
  if (socket && socket.readyState === 1 && (data.requestId || data.clientTimestamp)) {
    try {
      socket.send(
        JSON.stringify({
          type: "input_ack",
          requestId: data.requestId,
          action: data.type,
          clientTimestamp: data.clientTimestamp,
          serverReceivedAt: receiveTime,
          serverDispatchedAt: Date.now(),
          adbDuration: result ? result.duration : null,
          success: result ? result.success : true,
        })
      );
    } catch (err) {
      console.error("Error sending input_ack:", err);
    }
  }

  return true;
}

module.exports = {
  handleTap,
  handleSwipe,
  handleText,
  handleKey,
  handleInputMessage,
};

