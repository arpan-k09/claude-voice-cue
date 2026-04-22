# claude-voice-cue

**An audible heads-up when Claude Code is waiting on you.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)](#platform-support)
[![Works with Claude Code](https://img.shields.io/badge/works%20with-Claude%20Code-8A2BE2.svg)](https://code.claude.com)
[![Zero dependencies](https://img.shields.io/badge/deps-0-success.svg)](package.json)

`claude-voice-cue` installs a native Claude Code hook that plays a short
voice cue the instant Claude needs your input — tool approval, plan
review, auth prompt. You keep running `claude` exactly as before; the
tool disappears into the background after a single install step.

It is a tiny project (~300 lines of code, zero runtime dependencies) and
it deliberately does one thing.

---

## The problem

Agentic coding tools like Claude Code spend a lot of their runtime
working autonomously — reading files, running tests, calling tools. A
developer's rational response is to tab away and do something else while
the agent works. The moment the agent needs an approval ("can I run this
shell command? (y/n)"), the terminal silently waits. If you're in a
different window, you don't notice. Minutes get wasted per prompt, and
there can be dozens of prompts per session.

The fix is obvious: play a sound. But doing it *well* — without false
positives, without lag, without fighting the host's TUI — is
surprisingly particular work, and no platform-native solution shipped
with the product.

## How it works

```
Claude Code  ─┐
              │  fires PermissionRequest / Notification hook
              ▼
   ~/.claude/settings.json
              │
              │  spawns registered command
              ▼
    afplay <cached .aiff>          ◄─── macOS fast path
           — or —
    node bin/cue.js  →  say/espeak/SAPI     ◄─── fallback
```

At install time we write two hook entries into
`~/.claude/settings.json` and pre-generate a short audio file into
`~/.claude/claude-voice-cue.aiff`. When Claude Code fires either event,
its hook runner spawns `afplay` against the cached file. No runtime
process, no stdout polling, no heuristics.

## Quick start

### Option A — Claude Code plugin (recommended)

Inside a running `claude` session:

```
/plugin marketplace add arpan-k09/claude-voice-cue
/plugin install claude-voice-cue@claude-voice-cue
```

That's it. Claude Code wires up the `PermissionRequest` and `Notification`
hooks automatically; uninstall via `/plugin uninstall claude-voice-cue`.

### Option B — standalone CLI

For users not on a plugin-capable Claude Code version, or who prefer a
shell install that modifies `~/.claude/settings.json` directly:

```sh
git clone https://github.com/arpan-k09/claude-voice-cue.git
cd claude-voice-cue
node bin/claude-voice-cue.js install   # one-time setup, zero deps
```

Then use Claude Code exactly as before:

```sh
claude
# Claude works autonomously, you tab away...
# Claude: "Do you want me to run the migration script? (y/n)"
# 🔊  *Input needed*   <-- fires within ~100ms of the prompt appearing
```

Optionally put the CLI on your `PATH`:

```sh
npm link
claude-voice-cue            # shows install status
claude-voice-cue test       # plays the cue once so you can verify audio
claude-voice-cue uninstall  # removes only our hook entries
```

## Features

| | |
|---|---|
| **Native hook integration** | Uses Claude Code's `PermissionRequest` and `Notification` events — no stdout scraping, no PTY wrapping, no heuristics. |
| **Sub-100ms reaction time** | `PermissionRequest` bypasses the `Notification` idle debounce. Pre-generated audio skips `say`'s 500–1000ms voice-engine cold start. |
| **Cross-platform** | macOS `afplay` fast path; Linux/Windows fall back to TTS via `bin/cue.js`. |
| **Non-blocking** | Hook runs async; a slow TTS call cannot freeze Claude's UI. |
| **Safe installer** | Atomic writes, pre-mutation backup, malformed-JSON refusal, idempotent re-install, unrelated hooks preserved. |
| **Zero runtime dependencies** | The installed tool is pure Node stdlib. No `node-pty`, no native builds. |
| **Zero configuration** | One install command. No config file. No env vars. |

## Platform support

| Platform | Playback | Fallback | Notes |
|---|---|---|---|
| **macOS** | `afplay ~/.claude/claude-voice-cue.aiff` | — | Audio pre-generated at install via `say -r 220 -o`. Fastest path. |
| **Linux** | `node bin/cue.js` → `espeak "Input needed"` | terminal bell (`\a`) | Install `espeak` for actual speech: `sudo apt install espeak`. |
| **Windows** | `node bin/cue.js` → PowerShell SAPI | terminal bell | `System.Speech.Synthesis.SpeechSynthesizer`. |

The `bin/cue.js` fallback adds ~100ms of Node startup plus the TTS
backend's own cold-start cost. Only macOS currently gets the
pre-generated audio path; extending it to Linux (`espeak -w` + `aplay`)
and Windows (`Add-Type SAPI` to a cached `.wav` + `Start-Process`) is
straightforward and tracked as follow-up work.

## Architecture

```
.claude-plugin/
  plugin.json           plugin manifest
  marketplace.json      marketplace listing (so this repo is self-serving)
hooks/
  hooks.json            PermissionRequest + Notification registrations
scripts/
  cue.js                plugin launcher — afplay on macOS, else TTS fallback
assets/
  input-needed.aiff     pre-generated audio shipped with the plugin
bin/
  claude-voice-cue.js   user-facing CLI (Option B): status/install/uninstall/test
  cue.js                CLI hook entry point (fallback for non-macOS)
src/
  installer.js          settings.json merge, backup, atomic write, idempotency
  notifier.js           platform TTS dispatch: say | espeak | SAPI | bell
test/
  installer.test.js     13 zero-dep test cases for install/uninstall lifecycle
  notifier.test.js      3 cases stubbing child_process.spawn
```

Each module has a single responsibility and is under ~200 lines. There
is no plugin system, no configuration layer, and no abstraction beyond
what the problem requires. See [ARCHITECTURE.md](ARCHITECTURE.md) for
the full design rationale, including why the original PTY wrapper
approach was thrown away.

## CLI reference

```
claude-voice-cue             show install status and registered events
claude-voice-cue install     add our hooks to ~/.claude/settings.json
claude-voice-cue uninstall   remove our hooks, leave everything else alone
claude-voice-cue test        play the cue once (verifies audio works)
claude-voice-cue --help      usage
```

## Running the tests

```sh
npm test
```

The full suite runs in <1s, has zero dependencies, and exercises every
lifecycle branch of the installer (fresh install, re-install, upgrade
from stale paths, malformed JSON refusal, unrelated-hook preservation,
empty-hooks cleanup) plus the platform-dispatch logic in the notifier.

## Uninstall

```sh
node bin/claude-voice-cue.js uninstall
```

Removes only our entries from `PermissionRequest` and `Notification`,
drops the cached audio file, and leaves every other hook in
`~/.claude/settings.json` untouched. A timestamped backup of the file
is written before any change is made.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports and feature requests
use the templates under `.github/ISSUE_TEMPLATE/`. The scope of this
project is intentionally narrow; contributions that extend the fast
path to additional platforms, improve safety of the settings merge, or
tighten the test suite are especially welcome.

## License

[MIT](LICENSE) © Arpan Korat

---

Built by [Arpan Korat](https://github.com/arpan-k09).
