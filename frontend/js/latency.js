/**
 * HealthTick Latency Measurement & Telemetry Module
 * 
 * Accurately measures:
 * 1. Input Dispatch Latency: Browser input action -> WebSocket -> Backend coordinate mapping -> ADB command dispatch
 * 2. Video Frame Delivery Latency: WebRTC transport, jitter buffer, and frame decode time via getStats()
 * 3. End-to-End Action-to-Visible-Update Latency: Time from user action until visual change is rendered on <video>
 */

class LatencyMetric {
  constructor(name, maxSamples = 50) {
    this.name = name;
    this.maxSamples = maxSamples;
    this.samples = [];
  }

  addSample(value) {
    if (typeof value !== "number" || isNaN(value) || value < 0) return;
    this.samples.push(value);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  clear() {
    this.samples = [];
  }

  getStats() {
    const count = this.samples.length;
    if (count === 0) {
      return { count: 0, min: null, max: null, median: null, mean: null, latest: null };
    }

    const sorted = [...this.samples].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[count - 1];
    const sum = sorted.reduce((acc, val) => acc + val, 0);
    const mean = sum / count;

    let median;
    const mid = Math.floor(count / 2);
    if (count % 2 === 0) {
      median = (sorted[mid - 1] + sorted[mid]) / 2;
    } else {
      median = sorted[mid];
    }

    const latest = this.samples[count - 1];

    return {
      count,
      min: Number(min.toFixed(1)),
      max: Number(max.toFixed(1)),
      median: Number(median.toFixed(1)),
      mean: Number(mean.toFixed(1)),
      latest: Number(latest.toFixed(1)),
    };
  }
}

class LatencyManager {
  constructor() {
    this.inputMetric = new LatencyMetric("Input Dispatch Latency");
    this.videoDeliveryMetric = new LatencyMetric("Video Delivery Latency");
    this.e2eMetric = new LatencyMetric("End-to-End Latency");

    this.pendingInputs = new Map();
    this.statsInterval = null;
    this.videoElement = null;
    this.webrtcClient = null;
    this.isProbingE2E = false;
    this.isObservingE2E = false;

    // WebRTC live telemetry snapshot
    this.webrtcTelemetry = {
      jitterBufferDelay: null,
      decodeTime: null,
      rtt: null,
      fps: null,
      framesReceived: null,
      framesDropped: null,
    };
  }

  init({ videoElement, webrtcClient, hudContainerId }) {
    this.videoElement = videoElement;
    this.webrtcClient = webrtcClient;

    if (hudContainerId) {
      this.renderHUD(hudContainerId);
    }

    this.startWebRTCStatsPolling();
  }

  recordInputDispatch(inputMsg) {
    const { requestId, clientTimestamp, type } = inputMsg;
    if (!requestId) return;

    const startTime = performance.now();
    this.pendingInputs.set(requestId, {
      requestId,
      type,
      clientTimestamp: clientTimestamp || Date.now(),
      startTime,
    });

    // Automatically observe visual screen changes following user actions
    if ((type === "tap" || type === "swipe") && this.videoElement && this.videoElement.readyState >= 2 && !this.isObservingE2E) {
      this.observeE2EUpdate(startTime);
    }
  }

