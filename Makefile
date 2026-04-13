# claude-voice-cue — convenience wrapper over the Node CLI.
#
# All targets are thin shims over `node bin/claude-voice-cue.js`. The CLI
# is the source of truth; this Makefile exists so people with muscle
# memory for `make install` / `make test` don't have to learn a new verb.

NODE         ?= node
CLI          := $(NODE) bin/claude-voice-cue.js

.PHONY: help install uninstall status test check clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Register the Claude Code hooks (idempotent, backs up settings.json)
	@$(CLI) install

uninstall: ## Remove only our hook entries, leave everything else intact
	@$(CLI) uninstall

status: ## Show whether the hooks are installed and on which events
	@$(CLI)

test: ## Run the installer + notifier test suites
	@npm test

check: test ## Alias for `test`

clean: ## Remove the cached audio file (install regenerates it)
	@rm -f "$$HOME/.claude/claude-voice-cue.aiff" && echo "removed cached audio"
