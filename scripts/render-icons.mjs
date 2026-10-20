import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
try {
  const page = await browser.newPage(); const svg = await readFile(new URL('../assets/icons/icon.svg', import.meta.url), 'utf8');
  for (const [size, name] of [[192, 'icon-192.png'], [512, 'icon-512.png'], [180, 'apple-touch-icon.png']]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    await page.screenshot({ path: fileURLToPath(new URL(`../assets/icons/${name}`, import.meta.url)), omitBackground: true });
  }
} finally { await browser.close(); }