  observeE2EUpdate(startTime) {
    if (this.isObservingE2E || !this.videoElement) return;
    this.isObservingE2E = true;

    try {
      if (!this.diffCanvas) {
        this.diffCanvas = document.createElement("canvas");
        this.diffCanvas.width = 135;
        this.diffCanvas.height = 300;
        this.diffCtx = this.diffCanvas.getContext("2d", { willReadFrequently: true });
      }

      this.diffCtx.drawImage(this.videoElement, 0, 0, 135, 300);
      const baselineData = this.diffCtx.getImageData(0, 0, 135, 300).data;

      const checkNext = () => {
        if (!this.isObservingE2E) return;
        const now = performance.now();

        if (now - startTime > 3000) {
          // Timeout - screen remained static
          this.isObservingE2E = false;
          return;
        }

        this.diffCtx.drawImage(this.videoElement, 0, 0, 135, 300);
        const currentData = this.diffCtx.getImageData(0, 0, 135, 300).data;

        let diffCount = 0;
        const step = 4;
        let sampled = 0;

        for (let i = 0; i < currentData.length; i += 4 * step) {
          const delta =
            Math.abs(currentData[i] - baselineData[i]) +
            Math.abs(currentData[i + 1] - baselineData[i + 1]) +
            Math.abs(currentData[i + 2] - baselineData[i + 2]);
          if (delta > 40) {
            diffCount++;
          }
          sampled++;
        }

        const diffRatio = diffCount / sampled;

        // Visual delta threshold: > 2.5% pixels changed
        if (diffRatio > 0.025) {
          const elapsed = now - startTime;
          // Filter out instantaneous jitter (< 50ms is below physical Android screenrecord latency floor)
          if (elapsed > 50) {
            this.e2eMetric.addSample(elapsed);
            this.updateHUD();
            const statusText = document.getElementById("e2e-probe-status");
            if (statusText) {
              statusText.textContent = `Visual screen response detected in ${elapsed.toFixed(1)} ms`;
            }
          }
          this.isObservingE2E = false;
        } else {
          if ("requestVideoFrameCallback" in this.videoElement) {
            this.videoElement.requestVideoFrameCallback(checkNext);
          } else {
            requestAnimationFrame(checkNext);
          }
        }
      };

      if ("requestVideoFrameCallback" in this.videoElement) {
        this.videoElement.requestVideoFrameCallback(checkNext);
      } else {
        requestAnimationFrame(checkNext);
      }
    } catch (e) {
      this.isObservingE2E = false;
    }
  }

  recordInputAck(ackMsg) {
    const { requestId, serverReceivedAt, serverDispatchedAt, adbDuration } = ackMsg;
    if (!requestId || !this.pendingInputs.has(requestId)) return;

    const pending = this.pendingInputs.get(requestId);
    this.pendingInputs.delete(requestId);

    const now = performance.now();
    const roundTrip = now - pending.startTime;

    // One-way dispatch latency estimate: client-to-server WebSocket + server processing + ADB spawn
    // If adbDuration is provided, input dispatch latency is the time until ADB finished executing
    let dispatchLatency = roundTrip;
    if (typeof adbDuration === "number" && adbDuration > 0) {
      // client -> server one-way + adb execution
      const networkOneWay = Math.max(0, (roundTrip - adbDuration) / 2);
      dispatchLatency = networkOneWay + adbDuration;
    }

    this.inputMetric.addSample(dispatchLatency);
    this.updateHUD();
  }

  startWebRTCStatsPolling() {
    if (this.statsInterval) clearInterval(this.statsInterval);

    this.statsInterval = setInterval(async () => {
      if (!this.webrtcClient || !this.webrtcClient.peerConnection) return;

      const pc = this.webrtcClient.peerConnection;
      if (pc.connectionState !== "connected") return;

      try {
        const stats = await pc.getStats();
        let jitterDelay = null;
        let decodeTime = null;
        let rtt = null;
        let fps = null;
        let framesReceived = null;
        let framesDropped = null;

        stats.forEach((report) => {
          if (report.type === "inbound-rtp" && report.kind === "video") {
            if (report.jitterBufferDelay && report.jitterBufferEmittedCount) {
              jitterDelay = (report.jitterBufferDelay / report.jitterBufferEmittedCount) * 1000;
            }
            if (report.totalDecodeTime && report.framesDecoded) {
              decodeTime = (report.totalDecodeTime / report.framesDecoded) * 1000;
            }
            if (report.framesPerSecond !== undefined) {
              fps = report.framesPerSecond;
            }
            if (report.framesReceived !== undefined) {
              framesReceived = report.framesReceived;
            }
            if (report.framesDropped !== undefined) {
              framesDropped = report.framesDropped;
            }
          }

          if (report.type === "candidate-pair" && report.state === "succeeded") {
            if (report.currentRoundTripTime !== undefined) {
              rtt = report.currentRoundTripTime * 1000;
            }
          }
        });

        this.webrtcTelemetry = {
          jitterBufferDelay: jitterDelay ? Number(jitterDelay.toFixed(1)) : null,
          decodeTime: decodeTime ? Number(decodeTime.toFixed(1)) : null,
          rtt: rtt ? Number(rtt.toFixed(1)) : null,
          fps: fps !== null ? Math.round(fps) : null,
          framesReceived,
          framesDropped,
        };

        if (jitterDelay !== null && decodeTime !== null) {
          const totalPlayoutDelay = jitterDelay + decodeTime;
          this.videoDeliveryMetric.addSample(totalPlayoutDelay);
        }

        this.updateHUD();
      } catch (err) {
        console.debug("WebRTC stats error:", err);
      }
    }, 1000);
  }

