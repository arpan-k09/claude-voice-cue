// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Arpan Korat
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const installer = require('../src/installer');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cvc-'));
}
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

// Helper: find the single hook command registered under `event` that
// belongs to us (marker substring match).
function ourCommand(settings, event) {
  const groups = settings.hooks && settings.hooks[event];
  if (!Array.isArray(groups)) return null;
  for (const g of groups) {
    if (!g || !Array.isArray(g.hooks)) continue;
    for (const h of g.hooks) {
      if (h && typeof h.command === 'string' && h.command.includes('claude-voice-cue')) {
        return h.command;
      }
    }
  }
  return null;
}

test('install registers on both PermissionRequest and Notification', () => {
  const home = tmpHome();
  const file = installer.settingsPath(home);
  const r = installer.install({ home, generateAudio: () => null });
  if (!r.changed) throw new Error('expected changed=true');
  const settings = read(file);
  const pr = ourCommand(settings, 'PermissionRequest');
  const n = ourCommand(settings, 'Notification');
  if (!pr) throw new Error('missing PermissionRequest entry');
  if (!n) throw new Error('missing Notification entry');
  if (pr !== n) throw new Error('both events should point to same command');
  if (!pr.includes('bin/cue.js')) throw new Error(`expected node fallback, got ${pr}`);
});

test('install with audio pre-gen writes afplay on both events (darwin)', () => {
  if (process.platform !== 'darwin') return;
  const home = tmpHome();
  const file = installer.settingsPath(home);
  const fake = installer.audioFilePath(home);
  fs.mkdirSync(path.dirname(fake), { recursive: true });
  fs.writeFileSync(fake, 'fake aiff bytes');
  installer.install({ home, generateAudio: () => fake });
  const settings = read(file);
  for (const event of ['PermissionRequest', 'Notification']) {
    const cmd = ourCommand(settings, event);
    if (!cmd || !cmd.startsWith('afplay ')) throw new Error(`${event}: expected afplay, got ${cmd}`);
    if (!cmd.includes('claude-voice-cue.aiff')) throw new Error(`${event}: missing audio path`);
  }
});

test('install upgrades a prior node-based entry to afplay (darwin)', () => {
  if (process.platform !== 'darwin') return;
  const home = tmpHome();
  const file = installer.settingsPath(home);
  write(file, {
    hooks: {
      Notification: [
        { matcher: '', hooks: [{ type: 'command', command: 'node "/old/path/to/claude-voice-cue/bin/cue.js"' }] },
      ],
    },
  });
  const fake = installer.audioFilePath(home);
  fs.mkdirSync(path.dirname(fake), { recursive: true });
  fs.writeFileSync(fake, 'fake');
  installer.install({ home, generateAudio: () => fake });
  const settings = read(file);
  if (!ourCommand(settings, 'Notification').startsWith('afplay '))
    throw new Error('Notification not upgraded');
  if (!ourCommand(settings, 'PermissionRequest').startsWith('afplay '))
    throw new Error('PermissionRequest not added on upgrade');
  // And no duplicate Notification entries
  if (settings.hooks.Notification.length !== 1)
    throw new Error(`Notification has ${settings.hooks.Notification.length} entries, expected 1`);
});

test('install preserves unrelated existing hooks', () => {
  const home = tmpHome();
  const file = installer.settingsPath(home);
  write(file, {
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }],
      Notification: [
        { matcher: '', hooks: [{ type: 'command', command: 'echo someone-elses-hook' }] },
      ],
    },
    other: 'keep-me',
  });
  installer.install({ home, generateAudio: () => null });
  const got = read(file);
  if (got.other !== 'keep-me') throw new Error('top-level key lost');
  if (got.hooks.PreToolUse[0].hooks[0].command !== 'echo pre')
    throw new Error('unrelated hook event lost');
  const notif = got.hooks.Notification;
  if (notif.length !== 2) throw new Error(`expected 2 Notification entries, got ${notif.length}`);
  if (notif[0].hooks[0].command !== 'echo someone-elses-hook')
    throw new Error('unrelated Notification entry was clobbered');
  if (!ourCommand(got, 'PermissionRequest')) throw new Error('PermissionRequest not added');
});

