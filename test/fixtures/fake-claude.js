#!/usr/bin/env node
'use strict';

// Stand-in for `claude`. Mimics the shape:
//   fake-claude code [args...]
// Emits some plain output, then a prompt-ish line, reads one byte from
// stdin, echoes it, and exits with code 0.

if (process.argv[2] !== 'code') {
  process.stderr.write(`fake-claude: expected first arg 'code'\n`);
  process.exit(2);
}

process.stdout.write('booting fake claude...\n');
process.stdout.write('reading project files\n');

setTimeout(() => {
  process.stdout.write('Apply changes? (y/n) ');
}, 50);

process.stdin.setEncoding('utf8');
process.stdin.once('data', (buf) => {
  process.stdout.write(`\ngot: ${JSON.stringify(buf[0])}\n`, () => {
    setTimeout(() => process.exit(0), 30);
  });
});
