const { spawn } = require("child_process");
const fs = require("fs");

console.log("Starting Android screen capture...");

const output = fs.createWriteStream("screen.h264");

const adb = spawn("adb", [
  "exec-out",
  "screenrecord",
  "--output-format=h264",
  "-"
]);

adb.stdout.pipe(output);

let totalBytes = 0;

adb.stdout.on("data", (chunk) => {
  totalBytes += chunk.length;

  console.log(
    `Receiving video data: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`
  );
});

adb.stderr.on("data", (data) => {
  console.error("ADB:", data.toString());
});

adb.on("close", (code) => {
  console.log(`ADB screenrecord stopped. Code: ${code}`);
  output.end();
});