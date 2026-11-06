/* Full native UI regression: terminal manual update results remain visible at
 * phone/tablet scroll positions. SDK/native service adapters are simulated;
 * production app.js, updates.js and toast rendering execute unchanged. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const assets=path.resolve(__dirname,'../app/src/main/assets'),origin='https://fixture-updater.test',out=path.resolve(__dirname,'../../../outputs');
require(path.join(assets,'app.js'));const Sync=require(path.join(assets,'sync.js'));const initial=global.SalonCore.createDemo('2026-11-05');initial.demo=false;const device=Sync.createDevice('salon-updater-fixture');Object.assign(device,{role:'master',enabled:false,joined:true,base:JSON.parse(JSON.stringify(initial))});Object.defineProperty(initial,'fixtureDevice',{value:Sync.validateDevice(device),enumerable:true});initial.appointments[1].price=77;initial.clients[0].notes='Notă locală păstrată';
const sourceHashes=()=>Object.fromEntries(['app.js','updates.js','styles.css','index.html'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(assets,name))).digest('hex')]));
const nav=(page,name)=>page.getByRole('navigation',{name:'Navigare principală'}).getByRole('button',{name,exact:true});
const current={status:'current',message:'Ai deja cea mai nouă versiune.'},networkError={status:'error',message:'Nu am putut verifica actualizările. Verifică internetul și încearcă din nou.'};
(async()=>{
 const tested=sourceHashes(),results=[];const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 async function fixture(width,automatic=false){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:width<700,hasTouch:true,timezoneId:'Europe/Bucharest'}),errors=[],external=[];
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin){external.push(url.href);return route.abort();}const name=url.pathname==='/'?'index.html':url.pathname.slice(1),file=path.resolve(assets,name);if(!file.startsWith(assets+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:'Missing'});return route.fulfill({body:fs.readFileSync(file),contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html'});});
  await context.addInitScript(({state,automatic})=>{localStorage.setItem('atelier.app-updates.v1',JSON.stringify({automatic,lastCheck:0}));window.__calls=[];window.__installs=0;window.__writes=0;window.__state=JSON.stringify(Object.fromEntries(Object.entries(state).filter(([k])=>k!=='fixtureDevice')));window.__device=JSON.stringify(state.fixtureDevice);window.Android={load:()=>__state,loadDevice:()=>__device,saveLocal:()=>{__writes++;throw Error('Updater must not alter any agenda');},hasUpdateBackup:()=>false,appUpdateInfo:()=>JSON.stringify({versionCode:30,versionName:'1.0.19'}),checkAppUpdate:id=>__calls.push(id),installAppUpdate:()=>{__installs++;throw Error('No install in visibility regression');}};},{state:initial,automatic});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.clock.install({time:new Date('2026-11-05T18:00:00.000Z')});await page.goto(origin);await page.waitForSelector('.shell');await page.addStyleTag({content:'*{animation:none!important;transition:none!important}'});
  const baseline=await page.evaluate(()=>({state:__state,device:__device,writes:__writes}));
  const card=page.locator('.app-updates'),check=()=>card.getByRole('button',{name:'Verifică acum',exact:true}),reply=payload=>page.evaluate(payload=>onAppUpdateResult(__calls.at(-1),payload),payload);
  async function intact(){assert.deepEqual(await page.evaluate(()=>({state:__state,device:__device,writes:__writes})),baseline);assert.equal(await page.evaluate(()=>__installs),0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);}
  async function toastVisible(pattern){const toast=page.locator('#toast.show');await toast.waitFor({state:'visible'});assert.match(await toast.innerText(),pattern);const bounds=await toast.boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=844,'toast is actually inside the viewport');return bounds;}
  return {context,page,card,check,reply,intact,toastVisible};
 }
 try{
  for(const width of [390,1024]){
   const f=await fixture(width),{page,card,check,reply}=f;
   try{
    await nav(page,'Setări').click();
    for(const position of ['top','bottom'])for(const kind of ['current','error','offline','timeout']){
     await page.clock.fastForward(4300);
     const y=position==='top'?5:680;
     await check().evaluate((button,top)=>window.scrollTo(0,scrollY+button.getBoundingClientRect().top-top),y);
     const before=await check().boundingBox();assert.ok(before.y>=0&&before.y+before.height<780,'manual button is visible and tappable');
     const callsBefore=await page.evaluate(()=>__calls.length);
     if(kind==='offline')await page.evaluate(()=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false}));
     await check().tap();
     if(kind!=='offline'){
      assert.equal(await card.getByRole('button',{name:'Se verifică…',exact:true}).isDisabled(),true);
      assert.equal(await page.locator('#toast.show').count(),0,'no completion notification during pending request');
      if(kind==='timeout')await page.clock.fastForward(21000);else await reply(kind==='current'?current:networkError);
     }
     const pattern=kind==='current'?/cea mai nouă/:kind==='error'?/Nu am putut verifica/:kind==='offline'?/Nu există conexiune/:/durat prea mult/;
     const toast=await f.toastVisible(pattern);assert.equal(await check().isDisabled(),false);assert.equal(await page.locator('.app-update-prompt').count(),0);
     if(kind==='offline'){assert.equal(await page.evaluate(()=>__calls.length),callsBefore);await page.evaluate(()=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true}));}
     const status=await card.locator('.app-update-status').evaluate(node=>{const box=node.getBoundingClientRect();return {top:box.top,bottom:box.bottom};});
     if(position==='top'&&kind==='current')assert.ok(status.bottom<=0,'this exercises the original offscreen-result trigger');
     await f.intact();results.push({width,position,kind,status,toast});
     if(position==='top'&&['current','error'].includes(kind))await page.screenshot({path:path.join(out,'Salon-actualizare-notificare-'+kind+'-'+width+'.png')});
    }
    await page.clock.fastForward(4300);await check().evaluate(button=>button.scrollIntoView({block:'center'}));await check().tap();await reply({status:'available',versionCode:31,versionName:'1.0.20',notes:'Actualizare sintetică, fără descărcare.'});await page.getByRole('dialog',{name:'Actualizare disponibilă',exact:true}).waitFor();assert.equal(await page.locator('#toast.show').count(),0,'available update keeps its existing popup instead of terminal toast');await page.getByRole('button',{name:'Mai târziu',exact:true}).tap();await f.intact();results.push({width,kind:'available-popup-unchanged'});
    await check().evaluate(button=>button.scrollIntoView({block:'center'}));await check().tap();await nav(page,'Clienți').click();await page.getByRole('button',{name:'Adaugă client',exact:true}).click();await page.getByLabel('Nume client *',{exact:true}).fill('Client nesalvat');await page.getByLabel('Telefon · opțional',{exact:true}).fill('0755000011');await page.getByLabel('Observații',{exact:true}).fill('Draft păstrat, fără mutarea focusului');
    const draft=await page.locator('#modal-root input,#modal-root textarea').evaluateAll(nodes=>nodes.map(n=>({value:n.value,name:n.name})));await page.evaluate(()=>window.__focusedBefore= document.activeElement);await reply(current);await f.toastVisible(/cea mai nouă/);assert.equal(await page.evaluate(()=>document.activeElement===window.__focusedBefore),true,'manual completion does not steal form focus');assert.deepEqual(await page.locator('#modal-root input,#modal-root textarea').evaluateAll(nodes=>nodes.map(n=>({value:n.value,name:n.name}))),draft);await f.intact();results.push({width,kind:'form-focus-draft-preserved'});
   }finally{await f.context.close();}
   for(const response of [current,networkError]){const a=await fixture(width,true);try{await a.page.clock.fastForward(1600);assert.equal(await a.page.evaluate(()=>__calls.length),1);await a.reply(response);assert.equal(await a.page.locator('#toast.show').count(),0,'automatic terminal checks remain silent');assert.equal(await a.page.locator('.app-update-prompt').count(),0);await a.intact();results.push({width,kind:'automatic-'+response.status+'-silent'});}finally{await a.context.close();}}
  }
  assert.deepEqual(sourceHashes(),tested,'actual final sources stayed unchanged throughout QA');console.log(JSON.stringify({passed:results.length,results,sourceHashes:tested},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
