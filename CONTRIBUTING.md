# Contributing

Thanks for your interest. `claude-voice-cue` is intentionally small;
the bar for new features is "does it extend the fast path or remove a
real source of bugs?" Documentation, tests, and cross-platform support
improvements are always welcome.

## Dev setup

```sh
git clone https://github.com/arpan-k09/claude-voice-cue.git
cd claude-voice-cue
npm install      # should be zero-op — there are no runtime deps
npm test         # runs installer + notifier suites (<1s)
```

Node 18 or newer is required. There are no build steps.

## Running locally against your real Claude Code install

```sh
# install (writes to ~/.claude/settings.json, backs it up first)
node bin/claude-voice-cue.js install

# verify
node bin/claude-voice-cue.js           # status
node bin/claude-voice-cue.js test      # plays the cue

# remove
node bin/claude-voice-cue.js uninstall
```

Every install creates a timestamped backup of `settings.json` before
any change. If anything goes wrong you can always restore from
`~/.claude/settings.json.bak.<timestamp>`.

## Running tests in isolation

The installer test suite uses a per-test `mktemp` directory as a fake
`$HOME`, so it never touches your real settings. You can also drive the
CLI against an isolated home:

```sh
HOME=$(mktemp -d) node bin/claude-voice-cue.js install
```

## Pull requests

- Open an issue first if the change is larger than ~50 lines or
  touches the settings-merge logic. It's cheaper to align on approach
  before code than after.
- Keep unrelated changes out of the same PR.
- Add or update tests for anything that changes installer or notifier
  behavior. Both suites are zero-dependency and use a minimal in-file
  runner — match the existing style, don't add a test framework.
- Keep commits focused and written so the subject line works as a
  changelog entry.

## Code style

- Node 18 stdlib only. No runtime dependencies. Dev dependencies are
  strongly discouraged; if you think you need one, open an issue first.
- `'use strict'` at the top of every source file.
- No emoji in code or commit messages unless explicitly requested.
- Comments explain *why*, not *what*. If a line needs a comment to
  explain what it does, rewrite the line.
- Defensive coding at the boundaries (file I/O, shell-out,
  user-controlled JSON). Trust internal callers.

## Reporting bugs and feature requests

Use the templates under `.github/ISSUE_TEMPLATE/`. Bug reports that
include the output of `node bin/claude-voice-cue.js` and the relevant
section of `~/.claude/settings.json` (redact other hooks if you'd
rather not share them) are dramatically easier to action.

## Code of conduct

Be decent. Disagreements are welcome, condescension is not. Maintainer
discretion applies.
