'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const assets=path.resolve(__dirname,'../app/src/main/assets');require(path.join(assets,'app.js'));const Sync=require(path.join(assets,'sync.js'));
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});try{
 for(const width of [390,1024]){
  const state=global.SalonCore.createDemo('2026-11-24');state.demo=false;const device=Sync.createDevice('shortcut-fixture');Object.assign(device,{role:'master',enabled:false,joined:true,base:JSON.parse(JSON.stringify(state))});const ctx=await browser.newContext({viewport:{width,height:900}}),errors=[];
  await ctx.route('**/*',r=>{const u=new URL(r.request().url());assert.equal(u.origin,'https://shortcut.test');const file=path.join(assets,u.pathname==='/'?'index.html':u.pathname.slice(1));return r.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});});
  await ctx.addInitScript(({state,device})=>{window.__state=JSON.stringify(state);window.__device=JSON.stringify(device);window.__names=[];window.__autoNames=[];window.Android={load:()=>__state,loadDevice:()=>__device,saveLocal:(s,d)=>{__state=s;__device=d;return true;},hasUpdateBackup:()=>false,nameHomeShortcut:name=>__names.push(name),syncHomeShortcutName:name=>__autoNames.push(name)};},{state,device:Sync.validateDevice(device)});
  const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto('https://shortcut.test/');await p.getByRole('navigation').getByRole('button',{name:'Setări',exact:true}).click();const before=await p.evaluate(()=>JSON.parse(__state));
  await p.getByLabel('Numele salonului',{exact:true}).fill('Salon Narcisa');await p.getByRole('button',{name:'Aplică numele și sub icon',exact:true}).click();await p.waitForFunction(()=>__names.length===1);
  const after=await p.evaluate(()=>JSON.parse(__state));assert.deepEqual(await p.evaluate(()=>__names),['Salon Narcisa']);assert.equal(after.settings.workspace.salonName,'Salon Narcisa');
  const expected=JSON.parse(JSON.stringify(before));expected.settings.workspace.salonName='Salon Narcisa';assert.deepEqual(after,expected);assert.match(await p.title(),/Salon Narcisa/);assert.equal(await p.evaluate(()=>__autoNames.at(-1)),'Salon Narcisa');assert.equal(await p.locator('.mobile-salon-name').innerText(),'Salon Narcisa');
  await p.getByLabel('Numele salonului',{exact:true}).fill('');await p.getByRole('button',{name:'Aplică numele și sub icon',exact:true}).click();assert.equal(await p.evaluate(()=>__names.length),1);assert.deepEqual(await p.evaluate(()=>JSON.parse(__state)),after);assert.deepEqual(errors,[]);
  await ctx.close();console.log('PASS '+width+'px name in app and explicit shortcut action; invalid label rejected; all appointments/settings except intended name unchanged.');
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