test('install is idempotent across both events', () => {
  const home = tmpHome();
  installer.install({ home, generateAudio: () => null });
  const r2 = installer.install({ home, generateAudio: () => null });
  if (r2.changed) throw new Error('second install should be no-op');
  if (r2.backup !== null) throw new Error('no-op install must not backup');
  const settings = read(installer.settingsPath(home));
  if (settings.hooks.PermissionRequest.length !== 1)
    throw new Error('PermissionRequest duplicated');
  if (settings.hooks.Notification.length !== 1)
    throw new Error('Notification duplicated');
});

test('install replaces stale path in place across both events', () => {
  const home = tmpHome();
  const file = installer.settingsPath(home);
  write(file, {
    hooks: {
      Notification: [
        { matcher: '', hooks: [{ type: 'command', command: 'node /old/path/to/claude-voice-cue/bin/cue.js' }] },
      ],
      PermissionRequest: [
        { matcher: '', hooks: [{ type: 'command', command: 'node /old/path/to/claude-voice-cue/bin/cue.js' }] },
      ],
    },
  });
  const r = installer.install({ home, generateAudio: () => null });
  if (!r.changed) throw new Error('expected changed=true');
  const settings = read(file);
  for (const event of ['PermissionRequest', 'Notification']) {
    const cmd = ourCommand(settings, event);
    if (!cmd || cmd.includes('/old/path/')) throw new Error(`${event} stale entry not replaced`);
    if (settings.hooks[event].length !== 1)
      throw new Error(`${event}: expected 1 entry, got ${settings.hooks[event].length}`);
  }
});

test('install backs up existing file before mutating', () => {
  const home = tmpHome();
  const file = installer.settingsPath(home);
  write(file, { hooks: {} });
  const r = installer.install({ home, generateAudio: () => null });
  if (!r.backup) throw new Error('expected backup path');
  if (!fs.existsSync(r.backup)) throw new Error('backup file missing');
});

test('install refuses to overwrite malformed JSON', () => {
  const home = tmpHome();
  const file = installer.settingsPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ this is not json ');
  let threw = false;
  try { installer.install({ home, generateAudio: () => null }); } catch { threw = true; }
  if (!threw) throw new Error('expected install to throw on invalid json');
  if (fs.readFileSync(file, 'utf8') !== '{ this is not json ')
    throw new Error('malformed file was modified');
});

test('uninstall removes our entries from all events, preserving others', () => {
  const home = tmpHome();
  const file = installer.settingsPath(home);
  write(file, {
    hooks: {
      Notification: [{ matcher: '', hooks: [{ type: 'command', command: 'echo keep-me' }] }],
    },
  });
  installer.install({ home, generateAudio: () => null });
  const r = installer.uninstall({ home });
  if (!r.changed) throw new Error('expected changed=true');
  const settings = read(file);
  if (ourCommand(settings, 'Notification')) throw new Error('Notification entry not removed');
  if (ourCommand(settings, 'PermissionRequest')) throw new Error('PermissionRequest entry not removed');
  if (settings.hooks.Notification[0].hooks[0].command !== 'echo keep-me')
    throw new Error('unrelated entry not preserved');
});

test('uninstall on file without our hook is a no-op', () => {
  const home = tmpHome();
  const file = installer.settingsPath(home);
  write(file, { hooks: { Notification: [{ matcher: '', hooks: [{ type: 'command', command: 'echo other' }] }] } });
  const r = installer.uninstall({ home });
  if (r.changed) throw new Error('should be no-op');
});

test('uninstall on missing file is a no-op', () => {
  const home = tmpHome();
  const r = installer.uninstall({ home });
  if (r.changed) throw new Error('should be no-op');
});

test('uninstall cleans up empty hooks keys', () => {
  const home = tmpHome();
  installer.install({ home, generateAudio: () => null });
  installer.uninstall({ home });
  const got = read(installer.settingsPath(home));
  if (got.hooks) throw new Error(`expected hooks removed; got ${JSON.stringify(got)}`);
});

test('status reports both events after install', () => {
  const home = tmpHome();
  const s1 = installer.status({ home });
  if (s1.installed) throw new Error('expected not installed before install');
  installer.install({ home, generateAudio: () => null });
  const s2 = installer.status({ home });
  if (!s2.installed) throw new Error('expected installed after install');
  if (!s2.events.includes('PermissionRequest')) throw new Error('status missing PermissionRequest');
  if (!s2.events.includes('Notification')) throw new Error('status missing Notification');
  if (!s2.command.includes('claude-voice-cue')) throw new Error('status.command missing marker');
});

(async () => {
  let passed = 0, failed = 0;
  console.log('installer');
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
