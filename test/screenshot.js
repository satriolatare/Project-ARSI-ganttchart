/* Capture real UI screenshots of the running app for README.md.
 * Requires the dev server on http://localhost:5173
 * Output: docs/screenshots/gantt-chart.png, docs/screenshots/analysis.png */
'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const VIEW = { width: 1600, height: 900, deviceScaleFactor: 2 };

async function shot(page, tab, file, waitFor) {
  await page.evaluate((t) => {
    document.querySelector(`[data-tab="${t}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, tab);
  // allow SVG layout/scroll to settle
  await new Promise(r => setTimeout(r, 600));
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 5000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 200));
  const out = path.join(OUT, file);
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: VIEW.width, height: VIEW.height } });
  console.log('saved', out, fs.statSync(out).size, 'bytes');
}

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-color-profile=srgb']
    });
  } catch (e) {
    console.error('LAUNCH_FAILED:', e.message);
    process.exit(2);
  }
  const page = await browser.newPage();
  await page.setViewport(VIEW);
  await page.goto(BASE + '/', { waitUntil: 'networkidle0', timeout: 30000 });

  // ensure seed data rendered
  await page.waitForSelector('.gantt-wrap, .gantt-empty', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 400));

  // 1) Gantt chart view
  await shot(page, 'gantt', 'gantt-chart.png', '.gantt-bar');

  // 2) Analysis view (critical path stats + PERT)
  await shot(page, 'analysis', 'analysis.png', '.pert-node');

  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('ERROR:', e.stack || e.message); process.exit(1); });
