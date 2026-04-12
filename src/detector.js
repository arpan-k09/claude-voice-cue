'use strict';

// Strip ANSI escape sequences (CSI, OSC, single-char escapes).
// Source: a minimal subset sufficient for prompt-text extraction.
const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;

function stripAnsi(s) {
  return s.replace(ANSI_RE, '');
}

// Patterns that strongly suggest the TUI is awaiting user input.
// Order matters only for readability; all are evaluated equally.
const PROMPT_PATTERNS = [
  /\?\s*$/m,                       // line ending in a question mark
  /\(y\/n\)/i,
  /\[y\/N\]/i,
  /\[Y\/n\]/i,
  /\bpress\s+enter\b/i,
  /\bconfirm\b/i,
  /\bproceed\b/i,
  /\bcontinue\?\b/i,
  /❯|›|»/,                         // common TUI selection carets
];

/**
 * InputDetector
 *
 * Two complementary signals:
 *   1. Pattern match against a small ANSI-stripped tail buffer.
 *   2. "Output then silence" — output arrived, then the stream went quiet
 *      for `idleMs`. This catches prompts that don't match any pattern
 *      (e.g. a bare input field) but only fires if the tail also looks
 *      prompt-ish, to keep false positives down.
 *
 * Both signals share a single debounce window so we never speak twice
 * for the same prompt.
 */
class InputDetector {
  constructor({ onPrompt, debounceMs = 6000, idleMs = 1500, tailBytes = 4096 } = {}) {
    this.onPrompt = onPrompt;
    this.debounceMs = debounceMs;
    this.idleMs = idleMs;
    this.tailBytes = tailBytes;
    this.tail = '';
    this.lastFireAt = 0;
    this.idleTimer = null;
  }

  feed(chunk) {
    const text = stripAnsi(chunk.toString('utf8'));
    if (!text) return;
    this.tail = (this.tail + text).slice(-this.tailBytes);

    if (this._matchesPrompt(this.tail)) {
      this._fire('pattern');
    }

    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this._onIdle(), this.idleMs);
  }

  stop() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  _matchesPrompt(text) {
    for (const re of PROMPT_PATTERNS) {
      if (re.test(text)) return true;
    }
    return false;
  }

  _onIdle() {
    // Only fire on idle if the tail still looks like a prompt. Otherwise
    // routine streaming pauses would constantly trigger the cue.
    if (this._matchesPrompt(this.tail)) {
      this._fire('idle');
    }
  }

  _fire(reason) {
    const now = Date.now();
    if (now - this.lastFireAt < this.debounceMs) return;
    this.lastFireAt = now;
    try {
      this.onPrompt(reason);
    } catch {
      // Notifier errors must never break the wrapper.
    }
  }
}

module.exports = { InputDetector, stripAnsi };
