# Architecture

This document explains how `claude-voice-cue` is put together and,
more importantly, the engineering decisions behind it. The interesting
story is not the current 300 lines of code — it is the path that led
there.

## What the tool does

On install, `claude-voice-cue`:

1. Pre-generates `~/.claude/claude-voice-cue.aiff` (macOS only) using
   `say -r 220 -o`.
2. Merges two hook entries into `~/.claude/settings.json`:
   - `PermissionRequest` — fires on tool/plan approval dialogs
   - `Notification` — fires on auth prompts, elicitation, and idle waits
3. Both entries point at the same shell command:
   - macOS: `afplay <cached .aiff>`
   - other: `node <repo>/bin/cue.js` → platform TTS via `src/notifier.js`

At runtime, Claude Code fires one of these hooks when it needs the
user's attention, and its hook runner spawns our command
asynchronously. We do nothing at runtime except play the sound.

## Module breakdown

```
bin/claude-voice-cue.js    user CLI: status / install / uninstall / test
bin/cue.js                 fallback hook entrypoint, calls notifier.speak()
src/installer.js           settings.json merge, atomic write, backup, idempotency
src/notifier.js            platform TTS dispatch, non-blocking, fail-silent
```

Each module has exactly one responsibility. `installer.js` never
touches audio; `notifier.js` never touches `settings.json`;
`bin/claude-voice-cue.js` is pure argv dispatch.

## Why not a PTY wrapper?

The project originally *was* a PTY wrapper. The first working version
(commit `dc85f81`) spawned `claude code` inside a `node-pty` child,
proxied stdin/stdout/stderr/resize/signals, and watched the output
stream with a layered heuristic detector:

- Strip ANSI escapes from a sliding tail buffer
- Match against a pattern set (`?`, `(y/n)`, "confirm", "proceed",
  "press enter", selector carets)
- Fall back to an "output-then-silence" idle heuristic, gated by the
  same patterns to prevent false positives on routine streaming pauses
- Debounce both signals through a single 6-second window so one prompt
  produced exactly one cue

It worked. The detector had 10 passing unit tests and the PTY
integration test drove a fake child over a real pseudo-terminal. The
shape of the problem was right. The implementation was fine.

It was also **the wrong architecture**, for reasons that only became
clear once Claude Code's own hook system was understood:

| Concern | PTY wrapper | Native hook |
|---|---|---|
| Installation friction | User must type `claude-voice-cue` or alias `claude` | User types `claude` as before |
| Subcommand coverage | Hardcoded to `claude code`; `claude chat` etc. break | Works with every subcommand |
| Detection accuracy | Heuristic — false positives and false negatives both real | Exact — Claude tells us directly |
| Runtime deps | `node-pty` native module, prebuild, spawn-helper perms issue | None |
| Lines of code | ~450 + tests | ~300 + tests |
| Resilience to Claude UI changes | Any TUI change risks breaking the detector | Hook contract is stable |

So commit `3d18f39` deleted the runner, the detector, the PTY
integration test, the `node-pty` dependency, and the postinstall
permissions fix — 532 lines gone. The replacement was ~120 lines of
settings-merge logic plus a five-line hook entrypoint. The feature
got better and the code got smaller.

**The lesson.** When a platform gives you a purpose-built integration
point, use it. The time spent on a clever workaround is wasted if the
platform changes, and it's wasted twice if the platform already has a
better answer and you didn't notice. Throwing away working code for
less code is often the highest-leverage thing you can do.

## Why both `PermissionRequest` and `Notification`?

The first hook-based version (`3d18f39`) registered only on
`Notification`, and the cue fired 2–3 seconds *after* Claude visually
showed each permission prompt. Not unusable, but clearly degraded.

The cause, confirmed by reading the Claude Code hook docs: the
`Notification` event covers multiple matchers, including `idle_prompt`,
which debounces on a user-inactivity timer. Registering an empty
matcher catches all notifications — including the debounced ones —
which means the cue has to wait out the idle timer every time.

The fix (commit `68ffac5`) adds a second registration on
`PermissionRequest`, which fires the instant a tool-approval or
plan-approval dialog appears with no debounce. `Notification` stays as
a safety net for auth prompts, elicitation, and other
attention-wanted cases that don't go through `PermissionRequest`.

Both events point at the same command, so there is no duplicated
setup work and no risk of divergent behavior.

## The macOS fast path

The naive hook command was `node bin/cue.js` → `say "Input needed"`.
Measured end-to-end latency from hook fire to first audible sample:
roughly **600–1100ms**, attributable to:

| Stage | Cost |
|---|---|
| `node` startup (require, parse, dispatch) | ~100ms |
| `child_process.spawn('say', ...)` | ~50ms |
| `say` voice-engine cold start | ~500–1000ms |

That's before `say` begins synthesizing any audio.

Commit `10c4d57` replaces this chain with a one-shot `afplay` against
a file pre-generated at install time:

| Stage | Cost |
|---|---|
| `afplay` startup (no node, no TTS) | ~50–100ms |
| File decode + playback start | negligible |

Measured end-to-end latency: **~100ms**, roughly 10× faster. The
tradeoff is that install now takes an extra ~1.5s to run `say -o`
once. That's an excellent trade.

A small additional win: we pass `-r 220` to `say` at generation time,
which shortens the spoken phrase itself by ~250ms without sacrificing
intelligibility.

## Settings-merge safety

`src/installer.js` is the most defensive part of the codebase because
it mutates a user-controlled JSON file that Claude Code also reads.
The rules:

1. **Never clobber.** Before any write, copy the existing file to
   `<file>.bak.<ISO-timestamp>`.
2. **Fail closed on invalid JSON.** If the existing settings file does
   not parse, refuse to install and point the user at it. Do not
   guess, do not truncate.
3. **Atomic write.** Every mutation goes through a temp file and
   `fs.renameSync` so the real path is never in a half-written state.
4. **Scoped ownership.** We identify "our" entries by the substring
   `claude-voice-cue` in the command string. The installer only ever
   reads, replaces, or removes entries that contain that marker. Every
   other hook the user has configured is left byte-identical.
5. **Idempotent.** Re-running `install` when the current command is
   already registered is a zero-write no-op (no backup, no mutation).
6. **Upgrade-in-place.** If a prior install's absolute path has
   drifted (user moved the repo) or the prior command used the node
   fallback and the current environment supports `afplay`, we replace
   the existing entry in place rather than appending a duplicate.

All six rules are covered by tests in `test/installer.test.js`.

## Non-goals

The project deliberately does not:

- Ship a plugin system. There is one job to do.
- Offer a config file. Everything is one install step.
- Expose environment variables for tuning. None exist.
- Add debouncing on top of Claude Code's. The native events are
  already appropriately coarse-grained.
- Detect "prompts" heuristically. Claude Code tells us directly.

When a future requirement genuinely needs one of these, it can be
added; until then, adding them would be speculative complexity.

## Known tradeoffs and future work

- **Fast path is macOS-only.** Linux and Windows still go through
  `bin/cue.js`. Extending the pre-generate-and-play trick to `espeak
  -w` + `aplay` (Linux) and SAPI-to-wav + `SoundPlayer` (Windows) is
  the obvious next move.
- **Hardcoded phrase.** "Input needed" is baked in. A `--phrase` flag
  on `install` would be trivial to add if anyone asks.
- **`Notification` idle delay is still present.** For cases that only
  go through `Notification` (and not `PermissionRequest`), the idle
  debounce still applies. This is a property of Claude Code's event
  model, not something the hook layer can work around.
