/* eslint-disable @typescript-eslint/no-require-imports -- optional Playwright smoke test. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const url = process.env.CHAT_URL;
  assert.ok(url, 'Set CHAT_URL to the server for the model under test');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url);
    const box = page.getByRole('textbox').first();
    await box.fill('Make a calculator with buttons for digits, addition (+), equals (=), and clear (Clear).');
    await box.press('Enter');
    await page.getByRole('button', { name: 'Run preview' }).click({ timeout: 120000 });
    const frame = page.frameLocator('iframe');
    await frame.getByRole('button', { name: '2', exact: true }).waitFor();
    const displayValues = () => frame.locator('body').evaluate(body =>
      Array.from(body.querySelectorAll('*')).filter(node =>
        !node.children.length && !node.closest('button,[role="button"],script,style,template') &&
        node.getClientRects().length > 0
      ).map(node => node.matches('input,textarea') ? node.value : node.textContent.trim()));
    const initial = await displayValues();
    for (const name of ['2', '+', '3', '=']) {
      await frame.getByRole('button', { name, exact: true }).click();
    }
    const result = await displayValues();
    const display = result.findIndex((value, i) => value === '5' && initial[i] !== '5');
    assert.ok(display >= 0, '2 + 3 must change the display to 5');
    await frame.getByRole('button', { name: /^(clear|c|ac)$/i }).click();
    const cleared = await displayValues();
    assert.ok(cleared[display] === '' || cleared[display] === '0', 'Clear must reset the display');
    console.log('PASS: generated calculator rendered, calculated and cleared');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
