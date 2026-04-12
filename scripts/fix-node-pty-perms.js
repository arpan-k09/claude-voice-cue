#!/usr/bin/env node
'use strict';

// node-pty ships a `spawn-helper` binary in its prebuilds. On some npm/macOS
// combinations the executable bit is lost during extraction, which makes
// every pty.spawn() fail with "posix_spawnp failed". Restore +x defensively.
//
// Safe to run on any platform: missing files are ignored.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds');
if (!fs.existsSync(root)) process.exit(0);

let fixed = 0;
for (const dir of fs.readdirSync(root)) {
  const helper = path.join(root, dir, 'spawn-helper');
  try {
    fs.chmodSync(helper, 0o755);
    fixed++;
  } catch {
    // not present on this platform's prebuild — fine
  }
}

if (fixed > 0) console.log(`fix-node-pty-perms: chmod +x on ${fixed} spawn-helper(s)`);
