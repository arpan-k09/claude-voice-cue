#!/usr/bin/env node
'use strict';

const { run } = require('../src/runner');

run(process.argv.slice(2)).then(
  ({ exitCode }) => process.exit(exitCode),
  (err) => {
    process.stderr.write(`claude-voice-cue: ${err.message}\n`);
    process.exit(1);
  }
);
