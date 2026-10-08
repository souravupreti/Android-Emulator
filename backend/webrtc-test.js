const wrtc = require("@roamhq/wrtc");

console.log("WebRTC loaded successfully");

const pc = new wrtc.RTCPeerConnection();


console.log("RTCPeerConnection created successfully");

pc.close();