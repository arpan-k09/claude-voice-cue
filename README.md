# claude-voice-cue

A small cross-platform CLI wrapper around `claude code` that speaks
**"Input needed"** when the process is likely waiting on you.

It is a transparent passthrough: arguments, stdin, stdout, exit codes,
window resizes, and signals all flow through unchanged. The TUI runs
inside a PTY so interactivity is not degraded.

## Install

```sh
git clone <this repo>
cd claude-voice-cue
npm install            # builds node-pty
npm link               # exposes `claude-voice-cue` on PATH
```

Requires Node.js 18+ and `claude` on your `PATH`.

To point at a different binary, set `CLAUDE_VOICE_CUE_CMD`.

## Usage

```sh
claude-voice-cue                  # same as `claude code`
claude-voice-cue --resume         # args are forwarded verbatim
claude-voice-cue path/to/project
```

Platform notes for the audio cue:

| Platform | Mechanism | Fallback |
|---|---|---|
| macOS | `say "Input needed"` | — |
| Linux | `espeak "Input needed"` | terminal bell (`\a`) |
| Windows | PowerShell SAPI | terminal bell |

If no TTS backend is available, the wrapper still works — it just falls
back to a bell or stays silent. Notification failures never affect the
child process.

## How input detection works

There is no reliable, general-purpose way for an outside observer to know
when a TUI is "waiting for input". We use two cheap, complementary signals:

1. **Pattern match** on a small ANSI-stripped tail of recent output:
   trailing `?`, `(y/n)`, `[Y/n]`, "press enter", "confirm", "proceed",
   "continue?", and common selection carets (`❯ › »`).
2. **Output-then-silence**: after output arrives, if the stream goes
   quiet for ~1.5s **and** the tail still looks prompt-ish, fire.

Both share a single ~6s debounce so a single prompt produces a single cue.

### Tradeoffs (intentional)

- **False positives.** A prose `?` from the model can trigger a cue. The
  debounce keeps this tolerable; tightening the patterns would cause
  false negatives, which are worse for this use case.
- **False negatives.** A custom prompt with no recognizable marker
  (e.g. a bare text input) may be missed by the pattern layer; the
  idle-after-output heuristic catches many of these but not all.
- **No TUI introspection.** We deliberately do not parse claude's
  rendered frames or escape sequences. That would be brittle and would
  break on every upstream UI change.

## Project layout

```
bin/claude-voice-cue.js   # entry point
src/runner.js             # PTY orchestration, signal & resize forwarding
src/detector.js           # ANSI strip + prompt heuristics + debounce
src/notifier.js           # platform TTS dispatch, non-blocking, fail-silent
```

Each module has one job and ~100 lines or fewer. There are no plugin
hooks, no config files, and no runtime flags by design.

## Known limitations

- `node-pty` is a native module and must compile on install. This is the
  price of true PTY fidelity; piping stdio degrades the TUI.
- Windows support is implemented but exercised less than macOS/Linux.
- Heuristic detection is, and will remain, heuristic.

## Possible future work

- Optional `--quiet` env var to suppress the cue without unwrapping.
- A small set of recorded test fixtures (captured PTY streams) to pin
  detector behavior across claude code versions.
