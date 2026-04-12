'use strict';

// Minimal zero-dep test runner. Each test returns a promise (or nothing).
const { InputDetector, stripAnsi } = require('../src/detector');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeDetector(opts = {}) {
  const calls = [];
  const d = new InputDetector({
    onPrompt: (reason) => calls.push(reason),
    debounceMs: opts.debounceMs ?? 10000,
    idleMs: opts.idleMs ?? 999999,
  });
  return { d, calls };
}

test('stripAnsi removes CSI color codes', () => {
  const out = stripAnsi('\x1b[31mhello\x1b[0m');
  if (out !== 'hello') throw new Error(`got ${JSON.stringify(out)}`);
});

test('fires on trailing question mark', () => {
  const { d, calls } = makeDetector();
  d.feed(Buffer.from('Do you want to continue?\n'));
  if (calls.length !== 1) throw new Error(`expected 1, got ${calls.length}`);
});

test('fires on (y/n)', () => {
  const { d, calls } = makeDetector();
  d.feed(Buffer.from('Apply changes (y/n) '));
  if (calls.length !== 1) throw new Error(`expected 1, got ${calls.length}`);
});

test('fires on TUI selection caret', () => {
  const { d, calls } = makeDetector();
  d.feed(Buffer.from('  ❯ Option A\n    Option B\n'));
  if (calls.length !== 1) throw new Error(`expected 1, got ${calls.length}`);
});

test('fires on "Press Enter"', () => {
  const { d, calls } = makeDetector();
  d.feed(Buffer.from('Press Enter to continue'));
  if (calls.length !== 1) throw new Error(`expected 1, got ${calls.length}`);
});

test('strips ANSI before matching', () => {
  const { d, calls } = makeDetector();
  d.feed(Buffer.from('\x1b[1;32mProceed\x1b[0m\n'));
  if (calls.length !== 1) throw new Error(`expected 1, got ${calls.length}`);
});

test('does NOT fire on plain output', () => {
  const { d, calls } = makeDetector();
  d.feed(Buffer.from('Reading file foo.js\nWriting to bar.js\n'));
  if (calls.length !== 0) throw new Error(`expected 0, got ${calls.length}`);
});

test('debounces repeated matches inside the window', () => {
  const { d, calls } = makeDetector();
  d.feed(Buffer.from('Confirm?\n'));
  d.feed(Buffer.from('Confirm?\n'));
  d.feed(Buffer.from('Confirm?\n'));
  if (calls.length !== 1) throw new Error(`expected 1, got ${calls.length}`);
});

test('debounce releases after the window', async () => {
  const { d, calls } = makeDetector({ debounceMs: 20 });
  d.feed(Buffer.from('Confirm?\n'));
  await sleep(40);
  d.feed(Buffer.from('Confirm?\n'));
  if (calls.length !== 2) throw new Error(`expected 2, got ${calls.length}`);
});

test('idle path does not double-fire after pattern match', async () => {
  const { d, calls } = makeDetector({ idleMs: 20 });
  d.feed(Buffer.from('Continue?\n'));
  await sleep(60);
  d.stop();
  if (calls.length !== 1) throw new Error(`expected 1, got ${calls.length}`);
});

(async () => {
  let passed = 0, failed = 0;
  console.log('detector');
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ok   ${name}`);
      passed++;
    } catch (e) {
      console.log(`  FAIL ${name}\n       ${e.message}`);
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
