'use strict';

// End-to-end: drive src/runner.js with a fake `claude` binary over a real
// PTY. Streams and notifier are injected — no global stdio hijacking.

const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const { Writable } = require('stream');

process.env.CLAUDE_VOICE_CUE_CMD = path.join(__dirname, 'fixtures', 'fake-claude');
fs.chmodSync(process.env.CLAUDE_VOICE_CUE_CMD, 0o755);
fs.chmodSync(process.env.CLAUDE_VOICE_CUE_CMD + '.js', 0o755);

const { run } = require('../src/runner');

(async () => {
  // Fake stdin: an EventEmitter the test drives by hand.
  const fakeStdin = new EventEmitter();
  fakeStdin.isTTY = false;
  fakeStdin.resume = () => {};
  fakeStdin.pause = () => {};

  // Fake stdout: a Writable that captures everything.
  const captured = [];
  const fakeStdout = new Writable({
    write(chunk, _enc, cb) { captured.push(chunk.toString('utf8')); cb(); },
  });
  fakeStdout.columns = 80;
  fakeStdout.rows = 24;

  // Notifier spy.
  const cueCalls = [];
  const notifier = () => cueCalls.push(Date.now());

  // Kick off the run with all dependencies injected.
  const runP = run([], {
    stdin: fakeStdin,
    stdout: fakeStdout,
    installSignalHandlers: false,
    notifier,
  });

  // Hard timeout: fail loudly instead of hanging if anything goes wrong.
  const hardTimeout = setTimeout(() => {
    console.error('integration: timed out after 5s');
    process.exit(2);
  }, 5000);

  // Wait for the prompt to land, then send the keystroke + newline. The
  // PTY slave is in canonical mode by default, so a bare 'y' would sit in
  // the line discipline buffer until a newline arrives.
  await new Promise((r) => setTimeout(r, 400));
  fakeStdin.emit('data', Buffer.from('y\n'));

  const { exitCode, output } = await runP;
  clearTimeout(hardTimeout);

  let failed = 0;
  const check = (cond, label) => {
    if (cond) console.log(`  ok   ${label}`);
    else { console.log(`  FAIL ${label}`); failed++; }
  };

  console.log('integration');
  check(exitCode === 0, `child exited with code 0 (got ${exitCode})`);
  check(output.includes('booting fake claude'), 'proxied early stdout');
  check(output.includes('Apply changes? (y/n)'), 'proxied prompt line');
  check(output.includes('got: "y"'), 'proxied stdin to child');
  check(captured.join('').includes('Apply changes? (y/n)'), 'wrote to injected stdout');
  check(cueCalls.length >= 1, `notifier fired at least once (got ${cueCalls.length})`);
  check(cueCalls.length <= 2, `notifier did not spam (got ${cueCalls.length})`);

  console.log(`\n${failed === 0 ? 'all integration checks passed' : failed + ' failed'}`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('integration test crashed:', e);
  process.exit(1);
});
