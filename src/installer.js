// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Arpan Korat
'use strict';

// Install / uninstall the Notification hook into Claude Code's settings.
//
// Design goals:
//   - never clobber data: backup existing settings.json before mutating
//   - idempotent: re-running install is a no-op
//   - atomic: write to a temp file and rename
//   - portable: no deps; JSON.parse/stringify only
//   - scoped: we only touch the one hook entry we own, identified by
//     a substring match on "claude-voice-cue" (matches both the cached
//     audio file path on macOS and the fallback node command)
//
// Fast path (macOS): at install time we pre-generate
// ~/.claude/claude-voice-cue.aiff via `say -o`. The hook command becomes
// `afplay <file>`, which starts in ~tens of ms and bypasses both node
// startup (~100ms) and `say` cold start (~1.5–2s). On other platforms,
// or if pre-generation fails, we fall back to `node bin/cue.js`, which
// uses src/notifier.js for the cross-platform TTS dispatch.

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const CUE_SCRIPT_ABS = path.resolve(__dirname, '..', 'bin', 'cue.js');
const NODE_FALLBACK_COMMAND = `node ${JSON.stringify(CUE_SCRIPT_ABS)}`;
const HOOK_MARKER = 'claude-voice-cue';
const AUDIO_PHRASE = 'Input needed';

// Which hook events we register on, in preference order.
//
// `PermissionRequest` fires immediately when Claude shows a tool-approval
// or plan-approval dialog — no idle debounce. This is what the user
// actually feels as "Claude is asking me a question."
//
// `Notification` is kept as a safety net: it covers other attention-wanted
// cases (auth prompts, idle_prompt, elicitation dialogs). The `idle_prompt`
// matcher does debounce on an inactivity timer, which is why registering
// only on Notification produced a 2–3s delay — PermissionRequest bypasses
// that for the common case.
const HOOK_EVENTS = ['PermissionRequest', 'Notification'];

function settingsPath(home = os.homedir()) {
  return path.join(home, '.claude', 'settings.json');
}

function audioFilePath(home = os.homedir()) {
  return path.join(home, '.claude', 'claude-voice-cue.aiff');
}

function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `${file} is not valid JSON (${e.message}). Refusing to overwrite. ` +
      `Fix it by hand and re-run install.`
    );
  }
}

function backup(file) {
  if (!fs.existsSync(file)) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = `${file}.bak.${ts}`;
  fs.copyFileSync(file, dest);
  return dest;
}

function atomicWrite(file, content) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

// Default audio generator: macOS-only, uses `say -o`. Returns the absolute
// path to the generated file on success, or null on failure / unsupported.
// Tests inject a stub so they don't shell out.
function defaultGenerateAudio(home) {
  if (process.platform !== 'darwin') return null;
  const out = audioFilePath(home);
  try {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    // -r 220 is ~20% faster than the default 180 wpm. Still perfectly
    // intelligible for a two-word phrase and shaves ~250ms off playback.
    cp.execFileSync('say', ['-r', '220', '-o', out, AUDIO_PHRASE], { stdio: 'ignore' });
    if (fs.existsSync(out) && fs.statSync(out).size > 0) return out;
    return null;
  } catch {
    return null;
  }
}

function buildHookCommand(audioFile) {
  if (audioFile && process.platform === 'darwin') {
    return `afplay ${JSON.stringify(audioFile)}`;
  }
  return NODE_FALLBACK_COMMAND;
}

// Ensure a single "ours" entry exists in settings.hooks[event]. Returns
// true if the array was mutated, false if our entry was already present
// with the same command. Adds or replaces in place; never touches
// entries belonging to other hooks.
function upsertEventEntry(settings, event, command) {
  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};
  if (!Array.isArray(settings.hooks[event])) settings.hooks[event] = [];
  const groups = settings.hooks[event];

  const ourEntry = {
    matcher: '',
    hooks: [{ type: 'command', command }],
  };

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (!g || !Array.isArray(g.hooks)) continue;
    for (const h of g.hooks) {
      if (h && typeof h.command === 'string' && h.command.includes(HOOK_MARKER)) {
        if (h.command === command) return false; // already installed, same cmd
        groups[i] = ourEntry;
        return true;
      }
    }
  }
  groups.push(ourEntry);
  return true;
}

function install({ home = os.homedir(), generateAudio = defaultGenerateAudio } = {}) {
  const file = settingsPath(home);
  const settings = readSettings(file);

  const audioFile = generateAudio(home);
  const command = buildHookCommand(audioFile);

  let anyChanged = false;
  for (const event of HOOK_EVENTS) {
    if (upsertEventEntry(settings, event, command)) anyChanged = true;
  }

  if (!anyChanged) {
    return { changed: false, backup: null, file, command, audioFile, events: HOOK_EVENTS };
  }

  const backupPath = backup(file);
  atomicWrite(file, JSON.stringify(settings, null, 2) + '\n');
  return { changed: true, backup: backupPath, file, command, audioFile, events: HOOK_EVENTS };
}

function uninstall({ home = os.homedir() } = {}) {
  const file = settingsPath(home);
  if (!fs.existsSync(file)) {
    return { changed: false, backup: null, file };
  }
  const settings = readSettings(file);
  if (!settings.hooks || typeof settings.hooks !== 'object') {
    return { changed: false, backup: null, file };
  }

  // Remove our entry from every event array we ever touched. Also sweep
  // every other hook event so upgrades from versions that used a
  // different event set don't leave strays behind.
  let changed = false;
  const allEvents = new Set([...HOOK_EVENTS, ...Object.keys(settings.hooks)]);
  for (const event of allEvents) {
    const groups = settings.hooks[event];
    if (!Array.isArray(groups)) continue;
    const before = groups.length;
    const filtered = groups.filter((g) => {
      if (!g || !Array.isArray(g.hooks)) return true;
      return !g.hooks.some(
        (h) => h && typeof h.command === 'string' && h.command.includes(HOOK_MARKER)
      );
    });
    if (filtered.length !== before) {
      changed = true;
      if (filtered.length === 0) delete settings.hooks[event];
      else settings.hooks[event] = filtered;
    }
  }

  if (!changed) return { changed: false, backup: null, file };

  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  const backupPath = backup(file);
  atomicWrite(file, JSON.stringify(settings, null, 2) + '\n');

  // Best-effort cleanup of the cached audio file. Missing is fine.
  try { fs.unlinkSync(audioFilePath(home)); } catch {}

  return { changed: true, backup: backupPath, file };
}

function status({ home = os.homedir() } = {}) {
  const file = settingsPath(home);
  if (!fs.existsSync(file)) return { installed: false, file, command: null, events: [] };
  let settings;
  try {
    settings = readSettings(file);
  } catch {
    return { installed: false, file, command: null, events: [], error: 'invalid json' };
  }
  const found = [];
  let command = null;
  if (settings.hooks && typeof settings.hooks === 'object') {
    for (const [event, groups] of Object.entries(settings.hooks)) {
      if (!Array.isArray(groups)) continue;
      for (const g of groups) {
        if (!g || !Array.isArray(g.hooks)) continue;
        for (const h of g.hooks) {
          if (h && typeof h.command === 'string' && h.command.includes(HOOK_MARKER)) {
            if (!command) command = h.command;
            if (!found.includes(event)) found.push(event);
          }
        }
      }
    }
  }
  return { installed: found.length > 0, file, command, events: found };
}

module.exports = {
  install,
  uninstall,
  status,
  settingsPath,
  audioFilePath,
  buildHookCommand,
  NODE_FALLBACK_COMMAND,
  CUE_SCRIPT_ABS,
};
