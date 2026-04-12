'use strict';

const { InputDetector } = require('./detector');
const { speak } = require('./notifier');

function _resolveDim(stream, dim, fallback) {
  return (stream && (stream[dim] | 0)) || fallback;
}

/**
 * Spawn `claude code` inside a PTY, proxy stdio, and watch output for prompts.
 *
 * Why a PTY: claude code is a full TUI. Plain pipes make it think stdout is
 * not a terminal and it falls back to a degraded renderer (or refuses to run
 * interactively at all). node-pty is the one non-trivial dependency we accept.
 *
 * Returns the child's exit code.
 */
async function run(args, opts = {}) {
  const stdin = opts.stdin || process.stdin;
  const stdout = opts.stdout || process.stdout;
  const installSignalHandlers = opts.installSignalHandlers !== false;
  const notifier = opts.notifier || speak;
  let pty;
  try {
    pty = require('node-pty');
  } catch (e) {
    throw new Error(
      'node-pty is required. Run `npm install` in the claude-voice-cue directory.'
    );
  }

  const cmd = process.env.CLAUDE_VOICE_CUE_CMD || 'claude';
  const childArgs = ['code', ...args];

  const cols = _resolveDim(stdout, 'columns', 80);
  const rows = _resolveDim(stdout, 'rows', 24);

  let child;
  try {
    child = pty.spawn(cmd, childArgs, {
      name: process.env.TERM || 'xterm-256color',
      cols,
      rows,
      cwd: process.cwd(),
      env: process.env,
    });
  } catch (e) {
    throw new Error(`failed to spawn '${cmd} code': ${e.message}`);
  }

  const detector = new InputDetector({ onPrompt: () => notifier() });

  // Buffer the tail of PTY output so tests/callers can observe what was
  // produced after `child.onExit` (node-pty can fire exit before all data
  // has flushed through the master).
  const dataChunks = [];

  child.onData((data) => {
    dataChunks.push(data);
    try {
      stdout.write(data);
    } catch {
      // EPIPE etc. — caller closed our stdout. Nothing useful to do.
    }
    detector.feed(Buffer.from(data, 'utf8'));
  });

  // Our stdin -> PTY. Switch to raw mode so keystrokes pass through verbatim.
  const wasRaw = stdin.isTTY ? stdin.isRaw : false;
  if (stdin.isTTY) {
    try { stdin.setRawMode(true); } catch {}
  }
  stdin.resume();
  const onStdinData = (buf) => {
    try { child.write(buf.toString('utf8')); } catch {}
  };
  stdin.on('data', onStdinData);

  // Forward window resizes.
  const onResize = () => {
    try {
      child.resize(_resolveDim(stdout, 'columns', cols), _resolveDim(stdout, 'rows', rows));
    } catch {}
  };
  if (typeof stdout.on === 'function') stdout.on('resize', onResize);

  // Forward signals. SIGINT inside a raw-mode TTY won't fire automatically;
  // the ^C keystroke is just bytes on stdin and the PTY handles it. These
  // handlers cover the case where the wrapper itself is signalled.
  const forward = (sig) => () => {
    try { child.kill(sig); } catch {}
  };
  const onSigint = forward('SIGINT');
  const onSigterm = forward('SIGTERM');
  if (installSignalHandlers) {
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
  }

  const exitCode = await new Promise((resolve) => {
    child.onExit(({ exitCode, signal }) => {
      // Give onData a tick to drain any final bytes from the master.
      setTimeout(() => {
        resolve(typeof exitCode === 'number' && exitCode !== 0
          ? exitCode
          : (signal ? 128 + signal : (exitCode | 0)));
      }, 30);
    });
  });

  // Cleanup. Order matters: stop reading stdin before restoring cooked mode
  // so a stray keystroke doesn't land in the parent shell mid-restore.
  stdin.removeListener('data', onStdinData);
  if (typeof stdout.removeListener === 'function') stdout.removeListener('resize', onResize);
  if (installSignalHandlers) {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }
  if (stdin.isTTY) {
    try { stdin.setRawMode(wasRaw); } catch {}
  }
  if (typeof stdin.pause === 'function') stdin.pause();
  detector.stop();

  return { exitCode, output: dataChunks.join('') };
}

module.exports = { run };
