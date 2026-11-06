'use strict';
// Actual Salon frontend and HA operation journal; synthetic business state only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),zlib=require('node:zlib'),{chromium}=require('playwright');
const assets=path.resolve(__dirname,'../app/src/main/assets'),out=path.resolve(__dirname,'../../../outputs');
require(path.join(assets,'app.js'));require(path.join(assets,'legacy-logo.js'));
const C=global.SalonCore,S=require(path.join(assets,'sync.js')),legacy=global.SalonLegacyLogoData;
const clone=x=>JSON.parse(JSON.stringify(x));let assertions=0;
function same(a,b,label){assertions++;assert.deepEqual(a,b,label);}function ok(a,label){assertions++;assert(a,label);}
function chunk(kind,data=Buffer.alloc(0)){const body=Buffer.concat([Buffer.from(kind),data]),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);let crc=0xffffffff;for(const value of body){crc^=value;for(let i=0;i<8;i++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([head,body,tail]);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(2);ihdr.writeUInt32BE(2,4);ihdr[8]=8;ihdr[9]=6;
const customBytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(Buffer.alloc(18,0))),chunk('IEND')]);
const custom='data:image/png;base64,'+customBytes.toString('base64');ok(C.validSalonLogo(legacy));ok(C.validSalonLogo(custom));ok(custom!==legacy);
const stamp='2026-11-06T06:00:00.000Z',origin='https://salon-logo-migration.test';
const results=[],screenshots=[],errors=[];
const names=['app.js','logo.js','legacy-logo.js','index.html','styles.css','sync-ui.js'];
const hashes=()=>Object.fromEntries(names.map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(assets,name))).digest('hex')]));
const frozen=hashes();
function fixture(kind){
 const fresh=kind==='fresh'||kind==='fresh-join-legacy';
 let base=C.validateState(C.createDemo('2026-11-06'));base.demo=false;base.appointments[0].price=87.5;base.appointments[0].notes='Synthetic historical price retained';base.settings.workspace.defaultView='day';
 let state=clone(base);state.clients[0].notes='Synthetic offline note retained';
 if(kind==='custom')base.settings.workspace.logoData=state.settings.workspace.logoData=custom;
 if(kind==='explicit-empty')base.settings.workspace.logoData=state.settings.workspace.logoData=null;
 let device={...S.createDevice('logo-migration-device'),role:'master',enabled:false,joined:!fresh&&kind!=='unjoined',workspaceId:!fresh&&kind!=='unjoined'?'logo-migration-workspace':'',token:!fresh&&kind!=='unjoined'?'a'.repeat(64):'',base:!fresh&&kind!=='unjoined'?clone(base):null,serverRevision:!fresh&&kind!=='unjoined'?1:0,localBackup:clone(base),preMigrationBackup:clone(base),preservedMarker:'existing-device-metadata'};
 device=S.queueChange(device,base,state,'offline-client-edit',stamp);if(kind==='marked-absence')device.logoSchemaVersion=1;
 if(fresh)state=null;
 return {state,device:S.validateDevice(device),backup:clone(base)};
}
async function snapshot(page){return page.evaluate(()=>({state:JSON.parse(localStorage.getItem('fixture.state')),device:JSON.parse(localStorage.getItem('fixture.device')),writes:Number(localStorage.getItem('fixture.writes')||0),backup:JSON.parse(localStorage.getItem('fixture.backup'))}));}
async function display(page,expected){const img=page.locator('.salon-header-logo');same(await img.getAttribute('src'),expected||null);same(await img.isVisible(),!!expected);if(expected)ok(await img.evaluate(n=>n.complete&&n.naturalWidth>0));}
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  for(const kind of ['fresh','implicit','unjoined','custom','explicit-empty','save-failure','marked-absence','fresh-join-legacy'])for(const width of [390,1024]){
   const initial=fixture(kind),label=kind+'/'+width,external=[],requests=[];
   const context=await browser.newContext({viewport:{width,height:width<700?844:1000},isMobile:width<700,hasTouch:true,locale:'ro-RO',timezoneId:'Europe/Bucharest'});
   try{
    await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==origin){external.push(u.href);return route.abort();}const name=u.pathname==='/'?'index.html':u.pathname.slice(1);requests.push(name);if(!/^[a-z-]+\.(?:js|css|html|png)$/.test(name)||!fs.existsSync(path.join(assets,name)))return route.fulfill({status:404,body:''});return route.fulfill({body:fs.readFileSync(path.join(assets,name)),contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':'text/html'});});
    await context.addInitScript(({initial,failed,legacy,joinLegacy})=>{
     if(!localStorage.getItem('fixture.ready')){localStorage.setItem('fixture.ready','1');localStorage.setItem('fixture.fail',failed?'1':'0');localStorage.setItem('fixture.device',JSON.stringify(initial.device));localStorage.setItem('fixture.backup',JSON.stringify(initial.backup));if(initial.state)localStorage.setItem('fixture.state',JSON.stringify(initial.state));}
     const write=()=>localStorage.setItem('fixture.writes',String(Number(localStorage.getItem('fixture.writes')||0)+1));
     window.Android={load:()=>localStorage.getItem('fixture.state')||'',loadDevice:()=>localStorage.getItem('fixture.device')||'',save:raw=>{localStorage.setItem('fixture.state',raw);write();return true;},saveLocal:(raw,meta)=>{if(localStorage.getItem('fixture.fail')==='1'&&JSON.parse(raw).settings.workspace.logoData===legacy)return false;localStorage.setItem('fixture.state',raw);localStorage.setItem('fixture.device',meta);write();return true;},hasUpdateBackup:()=>true,loadUpdateBackup:()=>localStorage.getItem('fixture.backup'),exportBackup:raw=>{window.fixtureExport=raw;},syncRequest:(id,base,endpoint,token,json)=>{if(!joinLegacy)throw Error('Unexpected synthetic HA call');const payload=JSON.parse(json),info={protocol:1,capabilities:['suppliers-v1','client-deletion-v1','salon-logo-v1'],workspaceId:'logo-migration-workspace',initialized:true};let body=info;if(endpoint==='/v1/register')body={...info,token:'b'.repeat(64)};if(endpoint==='/v1/sync')body={...info,state:initial.backup,serverRevision:1,results:payload.operations.map(op=>({id:op.id,status:'applied',keys:op.changes.map(c=>c.key)}))};queueMicrotask(()=>window.salonSyncResponse(id,JSON.stringify({ok:true,status:200,body})));}};
    },{initial,failed:kind==='save-failure',legacy,joinLegacy:kind==='fresh-join-legacy'});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(label+': '+e.message));page.setDefaultTimeout(12000);await page.clock.setFixedTime(new Date(stamp));await page.goto(origin);await page.locator('.shell').waitFor();
    let saved=await snapshot(page),expectedLogo=['fresh','fresh-join-legacy','marked-absence','explicit-empty'].includes(kind)?null:kind==='custom'?custom:legacy;
    await display(page,expectedLogo);
    if(kind==='fresh'){
     same(saved.state.settings.workspace.logoData,null);ok(!JSON.stringify(saved.state).includes(legacy),'fresh agenda never stores previous portrait');same(saved.device.queue.length,0);same(saved.state.clients,[]);same(saved.state.services,[]);same(saved.state.appointments,[]);
    }else if(kind==='fresh-join-legacy'){
     same(saved.state.settings.workspace.logoData,null);await page.locator('.nav').getByRole('button',{name:'Setări',exact:true}).click();await page.getByLabel('Activează sincronizarea prin HA',{exact:true}).check();await page.getByLabel('Cheia de asociere HA',{exact:true}).fill('synthetic-pairing-key-1234');await page.getByRole('button',{name:'Salvează conexiunea',exact:true}).click();await page.getByRole('button',{name:'Preia agenda HA',exact:true}).click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('fixture.device')).joined);saved=await snapshot(page);same(saved.state,initial.backup,'explicit join takes the old HA agenda without inventing a global logo');same(saved.device.logoSchemaVersion,1,'fresh installation keeps the committed local schema marker across join');ok(!Object.hasOwn(saved.state.settings.workspace,'logoData'),'joined old server has absent logo, not rewritten settings');await display(page,null);
    }else if(kind==='custom'||kind==='explicit-empty'||kind==='marked-absence'){
     same(saved.state,initial.state,'existing explicit choice not rewritten');same(saved.device,initial.device,'existing metadata not rewritten');same(saved.writes,0);
    }else{
     if(kind==='save-failure'){
      same(saved.state,initial.state,'failed migration preserves entire original state');same(saved.device,initial.device,'failed migration preserves entire queue and metadata');same(saved.writes,0);ok(!Object.hasOwn(saved.device,'logoSchemaVersion'),'failed atomic save commits no schema marker');await page.evaluate(()=>localStorage.setItem('fixture.fail','0'));await page.reload();await page.locator('.shell').waitFor();saved=await snapshot(page);await display(page,legacy);
     }
     const expected=clone(initial.state);expected.settings.workspace.logoData=legacy;same(saved.state,expected,'migration changes only optional logo field');same(saved.writes,1,'one atomic ordinary save');same(saved.device.logoSchemaVersion,1,'marker commits in the same successful local transaction');same(saved.backup,initial.backup,'pre-update backup untouched');same(saved.device.localBackup,initial.device.localBackup);same(saved.device.preMigrationBackup,initial.device.preMigrationBackup);same(saved.device.base,initial.device.base,'server baseline is never rewritten');same(saved.device.preservedMarker,initial.device.preservedMarker);
     if(kind==='unjoined')same(saved.device,{...initial.device,logoSchemaVersion:1},'standalone identity retained with atomic schema marker, without fabricated queued operation');
     else{
      same(saved.device.queue.length,initial.device.queue.length+1,'migration appends exactly one journal operation');same(saved.device.queue.slice(0,-1),initial.device.queue,'prior operations immutable');const operation=saved.device.queue.at(-1);same(operation.changes.map(c=>c.key),['settings']);same(operation.changes[0].before,initial.state.settings);same(operation.changes[0].after,saved.state.settings);
      let map=S.flatten(initial.device.base);for(const op of saved.device.queue)for(const change of op.changes){same(map[change.key]||null,change.before,'journal CAS chain preserved');if(change.after===null)delete map[change.key];else map[change.key]=clone(change.after);}same(S.flatten(S.inflate(map)),S.flatten(saved.state),'journal replays to committed state');
     }
    }
    // All five primary headers read the same stored choice, including blank.
    for(const nav of ['Calendar','Clienți','Servicii','Rapoarte','Setări']){await page.locator('.nav').getByRole('button',{name:nav,exact:true}).click();await display(page,expectedLogo);}
    await page.getByRole('button',{name:'Exportă backup',exact:true}).click();same(JSON.parse(await page.evaluate(()=>window.fixtureExport)),saved.state,'ordinary backup contains committed state and selected logo');
    await page.getByRole('button',{name:'Exportă copia de dinaintea actualizării',exact:true}).click();same(JSON.parse(await page.evaluate(()=>window.fixtureExport)),initial.backup,'raw before-update copy remains available');
    await page.reload();await page.locator('.shell').waitFor();same(await snapshot(page),saved,'reopening does not duplicate migration');await display(page,expectedLogo);
    if(kind==='implicit'&&width===390){
     await page.locator('.nav').getByRole('button',{name:'Setări',exact:true}).click();await page.locator('[data-logo-file]').setInputFiles({name:'synthetic-custom.png',mimeType:'image/png',buffer:customBytes});await page.waitForFunction(expected=>JSON.parse(localStorage.getItem('fixture.state')).settings.workspace.logoData!==expected,legacy);const uploaded=await snapshot(page);ok(C.validSalonLogo(uploaded.state.settings.workspace.logoData),'uploaded PNG is validated');await page.getByRole('button',{name:'Șterge logo-ul',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Șterge logo-ul',exact:true}).click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('fixture.state')).settings.workspace.logoData===null);await display(page,null);await page.reload();await page.locator('.shell').waitFor();await display(page,null);const removed=await snapshot(page);same(removed.state.settings.workspace.logoData,null,'explicit removal remains empty after restart');for(const field of ['clients','services','appointments'])same(removed.state[field],saved.state[field],field+' unchanged after logo removal');
    }
    if(kind==='fresh'||kind==='implicit'){await page.evaluate(()=>window.scrollTo(0,0));const file=path.join(out,'Salon-activation-logo-'+kind+'-'+width+'.png');await page.screenshot({path:file});screenshots.push(file);}
    same(external,[],'no external services invoked');ok(!requests.includes('salon-logo.png'),'old implicit file is not requested');results.push({case:kind,width,passed:true});console.log('PASS '+label+': selected logo, state, journal and backup preserved');
   }finally{await context.close();}
  }
  same(errors,[],'zero runtime errors');same(hashes(),frozen,'tested source remains frozen');
  const report={cases:results.length,assertions,results,sourceHashes:frozen,legacyPngSha256:crypto.createHash('sha256').update(Buffer.from(legacy.split(',')[1],'base64')).digest('hex'),screenshots,physicalDeviceTested:false,limitations:['Chromium with native persistence bridge simulation, no real activation PIN or HA endpoint used.','Existing explicit null is preserved as null and displayed empty per the new reference semantics.']};fs.writeFileSync(path.join(out,'Salon-activation-logo-migration-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cases:results.length,assertions,errors:errors.length}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
