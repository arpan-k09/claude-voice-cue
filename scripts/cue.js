#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Arpan Korat
'use strict';

// Plugin launcher invoked by Claude Code's Notification / PermissionRequest
// hooks. Must return immediately — hook commands block the UI.
//
// macOS fast path: the plugin ships a pre-generated `assets/input-needed.aiff`
// (the build step can't run at install time, so the file lives in the repo).
// `afplay` starts in ~tens of ms and bypasses `say` cold start (~1.5–2s).
//
// Other platforms fall through to src/notifier.js's cross-platform TTS
// dispatch (espeak on linux, SAPI on windows, terminal bell as last resort).

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const AIFF = path.resolve(__dirname, '..', 'assets', 'input-needed.aiff');

function detachAndForget(cmd, args) {
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

if (process.platform === 'darwin' && fs.existsSync(AIFF)) {
  detachAndForget('afplay', [AIFF]);
} else {
  require('../src/notifier').speak();
}
