#!/usr/bin/env node
'use strict';

// Invoked by Claude Code's `Notification` hook. Speaks a short phrase and
// exits. Must be fast, non-blocking, and never throw.
require('../src/notifier').speak();
