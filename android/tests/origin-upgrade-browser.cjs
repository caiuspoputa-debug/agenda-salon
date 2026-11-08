'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),readline=require('node:readline'),{chromium}=require('playwright');
const assets=path.resolve(__dirname,'../app/src/main/assets'),out=path.resolve(__dirname,'../../../salon-release-1.1.2');
const previous=path.join(out,'previous-assets');
require(path.join(assets,'app.js'));const C=global.SalonCore,S=require(path.join(assets,'sync.js'));
const clone=x=>JSON.parse(JSON.stringify(x)),KEY='atelier.app-updates.v1',HOME='https://appassets.androidplatform.net/assets/index.html';
const worker=spawn('python',['-X','utf8',path.join(__dirname,'origin-migration-store.py')]);worker.stderr.pipe(process.stderr);
let sequence=0;const pending=new Map();readline.createInterface({input:worker.stdout}).on('line',line=>{const r=JSON.parse(line);pending.get(r.id)?.(r.result);pending.delete(r.id);});
function call(body){return new Promise(resolve=>{const id=++sequence;pending.set(id,resolve);worker.stdin.write(JSON.stringify({...body,id})+'\n');});}
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const result=[],errors=[],requests=[];
 try{
  const fixture=(await call({path:'/fixture'})).body;
  async function open(version,disk,role,width){
   const context=await browser.newContext({viewport:{width,height:900},isMobile:width<700,hasTouch:true,timezoneId:'Europe/Bucharest'});
   const origin=version==='old'?'https://previous-salon.test':'https://appassets.androidplatform.net',files=version==='old'?previous:assets;
   await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();const name=url.pathname.replace(/^\/assets\//,'/').slice(1)||'index.html';assert.match(name,/^[a-z.-]+$/);const file=path.join(files,name);return route.fulfill({status:fs.existsSync(file)?200:404,body:fs.existsSync(file)?fs.readFileSync(file):'Missing',contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html'});});
   await context.exposeFunction('auditHa',async(endpoint,token,body)=>{requests.push({role,endpoint,ids:body.operations?.map(o=>o.id)||[],bootstrap:!!body.bootstrap});return call({path:endpoint,token,body});});
   await context.addInitScript(({version,disk,KEY})=>{
    window.__disk={...disk};window.__network=false;window.__acks=0;window.__writes=0;
    if(version==='old')localStorage.setItem(KEY,disk.preferences);
    window.Android={load:()=>__disk.state,loadDevice:()=>__disk.device,save:raw=>{__writes++;__disk.state=raw;return true;},saveLocal:(raw,device)=>{__writes++;__disk.state=raw;__disk.device=device;return true;},hasUpdateBackup:()=>true,loadUpdateBackup:()=>disk.state,exportBackup:raw=>window.__export=raw,appUpdateInfo:()=>JSON.stringify({versionName:version==='old'?'1.1.1':'1.1.2',versionCode:version==='old'?36:37}),checkAppUpdate:()=>{throw Error('Automatic check preference was lost');},installAppUpdate:()=>{throw Error('Unexpected installation');},syncRequest:async(id,base,endpoint,token,raw)=>{const reply=__network?await auditHa(endpoint,token,JSON.parse(raw)):{ok:false,status:0,error:'Offline test'};window.salonSyncResponse(id,JSON.stringify(reply));}};
    if(version==='new')window.SalonOriginMigration={readCapturedPreferences:()=>JSON.stringify({captured:true,raw:disk.preferences}),finishUpdatePreferences:()=>{if(localStorage.getItem(KEY)!==disk.preferences)throw Error('Preference lost');__acks++;queueMicrotask(()=>window.SalonOriginMigrationReady());}};
   },{version,disk,KEY});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(version==='old'?origin+'/index.html':HOME);await page.locator('.shell').waitFor();
   return{context,page};
  }
  for(const [role,width] of [['master',1024],['secondary',390]]){
   const credentials=fixture.devices[role];
   // Each device starts from the current server state and has one offline change.
   const remote=(await call({path:'/v1/sync',token:credentials.token,body:{deviceId:credentials.deviceId,workspaceId:credentials.workspaceId,operations:[]}})).body;
   const base=C.validateState(clone(remote.state)),state=clone(base);state.clients[0].notes='Offline '+role+' preserved after update';
   let device={...S.createDevice(credentials.deviceId),role,enabled:true,joined:true,workspaceId:credentials.workspaceId,token:credentials.token,base:clone(base),serverRevision:remote.serverRevision,logoSchemaVersion:1};
   device=S.validateDevice(S.queueChange(device,base,state,'pending-'+role,'2026-11-08T09:00:00.000Z'));
   const disk={state:JSON.stringify(state),device:JSON.stringify(device),preferences:JSON.stringify({automatic:false,lastCheck:1794124800000,deferDay:'2026-11-08'})};
   const old=await open('old',disk,role,width);const oldDisk=await old.page.evaluate(()=>({...__disk,preferences:localStorage.getItem('atelier.app-updates.v1')}));assert.deepEqual(JSON.parse(oldDisk.state),state);await old.context.close();
   const next=await open('new',oldDisk,role,width),p=next.page;
   assert.equal(await p.evaluate(()=>__acks),1);const preserved=await p.evaluate(()=>({...__disk,preferences:localStorage.getItem('atelier.app-updates.v1')}));
   assert.deepEqual(JSON.parse(preserved.state),JSON.parse(oldDisk.state));assert.deepEqual(JSON.parse(preserved.device),JSON.parse(oldDisk.device));assert.equal(preserved.preferences,oldDisk.preferences);
   await p.locator('.nav').getByRole('button',{name:'Setări',exact:true}).click();assert.equal(await p.getByLabel('Activează sincronizarea prin HA',{exact:true}).isChecked(),true);assert.equal(await p.getByLabel('Verifică automat o dată pe zi',{exact:true}).isChecked(),false);
   await p.getByRole('button',{name:'Exportă backup',exact:true}).click();assert.deepEqual(JSON.parse(await p.evaluate(()=>__export)),state);
   await p.screenshot({path:path.join(out,'Upgrade-'+width+'.png'),fullPage:true});
   await p.evaluate(()=>{__network=true;dispatchEvent(new Event('online'));});
   await p.getByRole('button',{name:'Sincronizează acum',exact:true}).click();await p.waitForFunction(()=>JSON.parse(__disk.device).queue.length===0);
   const final=await p.evaluate(()=>({...__disk,preferences:localStorage.getItem('atelier.app-updates.v1')}));assert.deepEqual(JSON.parse(final.state),state);assert.equal(JSON.parse(final.device).token,credentials.token);assert.equal(JSON.parse(final.device).deviceId,credentials.deviceId);
   const server=(await call({path:'/v1/sync',token:credentials.token,body:{deviceId:credentials.deviceId,workspaceId:credentials.workspaceId,operations:[]}})).body;assert.deepEqual(server.state,state);assert.equal(server.state.appointments.length,fixture.state.appointments.length);
   result.push({role,width,rawBusinessPreserved:true,haConfigurationAndPendingQueuePreserved:true,updatePreferencesPreserved:true,pendingOperationAppliedOnce:true,serverRevision:server.serverRevision});await next.context.close();
   const reopen=await open('new',final,role,width);assert.deepEqual(JSON.parse(await reopen.page.evaluate(()=>__disk.state)),state);await reopen.context.close();
  }
  const backup=(await call({path:'/verify-backup'})).body;assert.equal(backup.restorable,true);assert.deepEqual(errors,[]);assert(requests.every(r=>!r.bootstrap&&r.endpoint!=='/v1/register'));
  fs.writeFileSync(path.join(out,'Upgrade-HA-browser.json'),JSON.stringify({passed:true,cases:result,backupRestorable:true,noNewRegistration:true,noServerBootstrap:true,errors,requests,physicalDeviceTested:false},null,2));console.log('PASS old APK UI -> packaged HTTPS UI: both roles, exact agenda/settings/HA credentials/outbox, updater preferences, real HA Store sync and backup restore');
 }finally{await browser.close();worker.stdin.end();}
})().catch(e=>{console.error(e);process.exitCode=1;worker.stdin.end();});
