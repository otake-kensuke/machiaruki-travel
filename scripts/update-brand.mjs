import { readFile, writeFile } from 'node:fs/promises';
import { BRAND } from '../src/brand.js';
const indexURL = new URL('../index.html', import.meta.url);
const manifestURL = new URL('../manifest.webmanifest', import.meta.url);
const index = await readFile(indexURL, 'utf8');
const safe = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const nextIndex = index
  .replace(/<title>.*?<\/title>/, `<title>${safe(BRAND.name)}｜旅行ノート</title>`)
  .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]+/, `$1${safe(BRAND.name)}`)
  .replace(/(<meta name="theme-color" content=")[^"]+/, `$1${BRAND.themeColor}`)
  .replace(/(<[^>]+data-brand-name[^>]*>)[^<]*/g, `$1${safe(BRAND.name)}`)
  .replace(/(<[^>]+data-brand-subtitle[^>]*>)[^<]*/g, `$1${safe(BRAND.subtitle)}`)
  .replace(/(class="brand"[^>]*aria-label=")[^"]+/, `$1${safe(BRAND.name)} ホーム`);
const manifest = JSON.parse(await readFile(manifestURL, 'utf8'));
Object.assign(manifest, { name: `${BRAND.name}｜旅行ノート`, short_name: BRAND.name, theme_color: BRAND.themeColor, background_color: BRAND.backgroundColor });
const nextManifest = JSON.stringify(manifest, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (index !== nextIndex || (await readFile(manifestURL, 'utf8')).replace(/\r\n/g, '\n') !== nextManifest) throw new Error('Brand text is stale. Run node scripts/update-brand.mjs');
  console.log('HTML and PWA display names match src/brand.js.');
} else { await writeFile(indexURL, nextIndex); await writeFile(manifestURL, nextManifest); console.log('Updated HTML and PWA display name.'); }
