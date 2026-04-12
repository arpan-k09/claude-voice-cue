#!/usr/bin/env node
'use strict';

const installer = require('../src/installer');
const { speak } = require('../src/notifier');

const USAGE = `claude-voice-cue — install a voice cue for Claude Code

Usage:
  claude-voice-cue             show install status
  claude-voice-cue install     add the Notification hook to ~/.claude/settings.json
  claude-voice-cue uninstall   remove the hook (leaves any unrelated hooks intact)
  claude-voice-cue test        speak the cue phrase once to verify audio works
  claude-voice-cue --help
`;

function cmdStatus() {
  const s = installer.status();
  if (s.installed) {
    console.log(`installed`);
    console.log(`  settings: ${s.file}`);
    console.log(`  events:   ${s.events.join(', ')}`);
    console.log(`  command:  ${s.command}`);
  } else {
    console.log(`not installed`);
    console.log(`  settings: ${s.file}`);
    console.log(`\nrun \`claude-voice-cue install\` to enable.`);
  }
}

function cmdInstall() {
  const r = installer.install();
  if (!r.changed) {
    console.log(`already installed`);
    console.log(`  settings: ${r.file}`);
    console.log(`  events:   ${r.events.join(', ')}`);
    console.log(`  command:  ${r.command}`);
    return;
  }
  console.log(`installed hooks on ${r.events.join(', ')}`);
  console.log(`  settings: ${r.file}`);
  console.log(`  command:  ${r.command}`);
  if (r.backup) console.log(`  backup:   ${r.backup}`);
  console.log(`\nstart \`claude\` as usual. you'll hear "Input needed" when it waits on you.`);
}

function cmdUninstall() {
  const r = installer.uninstall();
  if (!r.changed) {
    console.log(`no claude-voice-cue hook found; nothing to uninstall`);
    console.log(`  settings: ${r.file}`);
    return;
  }
  console.log(`removed claude-voice-cue hook`);
  console.log(`  settings: ${r.file}`);
  if (r.backup) console.log(`  backup:   ${r.backup}`);
}

function cmdTest() {
  speak();
  console.log(`played voice cue. if you didn't hear anything, your platform's TTS backend is not available.`);
}

const arg = process.argv[2];
try {
  switch (arg) {
    case undefined:
    case 'status':
      cmdStatus();
      break;
    case 'install':
      cmdInstall();
      break;
    case 'uninstall':
      cmdUninstall();
      break;
    case 'test':
      cmdTest();
      break;
    case '-h':
    case '--help':
    case 'help':
      process.stdout.write(USAGE);
      break;
    default:
      process.stderr.write(`unknown command: ${arg}\n\n${USAGE}`);
      process.exit(2);
  }
} catch (e) {
  process.stderr.write(`claude-voice-cue: ${e.message}\n`);
  process.exit(1);
}
