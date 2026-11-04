/* eslint-disable @typescript-eslint/no-require-imports -- optional standalone Playwright check. */
const {chromium}=require('playwright');
const {readFile}=require('node:fs/promises');
const {pathToFileURL}=require('node:url');
const {resolve}=require('node:path');
(async()=>{const b=await chromium.launch();try{
const p=await b.newPage({acceptDownloads:true});
const open=f=>p.goto(pathToFileURL(resolve('src/starters',f)).href);
await open('kanban.html');await p.getByLabel('Task',{exact:true}).fill('Draft report');await p.getByRole('button',{name:'Add task'}).click();
await p.getByLabel('Move Draft report',{exact:true}).selectOption('2');
if(!await p.locator('section').filter({hasText:'Done'}).getByText('Draft report').count())throw Error('Move failed');
await p.getByRole('button',{name:'Undo'}).click();
if(!await p.locator('section').filter({hasText:'To do'}).getByText('Draft report').count())throw Error('Undo failed');
await open('spreadsheet.html');const csv='2,3,=A1+B1,"Hello, world"\r\n';
await p.getByLabel('Import CSV').setInputFiles({name:'sample.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
await p.getByRole('status').filter({hasText:'Imported'}).waitFor();
if(await p.getByLabel('C1',{exact:true}).inputValue()!=='5')throw Error('Formula failed');
await p.getByLabel('A1',{exact:true}).fill('7');
if(await p.getByLabel('C1',{exact:true}).inputValue()!=='10')throw Error('Recalculation failed');
const download=p.waitForEvent('download');await p.getByRole('button',{name:'Export CSV'}).click();
const file=await (await download).path();const data=await readFile(file,'utf8');
if(!data.includes('"7","3","=A1+B1","Hello, world"'))throw Error('CSV export failed');
await open('spreadsheet.html');await p.getByLabel('Import CSV').setInputFiles(file);
await p.getByRole('status').filter({hasText:'Imported'}).waitFor();
if(await p.getByLabel('C1',{exact:true}).inputValue()!=='10')throw Error('CSV round-trip failed');
console.log('PASS: kanban add/move/undo; CSV import/export, quoted values and formula recalculation');
}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
