import puppeteer from 'puppeteer-core';

const SCREENSHOTS = '/Users/knamnguyen/Documents/0-Programming/flowser-turborepo/.claude/chrome-devtools/screenshots';

const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null });
const pages = await browser.pages();
let page = pages.find(p => p.url().includes('localhost:4000'));
if (!page) {
  page = await browser.newPage();
  await page.goto('http://localhost:4000/dashboard', { waitUntil: 'networkidle2' });
}
console.log('Tab:', page.url());
await page.bringToFront();
await new Promise(r => setTimeout(r, 2000));
await page.screenshot({ path: SCREENSHOTS + '/dashboard.png' });
console.log('Screenshot saved');

const dollars = await page.evaluate(() =>
  Array.from(document.querySelectorAll('*'))
    .filter(el => el.children.length === 0 && /\$[\d.]+/.test(el.textContent?.trim()))
    .map(el => ({ text: el.textContent.trim(), class: el.className.toString().slice(0,80) }))
    .slice(0, 10)
);
console.log('Dollar amounts on page:', JSON.stringify(dollars, null, 2));
await browser.disconnect();
