/**
 * clipboard.test.js — Automated test suite for Two-Way Clipboard
 */
const {
  sendTextToAndroid,
  getAndroidClipboard,
  escapeForAdbInput,
  MAX_CLIPBOARD_TEXT_LENGTH,
} = require("./src/clipboard");

async function runTests() {
  console.log("=== Running Clipboard Test Suite ===");
  let passed = 0;
  let failed = 0;

  function assert(condition, name) {
    if (condition) {
      console.log(`  PASS: ${name}`);
      passed++;
    } else {
      console.error(`  FAIL: ${name}`);
      failed++;
    }
  }

  // Test 1: Shell escaping
  console.log("\n[1] Testing Shell Escaping & Special Characters");
  const specialInput = `Hello $USER & ls | rm -rf ; "quoted" 'single' <tag> (group) * ? ~ # ! ^ % \t`;
  const escaped = escapeForAdbInput(specialInput);
  assert(!escaped.includes(" "), "Spaces replaced with %s");
  assert(escaped.includes("\\$USER"), "Dollar sign escaped");
  assert(escaped.includes("\\&"), "Ampersand escaped");
  assert(escaped.includes("\\|"), "Pipe escaped");
  assert(escaped.includes("\\;"), "Semicolon escaped");
  assert(escaped.includes('\\"quoted\\"'), "Double quotes escaped");
  assert(escaped.includes("\\'single\\'"), "Single quotes escaped");
  assert(escaped.includes("%s%s%s%s"), "Tabs expanded to %s");

  // Test 2: Input Validation (Empty & Oversized)
  console.log("\n[2] Testing Input Validation");
  const emptyRes = await sendTextToAndroid("");
  assert(!emptyRes.success && emptyRes.error.includes("empty"), "Rejects empty text");

  const oversizedText = "A".repeat(MAX_CLIPBOARD_TEXT_LENGTH + 50);
  const overRes = await sendTextToAndroid(oversizedText);
  assert(!overRes.success && overRes.error.includes("maximum"), "Rejects oversized text (>10,000 chars)");

  const invalidTypeRes = await sendTextToAndroid(12345);
  assert(!invalidTypeRes.success && invalidTypeRes.error.includes("expected string"), "Rejects non-string types");

  // Test 3: Multiline text injection
  console.log("\n[3] Testing Multiline Text Injection");
  const multiline = "Line One\nLine Two\nLine Three";
  const multiRes = await sendTextToAndroid(multiline);
  assert(multiRes.success === true, "Multiline text successfully dispatched");
  assert(multiRes.charactersSent === multiline.length, `Correct character count reported (${multiRes.charactersSent})`);

  // Test 4: Unicode & Accented Characters Fallback
  console.log("\n[4] Testing Unicode / Accented Characters");
  const unicodeSample = "Café au lait — Résumé 2026";
  const uniRes = await sendTextToAndroid(unicodeSample);
  assert(uniRes.success === true, "Unicode text handled gracefully with safe transliteration");

  // Test 5: Clipboard Reading from Android
  console.log("\n[5] Testing Android Clipboard Query");
  const clipRes = await getAndroidClipboard();
  assert(clipRes.success === true, "Android clipboard queried without process crash");
  assert(typeof clipRes.text === "string", "Returned text is a string");

  console.log(`\n=== Test Results: ${passed} Passed, ${failed} Failed ===`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error("Unexpected test failure:", err);
  process.exit(1);
});
