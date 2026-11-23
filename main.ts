const { readFileSync, writeFileSync } = require('node:fs');
const { setFlagsFromString } = require('node:v8');

// Explicitly enable Maglev on Node 22 (off by default in V8 12.4) while avoiding slow TurboFan tier-up and background threads.
setFlagsFromString('--maglev');
setFlagsFromString('--no-turbofan');
setFlagsFromString('--no-concurrent-recompilation');
setFlagsFromString('--no-incremental-marking');
setFlagsFromString('--no-concurrent-sweeping');

const { solveCasesToBuffer } = require('./core.cjs');

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(`${INPUT_DIR}/cases.json`, 'utf8'));
writeFileSync(`${OUTPUT_DIR}/answers.json`, solveCasesToBuffer(cases));
