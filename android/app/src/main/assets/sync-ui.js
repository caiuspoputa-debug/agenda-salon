(function(global){
 'use strict';
 const STORE='atelier.sync.bundle.v1', LEGACY='atelier.salon.v1';
 const REQUIRED_CAPABILITIES=['suppliers-v1','client-deletion-v1'];
 const hasSalonLogo=state=>!!state?.settings?.workspace&&Object.hasOwn(state.settings.workspace,'logoData');
 function requiresLogoSync(state,device={}){
  const settingsHasLogo=settings=>!!settings?.workspace&&Object.hasOwn(settings.workspace,'logoData');
  return hasSalonLogo(state)||hasSalonLogo(device.base)||hasSalonLogo(device.bootstrap?.state)||
   [...(device.queue||[]),...(device.conflicts||[])].some(operation=>(operation.changes||[]).some(change=>change.key==='settings'&&(settingsHasLogo(change.before)||settingsHasLogo(change.after))));
 }
 function prepareSyncBatch(core,device){
  const candidates=core.prepare(device,50),batch=[];let bytes=16384;
  for(const operation of candidates){
   const text=JSON.stringify(operation),size=typeof global.TextEncoder==='function'?new global.TextEncoder().encode(text).length:unescape(encodeURIComponent(text)).length;
   // Keep each CAS operation atomic; leave the rest queued for the next request.
   if(batch.length&&bytes+size+1>20*1024*1024)break;
   batch.push(operation);bytes+=size+1;
  }
  return batch;
 }
 function requireCapabilities(body,logoRequired=false){
  if(!body||body.protocol!==1||!Array.isArray(body.capabilities)||!REQUIRED_CAPABILITIES.every(capability=>body.capabilities.includes(capability)))throw Object.assign(Error('Actualizează add-on-ul Atelier Sync din HA la versiunea 0.3.0 sau mai nouă, pentru sincronizarea furnizorilor și a clienților șterși. Datele și coada de sincronizare rămân păstrate pe acest dispozitiv.'),{server:true});
  if((logoRequired||hasSalonLogo(body.state))&&!body.capabilities.includes('salon-logo-v1'))throw Object.assign(Error('Pentru sincronizarea logo-ului, actualizează Atelier Sync din HA la versiunea 0.4.0 sau mai nouă. Logo-ul, agenda și modificările netrimise rămân salvate pe acest dispozitiv.'),{server:true});
  return body;
 }
 const clone=x=>JSON.parse(JSON.stringify(x));
 const identifier=()=>global.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);
 function readBundle(){const raw=localStorage.getItem(STORE);return raw?JSON.parse(raw):null;}
 function loadLocalState(){if(global.Android?.load)return null;const bundle=readBundle();return bundle?JSON.stringify(bundle.state):null;}
 function create(hooks){
  const C=global.SalonSyncCore;
  let savedState=clone(hooks.getState()),device,busy=false,deferred=null,timer,error='',corrupt=false,lastGoodUrl='';
  const callbacks=new Map();
  try{const raw=global.Android?.loadDevice?Android.loadDevice():null;device=C.validateDevice(raw?JSON.parse(raw):readBundle()?.device||C.createDevice(identifier()));}
  catch(e){device=C.createDevice(identifier());corrupt=true;error='Setările conexiunii nu au putut fi citite. Datele agendei sunt păstrate; salvează un backup înainte de recuperarea conexiunii.';}
  function write(next,meta){
   try{
    hooks.validate(next);
    const committedMeta=clone(meta);if(hasSalonLogo(next))committedMeta.logoSchemaVersion=1;
    C.validateDevice(committedMeta);
    const stateJson=JSON.stringify(next),deviceJson=JSON.stringify(committedMeta);
    if(global.Android?.saveLocal){if(!Android.saveLocal(stateJson,deviceJson))return false;}
    else if(global.Android?.save){if(committedMeta.joined||committedMeta.token)throw Error('Actualizează aplicația Android.');if(!Android.save(stateJson))return false;localStorage.setItem(STORE,JSON.stringify({state:next,device:committedMeta}));}
    else{localStorage.setItem(STORE,JSON.stringify({state:next,device:committedMeta}));try{localStorage.setItem(LEGACY,stateJson);}catch(e){/* The atomic bundle remains the authoritative copy. */}}
    device=clone(committedMeta);savedState=clone(next);return true;
   }catch(e){return false;}
  }
  function refresh(){hooks.refresh?.();document.querySelectorAll('[data-sync-action]').forEach(control=>{const action=control.dataset.syncAction;control.disabled=busy||action==='run'&&!device.enabled;if(action==='configure')control.textContent=busy?'Se conectează…':'Salvează conexiunea';});}
  function save(next){if(corrupt)return false;const meta=C.queueChange(device,savedState,next,identifier(),new Date().toISOString());if(!write(next,meta))return false;schedule(800);return true;}
  function schedule(delay=15000){clearTimeout(timer);if(device.enabled&&device.joined)timer=setTimeout(run,delay);}
  function status(){
   if(corrupt)return 'Conexiune de recuperat';
   if(device.conflicts.length)return device.conflicts.length+' conflicte de verificat';
   if(busy)return 'Sincronizare în curs…';
   if(!device.enabled)return device.joined?'Local · sincronizare oprită':'Date locale';
   if(!device.joined)return 'HA neconectat';
   if(device.queue.length)return device.queue.length+' modificări de sincronizat';
   if(error)return 'Offline · date salvate local';
   return device.lastSync?'Sincronizat cu HA':'Pregătit pentru sincronizare';
  }
  function transport(base,path,token,body){
   return new Promise((resolve,reject)=>{
    const requestId=identifier(),watch=setTimeout(()=>{callbacks.delete(requestId);reject(Error('HA nu răspunde. Datele rămân salvate local.'));},28000);
    callbacks.set(requestId,result=>{clearTimeout(watch);resolve(result);});
    if(global.Android?.syncRequest){try{Android.syncRequest(requestId,base,path,token||'',JSON.stringify(body));}catch(e){callbacks.delete(requestId);clearTimeout(watch);reject(Error('Conexiunea nu a putut fi pornită.'));}}
    else{const controller=new AbortController();fetch(base.replace(/\/$/,'')+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:controller.signal,redirect:'error',credentials:'omit'}).then(async response=>{let parsed;try{parsed=await response.json();}catch(e){}const callback=callbacks.get(requestId);callbacks.delete(requestId);callback?.({ok:response.ok,status:response.status,body:parsed});}).catch(()=>{const callback=callbacks.get(requestId);callbacks.delete(requestId);callback?.({ok:false,status:0,error:'HA nu este accesibil. Verifică Wi-Fi sau Tailscale.'});});setTimeout(()=>controller.abort(),26000);}
   });
  }
  global.salonSyncResponse=function(requestId,json){const callback=callbacks.get(requestId);if(!callback)return;callbacks.delete(requestId);try{callback(JSON.parse(json));}catch(e){callback({ok:false,status:0,error:'Răspuns HA invalid.'});}};
  async function request(path,body,token=device.token){
   const configured=[device.serverUrl,device.remoteUrl].filter(Boolean),urls=[...new Set([...(configured.includes(lastGoodUrl)?[lastGoodUrl]:[]),...configured])];let last;
   const logoRequired=requiresLogoSync(hooks.getState(),device)||hasSalonLogo(body.bootstrap),capabilities=[...REQUIRED_CAPABILITIES,...(logoRequired?['salon-logo-v1']:[])];
   function checked(result){if(result.ok)return requireCapabilities(result.body,logoRequired);if(result.status)throw Object.assign(Error(result.body?.error||result.error||'HA a refuzat solicitarea.'),{server:true,code:result.body?.code});throw Error(result.error||'HA nu este accesibil.');}
   for(const url of urls){try{
    if(path!=='/v1/status'){const probe=checked(await transport(url,'/v1/status','',{capabilities}));if(device.joined&&probe.workspaceId!==device.workspaceId)throw Object.assign(Error('Adresa indică o altă evidență HA. Datele și modificările locale au fost păstrate.'),{server:true});}
    const response=checked(await transport(url,path,token,{...body,capabilities}));lastGoodUrl=url;return response;
   }catch(e){if(e.server)throw e;last=e;}}
   throw last||Error('Completează adresa HA.');
  }
  function mergeReply(sent,response){
   requireCapabilities(response,requiresLogoSync(hooks.getState(),device));
   hooks.validate(response.state);
   const result=C.applyResponse(device,hooks.getState(),sent,response,new Date().toISOString());hooks.validate(result.state);
   if(hasSalonLogo(hooks.getState())&&!hasSalonLogo(result.state))throw Error('HA nu a păstrat logo-ul în răspuns. Logo-ul și modificările locale au fost păstrate; actualizează Atelier Sync și reîncearcă.');
   if(!write(result.state,result.meta))throw Error('Răspunsul HA nu a putut fi salvat. Reîncercarea nu creează duplicate.');
   hooks.setState(clone(result.state));error='';refresh();
  }
  async function run(){
   clearTimeout(timer);
   if(busy||corrupt||!device.enabled||!device.joined||!device.token){schedule();return;}
   if(hooks.hasOpenForm?.()){schedule(1500);return;}
   if(deferred){try{mergeReply(deferred.sent,deferred.response);deferred=null;}catch(e){error=e.message;refresh();schedule();return;}}
   busy=true;refresh();
   try{
    const sent=device.bootstrap?[]:prepareSyncBatch(C,device),payload={deviceId:device.deviceId,workspaceId:device.workspaceId,operations:sent};
    if(device.bootstrap){payload.bootstrap=device.bootstrap.state;payload.bootstrapId=device.bootstrap.id;}
    const response=await request('/v1/sync',payload);
    if(hooks.hasOpenForm?.())deferred={sent,response};else mergeReply(sent,response);
   }catch(e){error=e.message||'Sincronizarea nu a reușit. Datele rămân locale.';}
   finally{busy=false;refresh();schedule(deferred?1500:device.queue.length&&!device.conflicts.length&&!error?1000:15000);}
  }
  function applyJoin(response){
   try{
    requireCapabilities(response);
    const incoming=hooks.validate(response.state);
    if(response.workspaceId!==device.workspaceId)throw Error('Adresa indică o altă evidență HA.');
    const meta={...device,joined:true,queue:[],conflicts:[],base:clone(incoming),lastSync:new Date().toISOString(),serverRevision:response.serverRevision,localBackup:clone(hooks.getState()),joinBackups:[...(device.joinBackups||[]),...(device.localBackup?[{archivedAt:new Date().toISOString(),state:clone(device.localBackup)}]:[])]};delete meta.bootstrap;
    if(!write(incoming,meta))throw Error('Datele HA nu au putut fi salvate. Agenda actuală a fost păstrată.');
    hooks.setState(clone(incoming));error='';refresh();schedule(1000);hooks.toast('Conectat la HA. Datele anterioare sunt păstrate într-o copie locală.');
   }catch(e){error=e.message;refresh();}
  }
  async function connect(pairingKey){
   if(busy)return;
   const resume=!pairingKey&&device.token&&device.workspaceId;
   if(!resume&&(!pairingKey||pairingKey.length<16)){error='Introdu cheia de asociere din configurația aplicației HA (minimum 16 caractere).';refresh();return;}
   busy=true;refresh();
   try{
    const registration=resume?{...await request('/v1/status',{},''),token:device.token}:await request('/v1/register',{pairingKey,deviceId:device.deviceId,role:device.role,name:device.name||'Dispozitiv'},'');
    if(resume&&registration.workspaceId!==device.workspaceId)throw Error('Adresa indică o altă evidență HA. Reasociază dispozitivul cu cheia serverului dorit.');
    if(typeof registration.token!=='string'||!registration.token||typeof registration.workspaceId!=='string')throw Error('Răspuns de asociere invalid.');
    if(device.joined&&device.workspaceId!==registration.workspaceId)throw Error('Acest HA conține altă evidență. Conexiunea existentă și datele au fost păstrate.');
    const meta={...device,token:registration.token,workspaceId:registration.workspaceId};
    if(!write(hooks.getState(),meta))throw Error('Asocierea nu a putut fi salvată.');
    if(device.joined){error='';schedule(1);return;}
    if(!registration.initialized){
     if(device.role!=='master')throw Error('Conectează mai întâi dispozitivul principal pentru a trimite agenda inițială în HA.');
     const initial=clone(hooks.getState()),bootstrap={id:identifier(),state:initial},start={...device,joined:true,base:clone(initial),bootstrap};
     if(!write(initial,start))throw Error('Inițializarea nu a putut fi pregătită.');error='';schedule(1);
    }else{
     const response=await request('/v1/sync',{deviceId:device.deviceId,workspaceId:device.workspaceId,operations:[]});hooks.validate(response.state);
     hooks.confirm('Preia agenda din HA','HA conține '+response.state.clients.length+' clienți și '+response.state.appointments.length+' programări. Agenda de pe acest dispozitiv va fi înlocuită. O copie a datelor actuale va rămâne salvată aici și poate fi exportată din Setări.',()=>applyJoin(response),'Preia agenda HA');
    }
   }catch(e){error=e.message;}
   finally{busy=false;refresh();}
  }
  function selectRole(role){const meta={...device,role,name:device.name||(role==='master'?'Dispozitiv principal':'Dispozitiv secundar')};if(!write(hooks.getState(),meta)){hooks.toast('Rolul nu a putut fi salvat. Reîncearcă.');return false;}refresh();return true;}
  function onboarding(){
   if(device.role||corrupt||document.getElementById('device-setup'))return;
   const {el,button}=hooks;
   const overlay=el('div',{id:'device-setup',class:'device-setup',role:'dialog','aria-modal':'true','aria-label':'Alege rolul dispozitivului'},el('div',{class:'card device-setup-card'},el('p',{class:'eyebrow'},'Bun venit'),el('h1',{},'Cum folosești acest dispozitiv?'),el('p',{class:'subtext'},'Poți lucra doar pe dispozitivul principal, fără server sau telefon. Sincronizarea prin HA se activează separat, din Setări.'),button([el('strong',{},'Dispozitiv principal · Master'),el('span',{},'Tableta sau dispozitivul pe care păstrezi agenda principală.')],()=>{if(selectRole('master'))overlay.remove();},'btn role-choice'),button([el('strong',{},'Dispozitiv secundar'),el('span',{},'Telefon sau alt dispozitiv. Poți crea programări și de aici.')],()=>{if(selectRole('secondary')){overlay.remove();hooks.showSettings?.();}},'btn secondary role-choice'),el('p',{class:'setting-desc'},'Agenda rămâne disponibilă offline. Rolul se poate schimba ulterior.')));
   document.body.append(overlay);
  }
  function renderSettings(){
   const {el,button,field}=hooks;
   const card=el('section',{class:'card sync-settings'},el('h2',{},'Dispozitiv și sincronizare'),el('p',{class:'sync-state',role:'status'},status()));
   if(corrupt){card.append(el('p',{class:'alert visible'},error),button('Recuperează conexiunea locală',()=>hooks.confirm('Resetează conexiunea locală','Agenda rămâne salvată. Identitatea și coada de sincronizare deteriorate vor fi înlocuite. Exportă mai întâi un backup al agendei.',()=>{const fresh=C.createDevice(identifier());fresh.role='master';if(write(hooks.getState(),fresh)){corrupt=false;error='';refresh();}},'Resetează conexiunea'),'btn secondary'));return card;}
   const role=field('Rolul acestui dispozitiv','select',device.role||'master');[['master','Dispozitiv principal · Master'],['secondary','Dispozitiv secundar']].forEach(([value,label])=>role.input.append(el('option',{value,selected:role.input.value===value||device.role===value},label)));role.input.value=device.role||'master';
   const name=field('Numele dispozitivului','text',device.name||'',{maxlength:80,placeholder:'Tableta salonului / telefon'}),enabled=el('input',{type:'checkbox',checked:device.enabled}),local=field('Adresa HA din rețeaua locală','url',device.serverUrl,{placeholder:'http://192.168.0.20:8787',autocomplete:'off'}),remote=field('Adresa HA prin Tailscale · opțional','url',device.remoteUrl||'',{placeholder:'http://100.x.y.z:8787',autocomplete:'off'}),key=field('Cheia de asociere HA','password','',{autocomplete:'new-password',placeholder:device.token?'Doar pentru o nouă asociere':'Aceeași cheie ca în aplicația HA',minlength:16}),feedback=el('div',{class:'alert'+(error?' visible':''),role:'alert'},error);
   function configure(){
    const primary=local.input.value.trim().replace(/\/$/,''),alternate=remote.input.value.trim().replace(/\/$/,'');
    if(!C.validServerUrl(primary)||alternate&&!C.validServerUrl(alternate)){feedback.classList.add('visible');feedback.textContent='Introdu o adresă completă, de exemplu http://192.168.0.20:8787. HTTP este permis doar în rețeaua locală sau Tailscale; HTTPS este acceptat cu certificat valid.';return;}
    const meta={...device,role:role.input.value,name:name.input.value.trim()||(role.input.value==='master'?'Dispozitiv principal':'Dispozitiv secundar'),enabled:enabled.checked,serverUrl:primary,remoteUrl:alternate};
    if(!write(hooks.getState(),meta)){feedback.classList.add('visible');feedback.textContent='Setările nu au putut fi salvate.';return;}
    error='';const secret=key.input.value;key.input.value='';hooks.clearSettingsDraft?.();refresh();
    if(meta.enabled&&(!meta.joined||secret))connect(secret);else{schedule(1);hooks.toast(meta.enabled?'Conexiune salvată.':'Mod local activ. Datele rămân pe dispozitiv.');}
   }
   card.append(el('p',{class:'subtext'},'Un singur dispozitiv funcționează complet fără HA. Activează sincronizarea doar dacă vrei aceeași agendă pe mai multe dispozitive.'),el('div',{class:'field-row'},role.wrap,name.wrap),el('label',{class:'checkbox-line'},enabled,'Activează sincronizarea prin HA'),local.wrap,remote.wrap,el('p',{class:'setting-desc'},'La distanță, pornește Tailscale. Folosește adresa Tailscale a HA sau o rută către rețeaua locală. Adresa de aici este a serviciului Agenda Salon, pe portul 8787.'),key.wrap,el('p',{class:'setting-desc'},'Cheia se introduce la asociere și nu este păstrată în aplicație. Prima conectare a dispozitivului principal trimite agenda locală în HA.'),feedback,el('div',{class:'backup-actions'},button(busy?'Se conectează…':'Salvează conexiunea',configure,'btn',{disabled:busy,'data-sync-action':'configure'}),device.joined?button('Sincronizează acum',()=>run(),'btn secondary',{disabled:busy||!device.enabled,'data-sync-action':'run'}):null));
   if(device.lastSync)card.append(el('p',{class:'setting-desc'},'Ultima sincronizare: '+new Date(device.lastSync).toLocaleString('ro-RO')));
   if(device.queue.length||device.conflicts.length)card.append(el('p',{class:'setting-desc'},'Modificările nesincronizate sunt păstrate local. Conexiunea oprită nu șterge datele sau coada de trimitere.'));
   if(device.localBackup)card.append(button('Exportă agenda anterioară asocierii',()=>hooks.exportRaw(JSON.stringify(device.localBackup,null,2)),'inline-link'));
   (device.joinBackups||[]).forEach((backup,index)=>card.append(button('Exportă copia unei asocieri mai vechi · '+(index+1),()=>hooks.exportRaw(JSON.stringify(backup.state,null,2)),'inline-link')));
   if(device.resolutionArchive?.length)card.append(button('Exportă istoricul rezolvării conflictelor',()=>hooks.exportRaw(JSON.stringify({version:1,resolutions:device.resolutionArchive},null,2)),'inline-link'));
   if(device.joined)card.append(button('Folosește doar acest dispozitiv',()=>hooks.confirm('Treci la un singur dispozitiv','Agenda actuală rămâne pe acest dispozitiv. Conexiunea cu HA se elimină, iar modificările locale încă netrimise nu vor mai fi trimise. Datele deja existente în HA și pe celelalte dispozitive rămân acolo.',()=>{
    const pending=[...device.queue,...device.conflicts],fresh={...C.createDevice(identifier()),role:device.role,name:device.name,serverUrl:device.serverUrl,remoteUrl:device.remoteUrl,joinBackups:device.joinBackups||[],...(device.localBackup?{localBackup:device.localBackup}:{}),resolutionArchive:[...(device.resolutionArchive||[]),...(pending.length?[{at:new Date().toISOString(),choice:'disconnect',operations:pending}]:[])]};
    if(write(hooks.getState(),fresh)){deferred=null;error='';hooks.clearSettingsDraft?.();clearTimeout(timer);refresh();hooks.toast('Mod cu un singur dispozitiv. Agenda a fost păstrată.');}else hooks.toast('Conexiunea nu a putut fi schimbată.');
   },'Folosește doar acest dispozitiv'),'inline-link',{disabled:busy,'data-sync-action':'disconnect'}));
   if(device.conflicts.length){const list=el('div',{class:'sync-conflicts'},el('h3',{},'Modificări de verificat'),el('p',{class:'subtext'},'Varianta locală este păstrată în agendă. Pentru o suprapunere, mută programarea la o oră liberă înainte să retrimiți.'));
    const localRecords=C.flatten(hooks.getState()),serverRecords=device.base?C.flatten(device.base):{};
    function describe(record,key){if(!record)return 'Înregistrarea lipsește sau a fost eliminată.';const type=key.split('/')[0];if(type==='clients'&&record.deleted)return [record.name,'Client șters · identitate păstrată pentru programări'].join('\n');if(type==='appointments')return [record.date+' · '+record.start,record.duration+' minute · '+record.price+' lei',({pending:'În așteptare',confirmed:'Confirmată',completed:'Finalizată',cancelled:'Anulată','no-show':'Neprezentare'})[record.status],record.services.map(s=>s.name).join(' + '),record.notes].filter(Boolean).join('\n');if(type==='expenses')return [record.date+' · '+record.amount+' lei',record.supplierName,record.description].filter(Boolean).join('\n');if(type==='settings')return [record.workspace.salonName,record.theme==='dark'?'Aspect întunecat':'Aspect luminos','Accent: '+record.workspace.accent,record.agendaRanges?.length?'Ultimul interval: '+record.agendaRanges.at(-1).start+' – '+record.agendaRanges.at(-1).lastStart:'Interval implicit: 10:00 – 18:00'].join('\n');return [record.name,record.phone,record.category,record.price!==undefined?record.price+' lei':'',record.notes].filter(Boolean).join('\n')||'Date generale modificate.';}
    device.conflicts.forEach((conflict,index)=>{
     const operation=conflict.operation||conflict.op||conflict,keys=C.operationKeys(device,operation),labels=keys.slice(0,5).map(k=>{const [type,id]=k.split('/'),record=hooks.getState()[type]?.find?.(x=>x.id===id);return record?.name||(type==='appointments'&&record?record.date+' · '+record.start:({settings:'Setări',meta:'Date generale',appointments:'Programare',expenses:'Cheltuială',suppliers:'Furnizor',clients:'Client',services:'Serviciu'}[type]||type));});
     const deletedIdentity=keys.some(key=>key.startsWith('clients/')&&serverRecords[key]?.deleted===true&&!localRecords[key]?.deleted),deletedWarning='Clientul a fost șters pe alt dispozitiv. Preia varianta HA; pentru programări noi adaugă din nou clientul. Un client șters nu poate fi reactivat.';
     function resolve(choice){if(choice==='local'&&deletedIdentity){hooks.toast(deletedWarning);return;}hooks.confirm(choice==='server'?'Preia varianta din HA':'Retrimite varianta locală',choice==='server'?'Modificările locale legate de acest conflict vor fi înlocuite cu varianta din HA.':'Varianta locală și modificările legate de ea vor fi verificate din nou de HA. O suprapunere trebuie corectată în calendar.',()=>{try{const result=C.resolve(device,hooks.getState(),index,choice,identifier(),new Date().toISOString());hooks.validate(result.state);if(!write(result.state,result.meta))throw Error('Modificarea nu a putut fi salvată.');hooks.setState(clone(result.state));error='';refresh();schedule(1);}catch(e){hooks.toast(e.message);}},choice==='server'?'Preia varianta HA':'Retrimite');}
     const comparison=el('details',{class:'sync-comparison'},el('summary',{},'Vezi variantele locale și HA'),keys.slice(0,20).map(k=>el('div',{class:'sync-comparison-row'},el('div',{},el('strong',{},'Pe acest dispozitiv'),el('p',{},describe(localRecords[k],k))),el('div',{},el('strong',{},'În HA'),el('p',{},describe(serverRecords[k],k))))));
     list.append(el('div',{class:'sync-conflict'},el('strong',{},labels.join(' · ')),el('p',{class:'subtext'},conflict.reason||'Date modificate pe alt dispozitiv.'),deletedIdentity?el('p',{class:'notice sync-deleted-client-warning'},deletedWarning):null,comparison,el('div',{class:'backup-actions'},button('Păstrează varianta HA',()=>resolve('server'),'btn secondary small'),button('Retrimite varianta locală',()=>resolve('local'),'btn secondary small',{disabled:deletedIdentity}))));
    });card.append(list);
   }
   return card;
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule(200);});global.addEventListener('online',()=>schedule(200));global.addEventListener('focus',()=>schedule(200));
  schedule(1500);
  return {save,status,renderSettings,onboarding,run,getDevice:()=>clone(device),isJoined:()=>device.joined};
 }
 global.SalonSyncUI={create,loadLocalState,requiresLogoSync,requireCapabilities,prepareSyncBatch};
})(typeof window!=='undefined'?window:globalThis);
