/* eslint-disable @typescript-eslint/no-require-imports -- optional Playwright is resolved via NODE_PATH for this standalone check. */
const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();try{
 const p=await b.newPage({viewport:{width:440,height:700}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 let game=p;
 if(process.env.CHAT_URL){
   await p.goto(process.env.CHAT_URL);
   const box=p.getByRole('textbox').first();
   await box.fill('Make an Angry Birds clone.');await box.press('Enter');
   await p.getByRole('button',{name:'Run preview'}).click();
   game=p.frameLocator('iframe[title="Slingshot Garden starter"]');
 } else {
   await p.goto(process.env.GAME_URL || require('url').pathToFileURL(require('path').resolve('src/starters/slingshot.html')).href);
 }
 const canvas=game.locator('canvas');await canvas.focus();await p.keyboard.press('Space');
 await game.locator('#score').filter({hasText:/^[1-9]\d*$/}).waitFor();
 if(await game.locator('#shots').textContent()!=='4')throw Error('Shot count');
 await game.getByRole('button',{name:'Restart',exact:true}).click();
 if(await game.locator('#score').textContent()!=='0'||await game.locator('#shots').textContent()!=='5')throw Error('Reset');
 const r=await canvas.boundingBox(); const at=(x,y)=>[r.x+x*r.width/800,r.y+y*r.height/410];
 await p.mouse.move(...at(150,320));await p.mouse.down();await p.mouse.move(...at(85,348),{steps:8});await p.mouse.up();
 await game.locator('#score').filter({hasText:/^[1-9]\d*$/}).waitFor();
 if(errors.length)throw Error(errors.join('; '));
 console.log('PASS: Launch, hit and restart');
}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
