class WebRTCClient {
  constructor({ videoElement, statusElement, sendSignal }) {
    this.video = videoElement;
    this.status = statusElement;
    this.sendSignal = sendSignal;
    this.peerConnection = new RTCPeerConnection();

    const transceiver = this.peerConnection.addTransceiver("video", {
      direction: "recvonly",
    });

    // Request immediate playout without buffering
    if (transceiver && transceiver.receiver) {
      if ("playoutDelayHint" in transceiver.receiver) {
        transceiver.receiver.playoutDelayHint = 0;
      }
      if ("jitterBufferTarget" in transceiver.receiver) {
        transceiver.receiver.jitterBufferTarget = 0;
      }
    }

    this.peerConnection.onconnectionstatechange = () => {
      console.log("Connection state:", this.peerConnection.connectionState);
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      console.log("ICE state:", this.peerConnection.iceConnectionState);
    };

    // Receive video from backend
    this.peerConnection.ontrack = async (event) => {
      console.log("Video track received");
      if (this.status) {
        this.status.textContent = "Live";
      }

      // Enforce zero playout delay on incoming receiver
      if (event.receiver) {
        if ("playoutDelayHint" in event.receiver) {
          event.receiver.playoutDelayHint = 0;
        }
        if ("jitterBufferTarget" in event.receiver) {
          event.receiver.jitterBufferTarget = 0;
        }
      }

      const stream = event.streams[0] || new MediaStream([event.track]);
      this.video.srcObject = stream;

      try {
        await this.video.play();
        console.log("Video playback started");
      } catch (error) {
        console.error("Video play failed:", error);
      }
    };

    // Send ICE candidates to backend
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          type: "candidate",
          candidate: event.candidate,
        });
      }
    };
  }

  async startOffer() {
    if (this.status) {
      this.status.textContent = "Connecting to WebRTC...";
    }

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    this.sendSignal({
      type: "offer",
      offer: this.peerConnection.localDescription,
    });

    console.log("Offer sent");
  }

  async handleAnswer(answer) {
    console.log("Answer received");
    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription(answer)
    );
  }

  async handleCandidate(candidate) {
    await this.peerConnection.addIceCandidate(
      new RTCIceCandidate(candidate)
    );
  }
}

window.WebRTCClient = WebRTCClient;
