'use strict';

// Install / uninstall the Notification hook into Claude Code's settings.
//
// Design goals:
//   - never clobber data: backup existing settings.json before mutating
//   - idempotent: re-running install is a no-op
//   - atomic: write to a temp file and rename
//   - portable: no deps; JSON.parse/stringify only
//   - scoped: we only touch the one hook entry we own, identified by
//     a substring match on the absolute path of bin/cue.js
//
// Why substring match on `bin/cue.js`? It survives the user moving the repo
// (path changes but filename doesn't), handles re-install after a rename
// by replacing the old entry, and won't accidentally match unrelated hooks.

const fs = require('fs');
const path = require('path');
const os = require('os');

const CUE_SCRIPT_ABS = path.resolve(__dirname, '..', 'bin', 'cue.js');
const CUE_COMMAND = `node ${JSON.stringify(CUE_SCRIPT_ABS)}`;
const HOOK_MARKER = 'bin/cue.js'; // substring used to identify our own entry

function settingsPath(home = os.homedir()) {
  return path.join(home, '.claude', 'settings.json');
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

// Returns { changed, backup } so the CLI can tell the user what happened.
function install({ home = os.homedir() } = {}) {
  const file = settingsPath(home);
  const settings = readSettings(file);

  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};
  if (!Array.isArray(settings.hooks.Notification)) settings.hooks.Notification = [];

  const ourEntry = {
    matcher: '',
    hooks: [{ type: 'command', command: CUE_COMMAND }],
  };

  // Idempotency: if any existing Notification entry already points at our
  // cue script, consider ourselves already installed. If the absolute path
  // has drifted (user moved the repo), replace in place.
  const groups = settings.hooks.Notification;
  let replacedIndex = -1;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (!g || !Array.isArray(g.hooks)) continue;
    for (const h of g.hooks) {
      if (h && typeof h.command === 'string' && h.command.includes(HOOK_MARKER)) {
        if (h.command === CUE_COMMAND) {
          return { changed: false, backup: null, file, command: CUE_COMMAND };
        }
        replacedIndex = i;
        break;
      }
    }
    if (replacedIndex !== -1) break;
  }

  const backupPath = backup(file);
  if (replacedIndex !== -1) {
    groups[replacedIndex] = ourEntry;
  } else {
    groups.push(ourEntry);
  }

  atomicWrite(file, JSON.stringify(settings, null, 2) + '\n');
  return { changed: true, backup: backupPath, file, command: CUE_COMMAND };
}

function uninstall({ home = os.homedir() } = {}) {
  const file = settingsPath(home);
  if (!fs.existsSync(file)) {
    return { changed: false, backup: null, file };
  }
  const settings = readSettings(file);
  const groups =
    settings.hooks && Array.isArray(settings.hooks.Notification)
      ? settings.hooks.Notification
      : null;
  if (!groups) return { changed: false, backup: null, file };

  const before = groups.length;
  const filtered = groups.filter((g) => {
    if (!g || !Array.isArray(g.hooks)) return true;
    return !g.hooks.some(
      (h) => h && typeof h.command === 'string' && h.command.includes(HOOK_MARKER)
    );
  });

  if (filtered.length === before) {
    return { changed: false, backup: null, file };
  }

  const backupPath = backup(file);
  if (filtered.length === 0) {
    delete settings.hooks.Notification;
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  } else {
    settings.hooks.Notification = filtered;
  }
  atomicWrite(file, JSON.stringify(settings, null, 2) + '\n');
  return { changed: true, backup: backupPath, file };
}

function status({ home = os.homedir() } = {}) {
  const file = settingsPath(home);
  if (!fs.existsSync(file)) return { installed: false, file, command: null };
  let settings;
  try {
    settings = readSettings(file);
  } catch {
    return { installed: false, file, command: null, error: 'invalid json' };
  }
  const groups =
    settings.hooks && Array.isArray(settings.hooks.Notification)
      ? settings.hooks.Notification
      : [];
  for (const g of groups) {
    if (!g || !Array.isArray(g.hooks)) continue;
    for (const h of g.hooks) {
      if (h && typeof h.command === 'string' && h.command.includes(HOOK_MARKER)) {
        return { installed: true, file, command: h.command };
      }
    }
  }
  return { installed: false, file, command: null };
}

module.exports = {
  install,
  uninstall,
  status,
  settingsPath,
  CUE_COMMAND,
  CUE_SCRIPT_ABS,
};
