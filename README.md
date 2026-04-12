# claude-voice-cue

Hear **"Input needed"** when Claude Code is waiting on you.

This is a one-file hook for Claude Code. You install it once; after that you
run plain `claude` exactly as before, and your machine speaks when Claude
pauses for permission, a plan review, or any other input.

No wrapper command, no alias, no new workflow. Uses Claude Code's native
`Notification` hook, so detection is exact — no heuristics and no false
positives.

## Install

```sh
git clone https://github.com/arpan-k09/claude-voice-cue.git
cd claude-voice-cue
npm install                           # zero dependencies
node bin/claude-voice-cue.js install
```

That writes a single entry into `~/.claude/settings.json`. If the file
already exists, a timestamped `.bak.*` is created first and any of your
existing hooks are left untouched.

Verify it:

```sh
node bin/claude-voice-cue.js            # shows install status
node bin/claude-voice-cue.js test       # speaks the cue once
```

Then use Claude Code normally:

```sh
claude
```

When it stops to ask you something, you'll hear it.

### Optional: put `claude-voice-cue` on PATH

```sh
npm link
claude-voice-cue status
```

## Uninstall

```sh
node bin/claude-voice-cue.js uninstall
```

Removes only the hook entry this tool added. Any other hooks you have
configured are preserved.

## How it works

We register on **two** Claude Code hook events, so the cue fires as soon
as Claude actually needs input rather than after an idle debounce:

- **`PermissionRequest`** — fires immediately when a tool-approval or
  plan-approval dialog appears. This is the common case ("Claude wants
  to run a command, y/n?") and it's what gives the cue a sub-100ms
  reaction time.
- **`Notification`** — kept as a safety net for other attention-wanted
  cases (auth prompts, elicitation dialogs, idle waits). The `idle_prompt`
  matcher on this event debounces on an inactivity timer, which is why
  registering *only* on `Notification` previously produced a 2–3s delay
  before the cue played.

**macOS fast path.** On install we pre-generate
`~/.claude/claude-voice-cue.aiff` once (via `say -r 220 -o`) and register
a hook on both events that plays it with `afplay`:

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "afplay \"/Users/you/.claude/claude-voice-cue.aiff\"" }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "afplay \"/Users/you/.claude/claude-voice-cue.aiff\"" }
        ]
      }
    ]
  }
}
```

`afplay` bypasses both node startup (~100ms) and `say`'s voice-engine
cold start (~500–1000ms), so once the event fires the cue starts playing
within ~100ms.

**Other platforms.** The hook falls back to `node bin/cue.js`, which
dispatches to `espeak` (Linux) or PowerShell SAPI (Windows) via
`src/notifier.js`. Same feature, slightly more startup lag.

The hook runs asynchronously, so a slow TTS call cannot block Claude's UI.
If no TTS backend is installed, the cue silently falls back to the bell.

## Project layout

```
bin/claude-voice-cue.js    status / install / uninstall / test CLI
bin/cue.js                 the tiny script Claude Code's hook invokes
src/installer.js           safe settings.json merge + atomic write + backup
src/notifier.js            platform TTS dispatch, non-blocking, fail-silent
test/installer.test.js     13 cases covering install/uninstall/idempotency
test/notifier.test.js      spawn stub verifying per-platform dispatch
```

Zero runtime dependencies.

## Known limitations

- The cue phrase is hardcoded to "Input needed". Edit `src/notifier.js` if
  you want to change it.
- Linux requires `espeak` for actual speech: `sudo apt install espeak`.
  Without it you get the terminal bell.
- Claude Code's Notification hook fires whenever Claude needs attention, so
  the cue fires on both permission prompts and idle waits. If that ever
  feels noisy in practice we can add debouncing — not before.
