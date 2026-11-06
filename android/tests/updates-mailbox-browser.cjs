/* Actual app.js/updater DOM with a native mailbox adapter. No real providers,
 * APK/network access or business saves. Native push is deliberately absent. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const assets=path.resolve(__dirname,'../app/src/main/assets'),origin='https://fixture-updater-mailbox.test';
require(path.join(assets,'app.js'));const Sync=require(path.join(assets,'sync.js'));const initial=global.SalonCore.createDemo('2026-11-05');initial.demo=false;const device=Sync.createDevice('salon-updater-fixture');Object.assign(device,{role:'master',enabled:false,joined:true,base:JSON.parse(JSON.stringify(initial))});Object.defineProperty(initial,'fixtureDevice',{value:Sync.validateDevice(device),enumerable:true});initial.appointments[1].price=77;
const hashes=()=>Object.fromEntries(['app.js','updates.js'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(assets,name))).digest('hex')]));
const current={status:'current',message:'Ai deja cea mai nouă versiune.'},error={status:'error',message:'Verificarea a durat prea mult. Verifică internetul și încearcă din nou.'},available={status:'available',versionCode:999,versionName:'99.0.0',notes:'Actualizare de test, fără descărcare.'};
const nav=(p,name)=>p.getByRole('navigation',{name:'Navigare principală'}).getByRole('button',{name,exact:true});
(async()=>{
 const before=hashes(),results=[],browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 async function open(width,queued=false){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:width<700,hasTouch:true,timezoneId:'Europe/Bucharest'}),errors=[],external=[];
  await context.route('**/*',r=>{const url=new URL(r.request().url());if(url.origin!==origin){external.push(url.href);return r.abort();}const name=url.pathname==='/'?'index.html':url.pathname.slice(1),file=path.resolve(assets,name);if(!file.startsWith(assets+path.sep)||!fs.existsSync(file))return r.fulfill({status:404,body:'Missing'});return r.fulfill({body:fs.readFileSync(file),contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html'});});
  await context.addInitScript(({state,queued})=>{
   localStorage.setItem('atelier.app-updates.v1',JSON.stringify({automatic:false,lastCheck:0}));window.__state=JSON.stringify(Object.fromEntries(Object.entries(state).filter(([k])=>k!=='fixtureDevice')));window.__device=JSON.stringify(state.fixtureDevice);window.__calls=[];window.__writes=0;window.__mail=Object.create(null);window.__revision=0;window.__getterReads=0;window.__getterOverride='';
   window.__record=(id,stage,result)=>{__mail[id]=JSON.stringify({requestId:id,stage,revision:++__revision,...(result?{result}:{})});};
   window.Android={load:()=>__state,loadDevice:()=>__device,saveLocal:()=>{__writes++;throw Error('Updater must not save business data');},hasUpdateBackup:()=>false,appUpdateInfo:()=>JSON.stringify({versionCode:30,versionName:'1.0.19'}),checkAppUpdate:id=>{__calls.push({id,kind:'check'});__record(id,queued?'queued':'started');},appUpdateResult:id=>{__getterReads++;return __getterOverride||__mail[id]||'';},installAppUpdate:id=>{__calls.push({id,kind:'install'});__record(id,'progress',{status:'downloading',message:'Se descarcă și se verifică actualizarea…'});}};
   
  },{state:initial,queued});
  const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.clock.install({time:new Date('2026-11-05T18:00:00.000Z')});await p.goto(origin);await p.waitForSelector('.shell');await p.addStyleTag({content:'*{animation:none!important;transition:none!important}'});await nav(p,'Setări').click();
  const card=p.locator('.app-updates'),original=await p.evaluate(()=>({state:__state,device:__device,writes:__writes}));
  async function start(){await card.getByRole('button',{name:'Verifică acum',exact:true}).click();return await p.evaluate(()=>__calls.at(-1).id);}
  async function retain(id,payload){await p.evaluate(({id,payload})=>__record(id,'terminal',payload),{id,payload});}
  async function intact(){assert.deepEqual(await p.evaluate(()=>({state:__state,device:__device,writes:__writes})),original);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);}
  return{p,context,card,start,retain,intact};
 }
 async function scenario(width,name,run,queued=false){const f=await open(width,queued);try{await run(f);await f.intact();results.push({width,name});console.log('PASS '+width+' '+name);}finally{await f.context.close();}}
 try{
  for(const width of [390,1024]){
   for(const payload of [current,error])await scenario(width,'lost native push '+payload.status,async f=>{
    const {p,card}=f,id=await f.start();await f.retain(id,payload);await p.clock.fastForward(251);assert.equal(await card.getByRole('button',{name:'Verifică acum',exact:true}).isEnabled(),true);assert.equal(await p.locator('#toast.show').innerText(),payload.message);assert.equal(await card.locator('.app-update-status').innerText(),payload.message);
    const prefs=await p.evaluate(()=>JSON.parse(localStorage.getItem('atelier.app-updates.v1')));assert.equal(!!prefs.lastCheck,payload.status==='current');
    await p.clock.fastForward(5000);await p.evaluate(({id})=>{onAppUpdateResult(id,{status:'error',message:'Late push must be ignored'});dispatchEvent(new Event('focus'));},{id});assert.equal(await p.locator('#toast.show').count(),0);assert.equal(await card.locator('.app-update-status').innerText(),payload.message);assert.equal(await p.evaluate(()=>__calls.length),1);
   });
   await scenario(width,'lost available result preserves client draft and opens popup after close',async f=>{
    const {p}=f,id=await f.start();await nav(p,'Clienți').click();await p.getByRole('button',{name:'Adaugă client',exact:true}).click();await p.getByLabel('Nume client *',{exact:true}).fill('Ciornă de test');await p.getByLabel('Observații',{exact:true}).fill('Date nesalvate păstrate');
    const draft=await p.locator('#modal-root input,#modal-root textarea').evaluateAll(nodes=>nodes.map(n=>n.value));await p.evaluate(()=>window.__focused=document.activeElement);await f.retain(id,available);await p.clock.fastForward(251);
    assert.equal(await p.locator('.app-update-prompt').count(),0);assert.deepEqual(await p.locator('#modal-root input,#modal-root textarea').evaluateAll(nodes=>nodes.map(n=>n.value)),draft);assert.equal(await p.evaluate(()=>document.activeElement===__focused),true);
    await p.getByRole('button',{name:'Închide',exact:true}).last().click();await p.locator('.app-update-prompt').waitFor();assert.equal(await p.locator('.app-update-prompt').count(),1);await p.locator('.app-update-prompt').getByRole('button',{name:'Mai târziu',exact:true}).click();assert.equal(await p.evaluate(()=>__calls.filter(c=>c.kind==='install').length),0);
   });
   await scenario(width,'mailbox and push finish only once; stale request cannot finish retry',async f=>{
    const {p,card}=f,old=await f.start();await f.retain(old,error);await p.evaluate(({id,payload})=>onAppUpdateResult(id,payload),{id:old,payload:error});await p.clock.fastForward(251);assert.equal(await card.getByRole('button',{name:'Verifică acum',exact:true}).isEnabled(),true);
    const fresh=await f.start();assert.notEqual(fresh,old);await p.evaluate(id=>window.__getterOverride=__mail[id],old);await p.clock.fastForward(251);assert.equal(await card.getByRole('button',{name:'Se verifică…',exact:true}).isDisabled(),true);
    await p.evaluate(()=>window.__getterOverride='');await f.retain(fresh,current);await p.clock.fastForward(251);assert.equal(await card.locator('.app-update-status').innerText(),current.message);await p.evaluate(id=>onAppUpdateResult(id,{status:'error',message:'Old push'}),old);assert.equal(await card.locator('.app-update-status').innerText(),current.message);assert.equal(await p.evaluate(()=>__calls.length),2);
    await p.clock.fastForward(5000);await p.evaluate(()=>dispatchEvent(new Event('focus')));assert.equal(await p.locator('#toast.show').count(),0);
   });
   await scenario(width,'foreground reads retained result before expired JS deadline',async f=>{
    const {p,card}=f,id=await f.start();await p.evaluate(()=>{window.__hidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>__hidden});document.dispatchEvent(new Event('visibilitychange'));});await f.retain(id,current);
    await p.clock.setFixedTime(new Date('2026-11-05T18:00:21.000Z'));await p.evaluate(()=>{window.__hidden=false;document.dispatchEvent(new Event('visibilitychange'));dispatchEvent(new Event('focus'));});assert.equal(await card.locator('.app-update-status').innerText(),current.message);assert.equal(await p.locator('#toast.show').innerText(),current.message);assert.equal(await card.getByRole('button',{name:'Verifică acum',exact:true}).isEnabled(),true);await p.clock.fastForward(1000);assert.equal(await card.locator('.app-update-status').innerText(),current.message);
   });
   await scenario(width,'installation progress and terminal use mailbox without duplicate install',async f=>{
    const {p,card}=f,id=await f.start();await f.retain(id,available);await p.clock.fastForward(251);await p.locator('.app-update-prompt').getByRole('button',{name:'Instalează',exact:true}).click();assert.match(await card.locator('.app-update-status').innerText(),/Se descarcă/);await p.clock.fastForward(1000);assert.equal(await p.evaluate(()=>__calls.filter(c=>c.kind==='install').length),1);const installId=await p.evaluate(()=>__calls.at(-1).id);assert.notEqual(installId,id);await f.retain(installId,{status:'permission',message:'Permite instalarea din Agenda Salon, apoi reîncearcă.'});await p.clock.fastForward(251);assert.match(await card.locator('.app-update-status').innerText(),/Permite instalarea/);assert.equal(await card.getByRole('button',{name:'Instalează actualizarea',exact:true}).isEnabled(),true);assert.equal(await p.evaluate(()=>__calls.filter(c=>c.kind==='install').length),1);
   });
   await scenario(width,'queued bridge timeout explains Android did not start',async f=>{
    const {p,card}=f;await f.start();await p.clock.fastForward(20001);assert.match(await card.locator('.app-update-status').innerText(),/Android nu a pornit verificarea/);assert.doesNotMatch(await card.locator('.app-update-status').innerText(),/internet/);assert.equal(await card.getByRole('button',{name:'Verifică acum',exact:true}).isEnabled(),true);assert.equal(await p.evaluate(()=>__calls.length),1);
   },true);
  }
  assert.deepEqual(hashes(),before);console.log(JSON.stringify({passed:results.length,scenarios:results,businessWrites:0,sourceHashes:before}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
