/* eslint-disable @typescript-eslint/no-require-imports -- optional Playwright smoke test. */
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch();
 try {
  const page=await browser.newPage();let requests=0;
  page.setDefaultTimeout(120000);
  await page.route('**/api/chat',async route=>{
   if(++requests===1){
    const html="<button id='b'>0</button><script>document.getElementById('b').onclick=()=>{throw new Error('Counter broke')}</script>";
    const delta='root = Card([HtmlArtifact("Broken counter", '+JSON.stringify(html)+')])';
    const events=[{type:'start'},{type:'start-step'},{type:'text-start',id:'1'},{type:'text-delta',id:'1',delta},{type:'text-end',id:'1'},{type:'finish-step'},{type:'finish',finishReason:'stop'}];
    return route.fulfill({headers:{'content-type':'text/event-stream','x-vercel-ai-ui-message-stream':'v1'},body:events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join('')+'data: [DONE]\n\n'});
   }
   const payload=JSON.stringify(route.request().postDataJSON());
   if(!payload.includes('Counter broke')||!payload.includes('Artifact source'))throw Error('Revision context missing');
   await route.continue();
  });
  await page.goto(process.env.CHAT_URL);
  const chat=page.locator('textarea,[contenteditable=true]').first();await chat.fill('Make a counter');await chat.press('Enter');
  const broken=page.getByRole('region',{name:'Broken counter'});
  await broken.getByRole('button',{name:'Run preview'}).click();
  await broken.getByText(/Preview loaded/).waitFor();
  await page.frameLocator('iframe[title="Broken counter"]').getByRole('button',{name:'0'}).click();
  await broken.getByText(/JavaScript error: .*Counter broke/).waitFor();
  if(requests!==1)throw Error('Preview called the model');
  await broken.getByLabel('What should change?').fill('Fix the counter so the button itself starts at 0 and reads 1 after the first click.');
  await broken.getByRole('button',{name:'Request revision'}).click();
  await page.getByRole('button',{name:'Run preview',exact:true}).last().click();
  const fixed=page.frameLocator('.html-artifact iframe').last();
  await fixed.locator('button').first().waitFor({timeout:6000});
  const before=await fixed.locator('body').innerText();
  const button=fixed.getByRole('button',{name:/increment|count|\+|^0$/i}).first();
  await button.click({timeout:4000});
  const after=await fixed.locator('body').innerText();
  if(before===after||!/(^|\D)1(\D|$)/.test(after))throw Error(JSON.stringify({before,after}));
  if(requests!==2)throw Error('Unexpected requests');
  console.log('PASS: detected the failure, sent one repair request, and played the repaired artifact');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