  /**
   * Automated End-to-End Latency Probe (Optical/Frame-Diff Analysis)
   * 
   * Triggers an input event, then captures consecutive video frames using
   * requestVideoFrameCallback() / offscreen canvas to detect when the
   * video content changes.
   */
  async runE2EProbe(sendInputCallback) {
    if (this.isProbingE2E) return;
    if (!this.videoElement || this.videoElement.readyState < 2) {
      alert("Video stream is not currently playing. Please ensure the stream is active first.");
      return;
    }

    this.isProbingE2E = true;
    const probeBtn = document.getElementById("btn-e2e-probe");
    const statusText = document.getElementById("e2e-probe-status");
    if (probeBtn) probeBtn.disabled = true;
    if (statusText) statusText.textContent = "Probing: Capturing baseline frame...";

    try {
      // 1. Prepare offscreen canvas for diff analysis
      const canvas = document.createElement("canvas");
      const width = 135;
      const height = 300;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      // Draw baseline frame
      ctx.drawImage(this.videoElement, 0, 0, width, height);
      const baselineData = ctx.getImageData(0, 0, width, height).data;

      // 2. Dispatch input action (e.g. tap at center)
      const rect = this.videoElement.getBoundingClientRect();
      const centerX = (rect.width / 2) * (this.videoElement.videoWidth / rect.width);
      const centerY = (rect.height / 2) * (this.videoElement.videoHeight / rect.height);

      if (statusText) statusText.textContent = "Probing: Action dispatched, awaiting screen change...";
      const startTime = performance.now();

      if (typeof sendInputCallback === "function") {
        sendInputCallback({
          type: "tap",
          x: centerX,
          y: centerY,
        });
      }

      // 3. Monitor video frames for pixel delta
      const checkFrameDiff = () => {
        return new Promise((resolve) => {
          const timeout = setTimeout(() => {
            resolve({ detected: false, elapsed: performance.now() - startTime });
          }, 3000);

          const inspectNextFrame = () => {
            const now = performance.now();
            ctx.drawImage(this.videoElement, 0, 0, width, height);
            const currentData = ctx.getImageData(0, 0, width, height).data;

            // Compute delta across sampled pixels
            let diffCount = 0;
            const totalPixels = width * height;
            const step = 4; // Check every 4th pixel for speed
            let sampled = 0;

            for (let i = 0; i < currentData.length; i += 4 * step) {
              const rDiff = Math.abs(currentData[i] - baselineData[i]);
              const gDiff = Math.abs(currentData[i + 1] - baselineData[i + 1]);
              const bDiff = Math.abs(currentData[i + 2] - baselineData[i + 2]);
              if (rDiff + gDiff + bDiff > 45) {
                diffCount++;
              }
              sampled++;
            }

            const diffRatio = diffCount / sampled;

            if (diffRatio > 0.03) { // >3% visual variance detected
              clearTimeout(timeout);
              resolve({ detected: true, elapsed: now - startTime });
            } else if (now - startTime < 3000) {
              if ("requestVideoFrameCallback" in this.videoElement) {
                this.videoElement.requestVideoFrameCallback(inspectNextFrame);
              } else {
                requestAnimationFrame(inspectNextFrame);
              }
            }
          };

          if ("requestVideoFrameCallback" in this.videoElement) {
            this.videoElement.requestVideoFrameCallback(inspectNextFrame);
          } else {
            requestAnimationFrame(inspectNextFrame);
          }
        });
      };

      const result = await checkFrameDiff();
      if (result.detected) {
        this.e2eMetric.addSample(result.elapsed);
        if (statusText) {
          statusText.textContent = `Success: Visible update detected in ${result.elapsed.toFixed(1)} ms`;
        }
      } else {
        if (statusText) {
          statusText.textContent = `No visual change detected within 3.0s (screen was static or unresponsive)`;
        }
      }
    } catch (err) {
      console.error("E2E probe error:", err);
      if (statusText) statusText.textContent = `Error during probe: ${err.message}`;
    } finally {
      this.isProbingE2E = false;
      if (probeBtn) probeBtn.disabled = false;
      this.updateHUD();
    }
  }

