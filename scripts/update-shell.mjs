import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const marker = /\/\/ SHELL_MANIFEST_START[\s\S]*?\/\/ SHELL_MANIFEST_END/;
const normalized = value => value.replace(/\r\n/g, '\n');
const digest = value => createHash('sha256').update(value).digest('hex');

async function walk(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? walk(`${directory}/${entry.name}`) : `${directory}/${entry.name}`))).flat();
}

export async function generatedWorker() {
  const template = normalized(await readFile(path.join(root, 'sw.js'), 'utf8'));
  if (!marker.test(template)) throw new Error('Missing shell manifest markers');
  const files = ['index.html', 'manifest.webmanifest', ...((await walk('src')).filter(file => file.endsWith('.js'))),
    ...((await walk('assets')).filter(file => /\.(css|svg|png)$/.test(file))),
    'samples/hokkaido-2026.sample.json', 'samples/hokkaido-2026.itinerary.json'].sort();
  const assets = await Promise.all(files.map(async filename => {
    const text = /\.(html|webmanifest|js|css|svg|json)$/.test(filename);
    const raw = await readFile(path.join(root, filename));
    return { path: `./${filename}`, text, sha256: digest(text ? normalized(raw.toString('utf8')) : raw) };
  }));
  const release = digest(template.replace(marker, '// SHELL_MANIFEST') + JSON.stringify(assets)).slice(0, 20);
  const block = `// SHELL_MANIFEST_START\nconst SHELL = ${JSON.stringify({ release, assets }, null, 2)};\n// SHELL_MANIFEST_END`;
  return template.replace(marker, block);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const output = await generatedWorker();
  if (process.argv.includes('--check')) {
    if (normalized(await readFile(path.join(root, 'sw.js'), 'utf8')) !== output) throw new Error('Shell manifest is stale. Run node scripts/update-shell.mjs');
    console.log('Shell manifest and release hashes match all app files.');
  } else { await writeFile(path.join(root, 'sw.js'), output); console.log('Updated sw.js asset hashes and release.'); }
}
