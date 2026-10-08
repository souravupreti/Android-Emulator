function setupControls(video, sendMessage) {
  let swipeStart = null;

  video.addEventListener("click", (event) => {
    video.focus();
    const rect = video.getBoundingClientRect();

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const videoX = x * (video.videoWidth / rect.width);
    const videoY = y * (video.videoHeight / rect.height);

    console.log("Browser tap:", videoX, videoY);

    sendMessage({
      type: "tap",
      x: videoX,
      y: videoY,
    });
  });

  video.addEventListener("pointerdown", (event) => {
    const rect = video.getBoundingClientRect();

    swipeStart = {
      x:
        (event.clientX - rect.left) *
        (video.videoWidth / rect.width),

      y:
        (event.clientY - rect.top) *
        (video.videoHeight / rect.height),

      time: Date.now(),
    };

    video.setPointerCapture(event.pointerId);
  });

  video.addEventListener("keydown", (event) => {
    event.preventDefault();

    if (event.key === "Backspace" || event.key === "Enter") {
      sendMessage({
        type: "key",
        key: event.key,
      });

      console.log("Key sent:", event.key);
      return;
    }

    if (event.key.length === 1) {
      sendMessage({
        type: "text",
        text: event.key,
      });

      console.log("Text sent:", event.key);
    }
  });

  video.addEventListener("pointerup", (event) => {
    if (!swipeStart) {
      return;
    }

    const rect = video.getBoundingClientRect();

    const endX =
      (event.clientX - rect.left) *
      (video.videoWidth / rect.width);

    const endY =
      (event.clientY - rect.top) *
      (video.videoHeight / rect.height);

    const duration = Math.max(
      100,
      Math.min(1000, Date.now() - swipeStart.time)
    );

    const distance = Math.hypot(
      endX - swipeStart.x,
      endY - swipeStart.y
    );

    console.log(
      "Swipe:",
      swipeStart.x,
      swipeStart.y,
      "->",
      endX,
      endY,
      "distance:",
      distance
    );

    if (distance > 30) {
      sendMessage({
        type: "swipe",
        startX: swipeStart.x,
        startY: swipeStart.y,
        endX: endX,
        endY: endY,
        duration: duration,
      });
    }

    swipeStart = null;
  });
}

window.setupControls = setupControls;
