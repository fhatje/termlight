/**
 * Builds the published package into lib/: `tsc -p tsconfig.lib.json` emits one .js and .d.ts per
 * source file, so the bundler of the embedding application sees ordinary ES modules and still
 * splits out the matcher worker itself. What tsc leaves alone is fixed up afterwards.
 *
 *     node tools/build-lib.ts
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'lib';

rmSync(OUT, { recursive: true, force: true });
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.lib.json'], { stdio: 'inherit' });

// 1. Declaration files keep the .ts extension of import paths and the stylesheet imports.
let declarations = 0;
for (const entry of readdirSync(OUT, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.d.ts')) continue;
  const file = join(entry.parentPath, entry.name);
  const source = readFileSync(file, 'utf8');
  const rewritten = source
    .replace(/((?:from|import)\s*\(?\s*['"]\.{1,2}\/[^'"]*)\.ts(['"])/g, '$1.js$2')
    // A stylesheet import says nothing about types, and a strict consumer has no declaration for it.
    .replace(/^import\s+['"][^'"]+\.css['"];?\n/gm, '');
  if (rewritten !== source) writeFileSync(file, rewritten);
  declarations++;
}

// 2. The worker is referenced by URL, which is a string to tsc.
const dictionary = join(OUT, 'providers/recognizers/dictionary.js');
const source = readFileSync(dictionary, 'utf8');
const workerUrl = "new URL('./matcher.worker.ts', import.meta.url)";
if (source.split(workerUrl).length !== 2) throw new Error(`${dictionary}: expected exactly one ${workerUrl}`);
writeFileSync(dictionary, source.replace(workerUrl, workerUrl.replace('.worker.ts', '.worker.js')));

const left = readdirSync(OUT, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath, entry.name))
  .filter((file) => /['"]\.{1,2}\/[^'"\n]*\.ts['"]/.test(readFileSync(file, 'utf8')));
if (left.length) throw new Error(`.ts import paths left in: ${left.join(', ')}`);

console.log(`lib/: ${declarations} modules`);
