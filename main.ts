import { readFileSync, writeFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-opt');
setFlagsFromString('--no-concurrent-recompilation');
setFlagsFromString('--no-incremental-marking');

const { solveCasesToBuffer } = await import('./solve.js');

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(`${INPUT_DIR}/cases.json`, 'utf8'));
writeFileSync(`${OUTPUT_DIR}/answers.json`, solveCasesToBuffer(cases));
