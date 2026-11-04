/* eslint-disable @typescript-eslint/no-require-imports -- optional Playwright smoke test. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const url = process.env.CHAT_URL;
  assert.ok(url, 'Set CHAT_URL to a server configured for gpt-oss:20b');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url);
    const box = page.getByRole('textbox').first();
    await box.fill('Make a calculator with buttons for digits, addition (+), equals (=), and clear (Clear).');
    await box.press('Enter');
    await page.getByRole('button', { name: 'Run preview' }).click({ timeout: 120000 });
    const frame = page.frameLocator('iframe');
    for (const name of ['2', '+', '3', '=']) {
      await frame.getByRole('button', { name, exact: true }).click();
    }
    const visibleText = () => frame.locator('body').evaluate(body =>
      body.innerText + '\n' + Array.from(body.querySelectorAll('input'), input => input.value).join('\n'));
    assert.match(await visibleText(), /(?:^|\n)5(?:\n|$)/, '2 + 3 displays 5');
    await frame.getByRole('button', { name: /^(clear|c|ac)$/i }).click();
    assert.doesNotMatch(await frame.locator('body').evaluate(body =>
      Array.from(body.querySelectorAll('input,output,[id]'), node =>
        node.matches('input') ? node.value : node.innerText).filter(text => text === '5').join('\n')
    ), /^5$/m, 'Clear removes the result');
    console.log('PASS: GPT-OSS calculator generated, rendered, calculated and cleared');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