  clearMetrics() {
    this.inputMetric.clear();
    this.videoDeliveryMetric.clear();
    this.e2eMetric.clear();
    this.updateHUD();
    const statusText = document.getElementById("e2e-probe-status");
    if (statusText) statusText.textContent = "Metrics reset.";
  }

  generateReportMarkdown() {
    const inputStats = this.inputMetric.getStats();
    const videoStats = this.videoDeliveryMetric.getStats();
    const e2eStats = this.e2eMetric.getStats();

    const formatRow = (name, stats, unit = "ms") => {
      if (stats.count === 0) {
        return `| ${name} | 0 | Pending / No samples | Pending | Pending | Pending |`;
      }
      return `| ${name} | ${stats.count} | ${stats.median} ${unit} | ${stats.min} ${unit} | ${stats.max} ${unit} | ${stats.latest} ${unit} |`;
    };

    return `### Latency Measurement Telemetry Report
*Generated on: ${new Date().toISOString()}*

| Metric | Sample Count | Median | Min | Max | Latest |
| :--- | :---: | :---: | :---: | :---: | :---: |
${formatRow("Input Dispatch Latency (Browser -> WebSocket -> ADB)", inputStats)}
${formatRow("Video Playout Delay (WebRTC Jitter + Decode)", videoStats)}
${formatRow("End-to-End Latency (Action -> Visible Screen Update)", e2eStats)}

**WebRTC Live Parameters:**
- Jitter Buffer Delay: ${this.webrtcTelemetry.jitterBufferDelay !== null ? this.webrtcTelemetry.jitterBufferDelay + " ms" : "N/A"}
- Frame Decode Time: ${this.webrtcTelemetry.decodeTime !== null ? this.webrtcTelemetry.decodeTime + " ms" : "N/A"}
- WebRTC Round-Trip Time (RTT): ${this.webrtcTelemetry.rtt !== null ? this.webrtcTelemetry.rtt + " ms" : "N/A"}
- Framerate (FPS): ${this.webrtcTelemetry.fps !== null ? this.webrtcTelemetry.fps : "N/A"}
- Frames Received: ${this.webrtcTelemetry.framesReceived !== null ? this.webrtcTelemetry.framesReceived : "N/A"}
- Frames Dropped: ${this.webrtcTelemetry.framesDropped !== null ? this.webrtcTelemetry.framesDropped : "0"}
`;
  }

