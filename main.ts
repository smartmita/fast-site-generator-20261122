import { readFileSync, writeFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-opt');
setFlagsFromString('--no-incremental-marking');
setFlagsFromString('--max-semi-space-size=64');

const { solveCasesToBuffer } = (await import('./solve.js')) as {
  solveCasesToBuffer: (cases: { id: string; input: unknown }[]) => Uint8Array;
};

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(`${INPUT_DIR}/cases.json`, 'utf8')) as { id: string; input: unknown }[];
writeFileSync(`${OUTPUT_DIR}/answers.json`, solveCasesToBuffer(cases));
