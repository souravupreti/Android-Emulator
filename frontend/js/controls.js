function setupControls(video, sendMessage) {
  let swipeStart = null;
  let lastSwipeTime = 0;

  function dispatchInput(msg) {
    // Attach telemetry identifier and timestamp
    msg.requestId = "inp_" + Math.random().toString(36).slice(2, 9);
    msg.clientTimestamp = Date.now();

    if (window.latencyManager && typeof window.latencyManager.recordInputDispatch === "function") {
      window.latencyManager.recordInputDispatch(msg);
    }

    sendMessage(msg);
  }

  // Expose dispatchInput globally for testing and probes
  window.sendControlMessage = dispatchInput;

  video.addEventListener("click", (event) => {
    // If a swipe/drag occurred recently (< 450ms), suppress the synthetic click event
    if (Date.now() - lastSwipeTime < 450) {
      console.log("Suppressed phantom tap after swipe");
      return;
    }

    video.focus();
    const rect = video.getBoundingClientRect();

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const videoX = x * (video.videoWidth / rect.width);
    const videoY = y * (video.videoHeight / rect.height);

    console.log("Browser tap:", videoX, videoY);

    dispatchInput({
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

    try {
      video.setPointerCapture(event.pointerId);
    } catch (e) {}
  });

  video.addEventListener("keydown", (event) => {
    event.preventDefault();

    if (event.key === "Backspace" || event.key === "Enter") {
      dispatchInput({
        type: "key",
        key: event.key,
      });

      console.log("Key sent:", event.key);
      return;
    }

    if (event.key.length === 1) {
      dispatchInput({
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

    const elapsed = Date.now() - swipeStart.time;

    // In Android OS, a duration > 400ms is interpreted as a long-press drag.
    // A natural fling/swipe requires a fast 150ms-300ms duration.
    const duration = Math.min(300, Math.max(150, Math.round(elapsed * 0.35)));

    const distance = Math.hypot(
      endX - swipeStart.x,
      endY - swipeStart.y
    );

    console.log(
      "Pointerup distance:",
      distance.toFixed(1),
      "elapsed:",
      elapsed,
      "ms"
    );

    if (distance > 20) {
      lastSwipeTime = Date.now();

      console.log(
        "Swipe dispatched:",
        swipeStart.x.toFixed(1),
        swipeStart.y.toFixed(1),
        "->",
        endX.toFixed(1),
        endY.toFixed(1),
        `(${duration}ms)`
      );

      dispatchInput({
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

  video.addEventListener("pointercancel", () => {
    swipeStart = null;
  });

  // Mouse wheel scroll support: Translates mouse wheel into natural Android vertical swipe
  let wheelThrottle = 0;
  video.addEventListener("wheel", (event) => {
    event.preventDefault();
    const now = Date.now();
    if (now - wheelThrottle < 280) return;
    wheelThrottle = now;

    const midX = (video.videoWidth || 540) / 2;
    const midY = (video.videoHeight || 1200) / 2;
    const scrollDelta = 220; // swipe distance in video pixel space

    // Scrolling down (deltaY > 0) -> swipe UP (content moves up)
    // Scrolling up (deltaY < 0) -> swipe DOWN (content moves down)
    const startY = event.deltaY > 0 ? midY + scrollDelta / 2 : midY - scrollDelta / 2;
    const endY = event.deltaY > 0 ? midY - scrollDelta / 2 : midY + scrollDelta / 2;

    console.log(`Wheel scroll: deltaY=${event.deltaY} -> swipe(${midX}, ${startY}) -> (${midX}, ${endY})`);

    dispatchInput({
      type: "swipe",
      startX: midX,
      startY: startY,
      endX: midX,
      endY: endY,
      duration: 200,
    });
  }, { passive: false });
}

window.setupControls = setupControls;


