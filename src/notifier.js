'use strict';

const { spawn } = require('child_process');

const PHRASE = 'Input needed';

/**
 * Speak a short phrase without blocking the main process.
 *
 * Strategy per platform:
 *   - darwin: `say`
 *   - linux:  `espeak` if present, otherwise terminal bell
 *   - win32:  PowerShell SAPI, otherwise console beep
 *
 * All errors are swallowed: a missing TTS binary must never break the wrapper.
 * Each invocation is spawned detached + unref'd so a slow `say` can't hold us up.
 */
function speak() {
  try {
    if (process.platform === 'darwin') {
      _spawnQuiet('say', [PHRASE]);
      return;
    }
    if (process.platform === 'linux') {
      if (!_spawnQuiet('espeak', [PHRASE])) {
        process.stderr.write('\x07');
      }
      return;
    }
    if (process.platform === 'win32') {
      const ps = `Add-Type -AssemblyName System.Speech; ` +
                 `(New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${PHRASE}')`;
      if (!_spawnQuiet('powershell', ['-NoProfile', '-Command', ps])) {
        process.stderr.write('\x07');
      }
      return;
    }
    process.stderr.write('\x07');
  } catch {
    // Last-ditch: never throw out of the notifier.
  }
}

function _spawnQuiet(cmd, args) {
  try {
    const child = spawn(cmd, args, {
      stdio: 'ignore',
      detached: true,
    });
    child.on('error', () => {}); // missing binary -> swallow
    child.unref();
    return true;
  } catch {
    return false;
  }
}

module.exports = { speak };
