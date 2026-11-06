/* A user must be able to adopt the automatic check already in progress.
 * Real app/updater/toast rendering; native replies and time are controlled.
 * No APK download, installer, HA request or business mutation is used. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const assets=path.resolve(__dirname,'../app/src/main/assets'),origin='https://fixture-updater-adopt.test',out=path.resolve(__dirname,'../../../outputs');
require(path.join(assets,'app.js'));const Sync=require(path.join(assets,'sync.js'));const initial=global.SalonCore.createDemo('2026-11-05');initial.demo=false;const device=Sync.createDevice('salon-updater-fixture');Object.assign(device,{role:'master',enabled:false,joined:true,base:JSON.parse(JSON.stringify(initial))});Object.defineProperty(initial,'fixtureDevice',{value:Sync.validateDevice(device),enumerable:true});initial.appointments[1].price=77;
const sourceHash=()=>Object.fromEntries(['updates.js','app.js'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(assets,name))).digest('hex')]));
const nav=(p,name)=>p.getByRole('navigation',{name:'Navigare principală'}).getByRole('button',{name,exact:true});
const error={status:'error',message:'Nu am putut verifica actualizările. Verifică internetul și încearcă din nou.'};
(async()=>{
 const before=sourceHash(),results=[],browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 async function open(width){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:width<700,hasTouch:true,timezoneId:'Europe/Bucharest'}),errors=[],external=[];
  await context.route('**/*',r=>{const url=new URL(r.request().url());if(url.origin!==origin){external.push(url.href);return r.abort();}const name=url.pathname==='/'?'index.html':url.pathname.slice(1),file=path.resolve(assets,name);if(!file.startsWith(assets+path.sep)||!fs.existsSync(file))return r.fulfill({status:404,body:'Missing'});return r.fulfill({body:fs.readFileSync(file),contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html'});});
  await context.addInitScript(state=>{localStorage.setItem('atelier.app-updates.v1',JSON.stringify({automatic:true,lastCheck:0}));window.__state=JSON.stringify(Object.fromEntries(Object.entries(state).filter(([k])=>k!=='fixtureDevice')));window.__device=JSON.stringify(state.fixtureDevice);window.__calls=[];window.__writes=0;window.__installs=0;window.Android={load:()=>__state,loadDevice:()=>__device,saveLocal:()=>{__writes++;throw Error('Updater may not write business data');},hasUpdateBackup:()=>false,appUpdateInfo:()=>JSON.stringify({versionCode:30,versionName:'1.0.19'}),checkAppUpdate:id=>__calls.push(id),installAppUpdate:()=>{__installs++;}};},initial);
  const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.clock.install({time:new Date('2026-11-05T18:00:00.000Z')});await p.goto(origin);await p.waitForSelector('.shell');await p.addStyleTag({content:'*{animation:none!important;transition:none!important}'});
  const original=await p.evaluate(()=>({state:__state,device:__device,writes:__writes})),card=p.locator('.app-updates'),pending=()=>card.getByRole('button',{name:'Se verifică…',exact:true}),reply=payload=>p.evaluate(payload=>onAppUpdateResult(__calls[0],payload),payload);
  async function intact(){assert.deepEqual(await p.evaluate(()=>({state:__state,device:__device,writes:__writes})),original);assert.equal(await p.evaluate(()=>__installs),0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);}
  await p.clock.fastForward(1600);assert.equal(await p.evaluate(()=>__calls.length),1);await p.clock.fastForward(10000);
  return{context,p,card,pending,reply,intact};
 }
 try{
  for(const width of [390,1024]){
   for(const terminal of ['current','native-timeout-error','string-error','js-timeout']){
    const f=await open(width),{p,card,pending,reply}=f;
    try{
     await nav(p,'Setări').click();await pending().evaluate(button=>scrollTo(0,scrollY+button.getBoundingClientRect().top-5));
     if(process.env.UPDATER_BASELINE==='1'){
      const disabled=await pending().isDisabled(),bounds=await pending().boundingBox();await p.touchscreen.tap(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await reply({status:'current',message:'Ai deja cea mai nouă versiune.'});
      const observed=await card.evaluate(card=>{const status=card.querySelector('.app-update-status'),box=status.getBoundingClientRect(),button=card.querySelector('.app-update-actions button');return{message:status.textContent,statusTop:box.top,statusBottom:box.bottom,buttonText:button.textContent,buttonDisabled:button.disabled,visibleToast:document.querySelectorAll('#toast.show').length};});
      console.log(JSON.stringify({baseline:true,userTappedWhileAutomaticCheckPending:true,initialButtonDisabled:disabled,nativeRequests:await p.evaluate(()=>__calls.length),after:observed}));await p.screenshot({path:path.join(out,'Salon-actualizare-automata-in-setari-fara-rezultat.png')});assert.equal(disabled,true);assert.equal(observed.visibleToast,0);assert.ok(observed.statusBottom<0);await f.intact();return;
     }
     assert.equal(await pending().isDisabled(),false,'an existing AUTOMATIC request must be adoptable from Settings instead of an inert waiting button');
     await pending().tap();assert.equal(await pending().isDisabled(),true,'an adopted/manual request prevents duplicate presses');assert.equal(await p.evaluate(()=>__calls.length),1,'adoption reuses the existing native request');
     await nav(p,'Calendar').click();await nav(p,'Setări').click();assert.equal(await pending().isDisabled(),true,'manual intent survives full Settings re-render');
     let draft,focus;
     if(terminal==='current'){
      await nav(p,'Clienți').click();await p.getByRole('button',{name:'Adaugă client',exact:true}).click();await p.getByLabel('Nume client *',{exact:true}).fill('Ciornă păstrată');await p.getByLabel('Observații',{exact:true}).fill('Focus păstrat în timpul răspunsului');draft=await p.locator('#modal-root input,#modal-root textarea').evaluateAll(nodes=>nodes.map(n=>n.value));await p.evaluate(()=>window.__focused=document.activeElement);
     }
     if(terminal==='js-timeout'){
      await p.clock.fastForward(10001);
     }else{await p.clock.fastForward(terminal==='native-timeout-error'?5000:1000);await reply(terminal==='current'?{status:'current',message:'Ai deja cea mai nouă versiune.'}:terminal==='string-error'?JSON.stringify(error):error);}
     const toast=p.locator('#toast.show');await toast.waitFor({state:'visible'});assert.match(await toast.innerText(),terminal==='current'?/cea mai nouă/:terminal==='js-timeout'?/durat prea mult/:/Nu am putut verifica/);const b=await toast.boundingBox();assert.ok(b.y>=0&&b.x>=0&&b.y+b.height<=844&&b.x+b.width<=width+1);
     assert.equal(await p.evaluate(()=>__calls.length),1,'no duplicate request and no automatic retry on focus');
     if(draft){assert.deepEqual(await p.locator('#modal-root input,#modal-root textarea').evaluateAll(nodes=>nodes.map(n=>n.value)),draft);assert.equal(await p.evaluate(()=>document.activeElement===window.__focused),true);}
     if(terminal==='js-timeout'){await reply({status:'current',message:'Late current result must be ignored'});assert.match(await toast.innerText(),/durat prea mult/);}
     await f.intact();results.push({width,terminal,adopted:true,nativeRequests:1});console.log('PASS '+width+' automatic→manual '+terminal+': existing request, visible completion, original timer, no data/focus changes');
     if(width===390&&terminal==='native-timeout-error')await p.screenshot({path:path.join(out,'Salon-actualizare-automata-preluata-manual-390.png')});
    }finally{await f.context.close();}
   }
   for(const payload of [{status:'current',message:'Ai deja cea mai nouă versiune.'},error]){
    const f=await open(width);try{await f.reply(payload);assert.equal(await f.p.locator('#toast.show').count(),0,'an unobserved automatic check remains silent');await f.intact();results.push({width,terminal:payload.status,adopted:false});console.log('PASS '+width+' automatic '+payload.status+' remains silent without manual adoption');}finally{await f.context.close();}
   }
   for(const payload of [{status:'current',message:'Ai deja cea mai nouă versiune.'},error]){
    const f=await open(width),{p}=f;try{
     await nav(p,'Setări').click();await f.pending().click();await p.evaluate(()=>{window.__qaHidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__qaHidden});document.dispatchEvent(new Event('visibilitychange'));});await f.reply(payload);assert.equal(await p.locator('#toast.show').count(),0,'background completion waits for foreground instead of losing a timed toast');await p.clock.fastForward(5000);
     await p.evaluate(()=>{window.__qaHidden=false;document.dispatchEvent(new Event('visibilitychange'));dispatchEvent(new Event('focus'));});const notice=p.locator('#toast.show');await notice.waitFor({state:'visible'});assert.equal(await notice.innerText(),payload.message);await p.clock.fastForward(4300);await p.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));dispatchEvent(new Event('focus'));});assert.equal(await p.locator('#toast.show').count(),0,'queued completion is displayed only once');await f.intact();results.push({width,terminal:payload.status,background:true});console.log('PASS '+width+' adopted '+payload.status+' background completion appears once on return');
    }finally{await f.context.close();}
   }
   {
    const f=await open(width),{p}=f;try{
     await nav(p,'Setări').click();await p.clock.setFixedTime(new Date('2026-11-05T18:10:00.000Z'));await p.evaluate(()=>dispatchEvent(new Event('focus')));assert.equal(await p.locator('#toast.show').count(),0,'an overdue unadopted automatic request expires silently');const check=f.card.getByRole('button',{name:'Verifică acum',exact:true});assert.equal(await check.isDisabled(),false);await check.click();assert.equal(await p.evaluate(()=>__calls.length),2,'foreground expiry permits a fresh manual request');
     await f.reply({status:'current',message:'Old automatic callback must be ignored'});assert.equal(await f.pending().isDisabled(),true);assert.equal(await p.locator('#toast.show').count(),0);await p.evaluate(()=>onAppUpdateResult(__calls[1],{status:'current',message:'Ai deja cea mai nouă versiune.'}));await p.locator('#toast.show').waitFor({state:'visible'});await f.intact();results.push({width,terminal:'foreground-expiry-old-callback'});console.log('PASS '+width+' foreground expires old automatic request and ignores its callback during a fresh manual request');
    }finally{await f.context.close();}
   }
  }
  assert.deepEqual(sourceHash(),before,'production source stayed stable throughout QA');console.log(JSON.stringify({passed:results.length,sourceHashes:before}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
