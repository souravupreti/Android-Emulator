const wrtc = require("@roamhq/wrtc");

const { RTCVideoSource } = wrtc.nonstandard;

class WebRTCManager {
  constructor({ onIceCandidate }) {
    this.peerConnection = new wrtc.RTCPeerConnection();

    // Create video source
    this.videoSource = new RTCVideoSource({
      isScreencast: true,
    });

    // Create video track
    this.videoTrack = this.videoSource.createTrack();

    // Put track inside MediaStream
    this.mediaStream = new wrtc.MediaStream();
    this.mediaStream.addTrack(this.videoTrack);

    // Send video track to browser
    this.peerConnection.addTrack(this.videoTrack, this.mediaStream);

    this.remoteDescriptionSet = false;
    this.pendingCandidates = [];

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && onIceCandidate) {
        onIceCandidate(event.candidate);
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      console.log(
        "WebRTC connection state:",
        this.peerConnection.connectionState
      );
    };
  }

  getVideoSource() {
    return this.videoSource;
  }

  async handleOffer(offer) {
    console.log("Offer received");

    await this.peerConnection.setRemoteDescription(
      new wrtc.RTCSessionDescription(offer)
    );

    this.remoteDescriptionSet = true;

    for (const candidate of this.pendingCandidates) {
      await this.peerConnection.addIceCandidate(
        new wrtc.RTCIceCandidate(candidate)
      );
    }

    this.pendingCandidates.length = 0;

    const answer = await this.peerConnection.createAnswer();

    await this.peerConnection.setLocalDescription(answer);

    console.log("Answer sent");

    return this.peerConnection.localDescription;
  }

  async handleCandidate(candidate) {
    if (!this.remoteDescriptionSet) {
      this.pendingCandidates.push(candidate);
    } else {
      await this.peerConnection.addIceCandidate(
        new wrtc.RTCIceCandidate(candidate)
      );
    }
  }

  close() {
    if (this.videoTrack) {
      this.videoTrack.stop();
    }
    if (this.peerConnection) {
      this.peerConnection.close();
    }
  }
}

module.exports = {
  WebRTCManager,
};
