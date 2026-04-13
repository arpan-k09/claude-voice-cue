// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Arpan Korat
'use strict';

// Stub child_process.spawn so speak() can be observed without actually
// invoking say/espeak/powershell. The stub must be installed before
// requiring src/notifier.
const Module = require('module');
const origRequire = Module.prototype.require;

const spawnCalls = [];
Module.prototype.require = function patched(id) {
  if (id === 'child_process') {
    return {
      spawn(cmd, args, opts) {
        spawnCalls.push({ cmd, args, opts });
        return {
          on() {},
          unref() {},
        };
      },
    };
  }
  return origRequire.apply(this, arguments);
};

const { speak } = require('../src/notifier');
Module.prototype.require = origRequire;

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('speak does not throw', () => {
  speak();
});

test('speak dispatches the right binary for this platform', () => {
  spawnCalls.length = 0;
  speak();
  // On linux/darwin/win32 we should have attempted exactly one spawn.
  if (spawnCalls.length !== 1) {
    // Other platforms fall through to writing a bell, which is fine —
    // we only assert on the three we officially support.
    if (['darwin', 'linux', 'win32'].includes(process.platform)) {
      throw new Error(`expected 1 spawn on ${process.platform}, got ${spawnCalls.length}`);
    }
    return;
  }
  const { cmd } = spawnCalls[0];
  const expected = {
    darwin: 'say',
    linux: 'espeak',
    win32: 'powershell',
  }[process.platform];
  if (expected && cmd !== expected) {
    throw new Error(`expected ${expected}, got ${cmd}`);
  }
});

test('spawn is detached and stdio is ignored', () => {
  spawnCalls.length = 0;
  speak();
  if (!spawnCalls.length) return; // non-supported platform
  const opts = spawnCalls[0].opts || {};
  if (opts.stdio !== 'ignore') throw new Error(`stdio should be ignore, got ${opts.stdio}`);
  if (opts.detached !== true) throw new Error(`detached should be true`);
});

(async () => {
  let passed = 0, failed = 0;
  console.log('notifier');
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