  renderHUD(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
      <div class="latency-dashboard">
        <div class="latency-header">
          <h3>Latency Diagnostics & Telemetry</h3>
          <div class="latency-actions">
            <button id="btn-e2e-probe" class="btn btn-primary" title="Trigger tap and measure frame diff until visual update">Run E2E Latency Probe</button>
            <button id="btn-copy-report" class="btn btn-secondary">Copy Telemetry Report</button>
            <button id="btn-clear-metrics" class="btn btn-outline">Reset</button>
          </div>
        </div>

        <div id="e2e-probe-status" class="probe-status">Ready. Tap or drag on the device stream to collect live input samples.</div>

        <div class="latency-cards">
          <!-- Card 1: Input Dispatch -->
          <div class="latency-card">
            <div class="card-title">1. Input Dispatch Latency</div>
            <div class="card-desc">Browser action &rarr; WebSocket &rarr; ADB dispatch</div>
            <div class="stat-highlight">
              <span id="stat-input-median" class="stat-value">--</span>
              <span class="stat-unit">ms (median)</span>
            </div>
            <div class="stat-grid">
              <div>Samples: <strong id="stat-input-count">0</strong></div>
              <div>Min: <strong id="stat-input-min">--</strong> ms</div>
              <div>Max: <strong id="stat-input-max">--</strong> ms</div>
              <div>Latest: <strong id="stat-input-latest">--</strong> ms</div>
            </div>
          </div>

          <!-- Card 2: Video Delivery Playout -->
          <div class="latency-card">
            <div class="card-title">2. Video Playout Delay</div>
            <div class="card-desc">WebRTC Jitter buffer + Frame decode</div>
            <div class="stat-highlight">
              <span id="stat-video-median" class="stat-value">--</span>
              <span class="stat-unit">ms (median)</span>
            </div>
            <div class="stat-grid">
              <div>Jitter Delay: <strong id="stat-webrtc-jitter">--</strong> ms</div>
              <div>Decode Time: <strong id="stat-webrtc-decode">--</strong> ms</div>
              <div>WebRTC RTT: <strong id="stat-webrtc-rtt">--</strong> ms</div>
              <div>Framerate: <strong id="stat-webrtc-fps">--</strong> FPS</div>
            </div>
          </div>

          <!-- Card 3: End-to-End Latency -->
          <div class="latency-card">
            <div class="card-title">3. End-to-End Action-to-Update</div>
            <div class="card-desc">Action dispatch &rarr; OS &rarr; Video pixel change</div>
            <div class="stat-highlight">
              <span id="stat-e2e-median" class="stat-value">--</span>
              <span class="stat-unit">ms (median)</span>
            </div>
            <div class="stat-grid">
              <div>Samples: <strong id="stat-e2e-count">0</strong></div>
              <div>Min: <strong id="stat-e2e-min">--</strong> ms</div>
              <div>Max: <strong id="stat-e2e-max">--</strong> ms</div>
              <div>Latest: <strong id="stat-e2e-latest">--</strong> ms</div>
            </div>
          </div>
        </div>

        <details class="latency-guide">
          <summary>Manual Latency Measurement Protocol (High-Speed Camera / Stopwatch)</summary>
          <div class="guide-content">
            <p>To measure physical ground-truth latency independently of in-app probes:</p>
            <ol>
              <li>Open <code>http://localhost:3000/latency.html</code> in the Android Emulator's browser. It renders a high-precision millisecond counter and flash target.</li>
              <li>Open <code>http://localhost:3000</code> on your host browser side-by-side with the Android Emulator window.</li>
              <li>Record both screens with a 60 FPS or 120/240 FPS high-speed camera (e.g. smartphone slow-motion mode).</li>
              <li><strong>Video Delivery Lag</strong>: Pause any video frame and subtract the timestamp shown on the WebRTC stream from the timestamp shown on the native emulator window:
                <br><code>Latency = Time(Emulator Display) - Time(WebRTC Stream Display)</code>.
              </li>
              <li><strong>Input Action Lag</strong>: Note the frame where a click/finger touch happens, then advance frame-by-frame until the screen visual response appears:
                <br><code>E2E Latency = (Frame_Response - Frame_Touch) / Recording_FPS &times; 1000 ms</code>.
              </li>
            </ol>
          </div>
        </details>
      </div>
    `;

    document.getElementById("btn-clear-metrics").addEventListener("click", () => {
      this.clearMetrics();
    });

    document.getElementById("btn-copy-report").addEventListener("click", () => {
      const markdown = this.generateReportMarkdown();
      navigator.clipboard.writeText(markdown).then(() => {
        const btn = document.getElementById("btn-copy-report");
        btn.textContent = "Copied!";
        setTimeout(() => (btn.textContent = "Copy Telemetry Report"), 2000);
      });
    });

    document.getElementById("btn-e2e-probe").addEventListener("click", () => {
      if (window.sendControlMessage) {
        this.runE2EProbe(window.sendControlMessage);
      }
    });

    this.updateHUD();
  }

  updateHUD() {
    const inputStats = this.inputMetric.getStats();
    const videoStats = this.videoDeliveryMetric.getStats();
    const e2eStats = this.e2eMetric.getStats();

    // Input stats
    const setVal = (id, val, fallback = "--") => {
      const el = document.getElementById(id);
      if (el) el.textContent = val !== null && val !== undefined ? val : fallback;
    };

    setVal("stat-input-median", inputStats.median);
    setVal("stat-input-count", inputStats.count);
    setVal("stat-input-min", inputStats.min);
    setVal("stat-input-max", inputStats.max);
    setVal("stat-input-latest", inputStats.latest);

    // Video playout stats
    setVal("stat-video-median", videoStats.median);
    setVal("stat-webrtc-jitter", this.webrtcTelemetry.jitterBufferDelay);
    setVal("stat-webrtc-decode", this.webrtcTelemetry.decodeTime);
    setVal("stat-webrtc-rtt", this.webrtcTelemetry.rtt);
    setVal("stat-webrtc-fps", this.webrtcTelemetry.fps);

    // E2E stats
    setVal("stat-e2e-median", e2eStats.median);
    setVal("stat-e2e-count", e2eStats.count);
    setVal("stat-e2e-min", e2eStats.min);
    setVal("stat-e2e-max", e2eStats.max);
    setVal("stat-e2e-latest", e2eStats.latest);
  }
}

window.LatencyManager = LatencyManager;
