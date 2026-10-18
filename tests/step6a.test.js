import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generatedWorker } from '../scripts/update-shell.mjs';

test('コミットするService Workerの全アセットhashと版が現在のコードと一致', async () => {
  const worker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  assert.equal(worker.replace(/\r\n/g, '\n'), await generatedWorker());
});
test('ES Moduleの依存先・HTMLの静的参照がすべて同じ版のキャッシュに含まれる', async () => {
  const worker = await generatedWorker();
  const manifest = JSON.parse(worker.match(/const SHELL = (\{[\s\S]*?\});/)[1]);
  const base = 'https://example.test/machiaruki-travel/';
  const paths = new Set(manifest.assets.map(asset => new URL(asset.path, base).href));
  for (const asset of manifest.assets) {
    assert.match(asset.path, /^\.\//); assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    if (!/\.(js|html|webmanifest)$/.test(asset.path)) continue;
    const text = await readFile(new URL(`../${asset.path}`, import.meta.url), 'utf8');
    const refs = asset.path.endsWith('.js') ? [...text.matchAll(/^\s*import\s+(?:[^'";\n]*?\bfrom\s*)?['"]([^'"]+)['"]/gm)].map(match => match[1])
      : asset.path.endsWith('.html') ? [...text.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)].map(match => match[1])
        : JSON.parse(text).icons.map(icon => icon.src);
    for (const ref of refs) assert.ok(paths.has(new URL(ref, new URL(asset.path, base)).href), `${asset.path} depends on uncached ${ref}`);
  }
});
