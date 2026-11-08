/* Updates use separate device-local preferences and never save appointment data. */
(function(global){
 'use strict';
 const PREF_KEY='atelier.app-updates.v1';
 const CHECK_TIMEOUT_MS=20000;
 function preferences(raw){try{const value=JSON.parse(raw);return {automatic:value.automatic!==false,lastCheck:Number.isSafeInteger(value.lastCheck)&&value.lastCheck>=0?value.lastCheck:0,deferDay:typeof value.deferDay==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value.deferDay)?value.deferDay:''};}catch(_){return {automatic:true,lastCheck:0,deferDay:''};}}
 function dayStartAt(now){const date=new Date(now);if(!Number.isFinite(date.getTime()))throw Error('Invalid clock');return new Date(date.getFullYear(),date.getMonth(),date.getDate(),0,0,0,0).getTime();}
 function nextDayAt(now){const date=new Date(now);if(!Number.isFinite(date.getTime()))throw Error('Invalid clock');return new Date(date.getFullYear(),date.getMonth(),date.getDate()+1,0,0,0,0).getTime();}
 function localDay(now){const date=new Date(now);return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');}
 function result(raw){
  if(typeof raw==='string'){if(raw.length>16000)throw Error('Invalid update response');raw=JSON.parse(raw);}
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||!['available','current','error','browser'].includes(raw.status))throw Error('Invalid update response');
  const value={status:raw.status,message:typeof raw.message==='string'?raw.message.slice(0,1000):''};
  if(raw.status==='available'){
   if(!Number.isSafeInteger(raw.versionCode)||raw.versionCode<1||typeof raw.versionName!=='string'||!/^\d+\.\d+\.\d+$/.test(raw.versionName)||raw.versionName.length>40)throw Error('Invalid update version');
   value.versionCode=raw.versionCode;value.versionName=raw.versionName;value.notes=typeof raw.notes==='string'?raw.notes.slice(0,6000):'';
  }
  return value;
 }
 function create(options={}){
  const win=options.window||global,doc=options.document||win.document,bridge=options.Android||win.Android,clock=options.now||Date.now,later=options.setTimeout||win.setTimeout.bind(win),cancel=options.clearTimeout||win.clearTimeout.bind(win);
  let storage;try{storage=options.storage||win.localStorage;}catch(_){}
  let stored;try{stored=storage?.getItem(PREF_KEY);}catch(_){}
  let prefs=preferences(stored),info={versionCode:38,versionName:'1.1.3'},state={status:'idle',message:''},available=null,pending=null,serial=0,timer=null,poll=null,resultPoll=null,prompt=null,promptWanted=false,promptExplicit=false,returnToCheck=false,retryAt=0,started=false,automaticReady=false,destroyed=false,eligibleDay=localDay(clock()),priorFocus=null,priorOverflow='',priorInert=false,priorAria=null,resultNotice=null;const observers=[];
  const supported=!!bridge&&typeof bridge.checkAppUpdate==='function'&&typeof bridge.openAppUpdate==='function';
  try{const value=JSON.parse(bridge?.appUpdateInfo?.()||'null');if(value&&Number.isSafeInteger(value.versionCode)&&typeof value.versionName==='string'&&/^\d+\.\d+\.\d+$/.test(value.versionName)&&value.versionName.length<=40)info=value;}catch(_){}
  function savePreferences(){try{storage?.setItem(PREF_KEY,JSON.stringify(prefs));}catch(_){} }
  function node(tag,cls,text){const element=doc.createElement(tag);if(cls)element.className=cls;if(text!==undefined)element.textContent=text;return element;}
  function button(label,action,secondary=false){const element=node('button','btn'+(secondary?' secondary':''),label);element.type='button';element.addEventListener('click',action);element.disabled=!!pending;return element;}
  function message(){
   if(!supported)return 'Verificarea actualizărilor este disponibilă în aplicația Android.';
   if(state.message)return state.message;
   return {checking:'Se verifică versiunea de pe GitHub…',available:'Este disponibilă versiunea '+available?.versionName+'.',current:'Ai cea mai nouă versiune disponibilă.',opening:'Se deschide browserul…',browser:'Descărcarea a fost deschisă în browser. Deschide APK-ul descărcat și confirmă actualizarea în Android.',error:'Actualizarea nu a putut fi verificată. Reîncearcă atunci când ai conexiune.'}[state.status]||'Verifică versiunile publicate pe GitHub.';
  }
  function fill(card){
   card.replaceChildren(node('h2','','Actualizări aplicație'),node('p','setting-label','Versiunea instalată: '+info.versionName));
   const label=node('label','checkbox-line app-update-automatic'),input=node('input');input.type='checkbox';input.checked=prefs.automatic;input.disabled=!supported;input.addEventListener('change',()=>{prefs.automatic=input.checked;savePreferences();if(!prefs.automatic){promptWanted=false;if(prompt)closePrompt(false);}else automaticCheck();});label.append(input,doc.createTextNode('Verifică automat o dată pe zi'));
   card.append(label,node('p','setting-desc','La prima deschidere a aplicației din fiecare zi verifică dacă există o versiune nouă. Dacă nu ai conexiune, reîncearcă după reconectare. Browserul se deschide pentru descărcare doar când alegi tu.'));
   const status=node('p','app-update-status',message());status.setAttribute('role','status');status.setAttribute('aria-live','polite');card.append(status);
   if(available){card.append(node('p','setting-label','Versiune nouă: '+available.versionName));if(available.notes)card.append(node('p','app-update-notes',available.notes));}
   const actions=node('div','app-update-actions'),check=button(pending?.kind==='check'?'Se verifică…':'Verifică acum',()=>checkNow(true),true);check.disabled=!supported||!!pending&&(pending.kind!=='check'||pending.manual);check.setAttribute('aria-busy',String(pending?.kind==='check'));if(pending?.kind==='check'&&!pending.manual)check.title='Afișează rezultatul verificării în curs';actions.append(check);
   if(available){const download=button(pending?.kind==='open'?'Se deschide…':'Descarcă actualizarea',openDownloadNow);download.disabled=!supported||!!pending;actions.append(download);}
   card.append(actions,node('p','setting-desc','Descărcarea APK-ului se deschide în browser, de pe GitHub. După descărcare, deschide fișierul și confirmă actualizarea în Android. Dacă Android cere permisiunea pentru browser, urmează instrucțiunile afișate. Păstrează aplicația instalată pentru a păstra datele și setările.'));
  }
  function renderSettings(){if(!doc)return null;const card=node('section','card app-updates');fill(card);return card;}
  function blocked(){return !!options.hasOpenForm?.()||!!doc?.hidden;}
  function focusables(){return prompt?Array.from(prompt.querySelectorAll('button:not(:disabled),[href],input:not(:disabled),[tabindex="0"]')):[];}
  function focusPrompt(){const choices=focusables();(choices[0]||prompt?.querySelector('[role="dialog"]'))?.focus();}
  function closePrompt(defer){
   if(defer){prefs.deferDay=localDay(clock());savePreferences();promptWanted=false;promptExplicit=false;}
   if(!prompt)return;const current=prompt;prompt=null;current.remove();doc.body.style.overflow=priorOverflow;const app=doc.getElementById('app');if(app){app.inert=priorInert;if(priorAria===null)app.removeAttribute('aria-hidden');else app.setAttribute('aria-hidden',priorAria);}const checkControl=returnToCheck?doc.querySelector('.app-updates .app-update-actions button'):null;if(checkControl)checkControl.focus();else if(priorFocus?.isConnected)priorFocus.focus();priorFocus=null;
  }
  function refreshPrompt(){
   if(!doc||destroyed)return;
   if(prompt&&blocked()){closePrompt(false);promptWanted=true;return;}
   if(prompt||!promptWanted||!available||pending||blocked())return;
   if(!promptExplicit&&prefs.deferDay===localDay(clock())){promptWanted=false;return;}
   promptWanted=false;priorFocus=doc.activeElement;priorOverflow=doc.body.style.overflow;doc.body.style.overflow='hidden';const app=doc.getElementById('app');if(app){priorInert=!!app.inert;priorAria=app.getAttribute('aria-hidden');app.inert=true;app.setAttribute('aria-hidden','true');}
   prompt=node('div','modal-backdrop app-update-prompt');const panel=node('section','modal app-update-dialog');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','app-update-title');panel.tabIndex=-1;
   const header=node('div','modal-header'),heading=node('div');heading.append(node('div','eyebrow','Agenda Salon'));const title=node('h2','','Actualizare disponibilă');title.id='app-update-title';heading.append(title);header.append(heading);
   const content=node('div','modal-content');content.append(node('p','setting-label','Este disponibilă versiunea '+available.versionName+'.'));if(available.notes)content.append(node('p','app-update-notes',available.notes));content.append(node('p','setting-desc','Butonul „Descarcă” deschide APK-ul oficial în browser. După descărcare, deschide fișierul și confirmă actualizarea în Android. Datele, setările și activarea se păstrează. Poți alege și „Mai târziu”.'));
   const actions=node('div','modal-footer'),install=button('Descarcă',()=>{closePrompt(true);options.showSettings?.();openDownloadNow();}),dismiss=button('Mai târziu',()=>closePrompt(true),true);install.disabled=false;dismiss.disabled=false;actions.append(install,dismiss);panel.append(header,content,actions);prompt.append(panel);doc.body.append(prompt);focusPrompt();
  }
  function onKey(event){if(!prompt)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closePrompt(true);return;}if(event.key==='Tab'){const choices=focusables();if(!choices.length){event.preventDefault();return;}const first=choices[0],last=choices.at(-1);if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first.focus();}}}
  function onFocus(event){if(prompt&&!prompt.contains(event.target))focusPrompt();}
  function refresh(){if(destroyed)return;if(doc)doc.querySelectorAll('.app-updates').forEach(fill);refreshPrompt();}
  function flushNotice(){if(!resultNotice||doc?.hidden)return;const text=resultNotice;resultNotice=null;try{options.notify?.(text);}catch(_){} }
  function notifyResult(){if(['current','error'].includes(state.status)){resultNotice=message();flushNotice();}}
  function finish(next){const explicit=pending?.kind==='check'&&pending.manual;cancel(timer);cancel(resultPoll);timer=resultPoll=null;pending=null;state=next;refresh();if(explicit)notifyResult();}
  function pullNativeResult(id){
   if(destroyed||pending?.id!==id||typeof bridge?.appUpdateResult!=='function')return;
   let raw;try{raw=bridge.appUpdateResult(id);}catch(_){return;}
   if(typeof raw!=='string'||!raw||raw.length>20000)return;
   let receipt;try{receipt=JSON.parse(raw);}catch(_){return;}
   if(!receipt||receipt.requestId!==id||!['queued','started','terminal'].includes(receipt.stage)||!Number.isSafeInteger(receipt.revision)||receipt.revision<0||receipt.revision<=pending.nativeRevision)return;
   pending.nativeStage=receipt.stage;pending.nativeRevision=receipt.revision;
   if(receipt.stage==='terminal')callback(id,receipt.result);
  }
  function pollNativeResult(id){
   if(destroyed||pending?.id!==id||typeof bridge?.appUpdateResult!=='function')return;
   pullNativeResult(id);if(pending?.id===id)resultPoll=later(()=>{resultPoll=null;pollNativeResult(id);},250);
  }
  function timeout(id){
   if(destroyed||pending?.id!==id)return;pullNativeResult(id);if(pending?.id!==id)return;
   retryAt=clock()+300000;let text='Pregătirea actualizării a durat prea mult. Datele tale sunt păstrate; poți reîncerca.';
   if(pending.kind==='check')text=typeof bridge?.appUpdateResult==='function'?(pending.nativeStage==='queued'?'Actualizatorul Android nu a pornit verificarea. Închide și redeschide aplicația.':'Aplicația nu a primit rezultatul actualizatorului Android. Închide și redeschide aplicația.'):'Verificarea actualizării a durat prea mult. Verifică internetul și reîncearcă.';
   finish({status:'error',message:text});
  }
  function begin(kind,manual=false){
   if(destroyed||pending||!supported)return null;
   const duration=CHECK_TIMEOUT_MS,id='app-update-'+clock().toString(36)+'-'+(++serial);pending={id,kind,manual,deadline:clock()+duration,nativeRevision:-1,nativeStage:''};resultNotice=null;if(kind==='check')available=null;state={status:kind==='check'?'checking':'opening',message:''};refresh();
   timer=later(()=>timeout(id),duration);return id;
  }
  function checkNow(manual=false){
   if(!supported||destroyed)return;
   if(pending){if(manual&&pending.kind==='check'){pending.manual=true;promptWanted=true;promptExplicit=true;returnToCheck=!!doc?.querySelector('.app-updates');if(clock()>=pending.deadline)timeout(pending.id);else refresh();}return;}
   if(win.navigator?.onLine===false){if(manual){state={status:'error',message:'Nu există conexiune. Poți folosi aplicația offline și verifica actualizarea mai târziu.'};refresh();notifyResult();}return;}
   promptWanted=true;promptExplicit=manual;returnToCheck=!!manual&&!!doc?.querySelector('.app-updates');const id=begin('check',manual);if(!id)return;
   try{bridge.checkAppUpdate(id);pollNativeResult(id);}catch(_){retryAt=clock()+300000;finish({status:'error',message:'Verificarea nu a putut fi pornită. Reîncearcă.'});}
  }
  function openDownloadNow(){if(!available||pending||destroyed)return;promptWanted=false;const id=begin('open');if(!id)return;try{bridge.openAppUpdate(id);pollNativeResult(id);}catch(_){finish({status:'error',message:'Pregătirea actualizării nu a putut fi pornită. Reîncearcă.'});}}
  function automaticCheck(){
   if(!started||!automaticReady||!prefs.automatic||!supported||pending||prompt||destroyed||blocked()||clock()<retryAt)return;
   const now=clock();if(eligibleDay!==localDay(now)||prefs.deferDay===localDay(now)||prefs.lastCheck&&prefs.lastCheck<=now&&localDay(prefs.lastCheck)===localDay(now))return;checkNow(false);
  }
  function callback(requestId,payload){
   if(destroyed||!pending||requestId!==pending.id)return;
   let next;try{next=result(payload);}catch(_){retryAt=clock()+300000;finish({status:'error',message:'Răspunsul actualizării nu este valid. Reîncearcă.'});return;}
   if(pending.kind==='check'&&!['available','current','error'].includes(next.status)||pending.kind==='open'&&!['browser','error'].includes(next.status))return;
   if(pending.kind==='check'&&next.status!=='error'){prefs.lastCheck=clock();savePreferences();retryAt=0;}else if(next.status==='error')retryAt=clock()+300000;
   if(next.status==='available'){if(next.versionCode<=info.versionCode){next={status:'current',message:''};available=null;promptWanted=false;}else available=next;}
   if(next.status==='current'){available=null;promptWanted=false;}
   finish(next);
  }
  function wake(){if(destroyed)return;if(pending)pullNativeResult(pending.id);if(pending?.kind==='check'&&clock()>=pending.deadline)timeout(pending.id);flushNotice();automaticCheck();refresh();}
  function opening(){if(!doc?.hidden)eligibleDay=localDay(clock());wake();}
  function tick(){if(destroyed)return;wake();poll=later(tick,30000);}
  function start(){
   if(started||destroyed)return;started=true;win.onAppUpdateResult=callback;win.addEventListener?.('online',opening);win.addEventListener?.('focus',opening);doc?.addEventListener('visibilitychange',opening);doc?.addEventListener('keydown',onKey,true);doc?.addEventListener('focusin',onFocus,true);
   if(doc&&win.MutationObserver)for(const id of ['app','modal-root']){const target=doc.getElementById(id);if(target){const observer=new win.MutationObserver(wake);observer.observe(target,{childList:true});observers.push(observer);}}
   later(()=>{automaticReady=true;wake();},1500);poll=later(tick,30000);
  }
  function destroy(){destroyed=true;cancel(timer);cancel(poll);cancel(resultPoll);observers.forEach(observer=>observer.disconnect());closePrompt(false);win.removeEventListener?.('online',opening);win.removeEventListener?.('focus',opening);doc?.removeEventListener('visibilitychange',opening);doc?.removeEventListener('keydown',onKey,true);doc?.removeEventListener('focusin',onFocus,true);if(win.onAppUpdateResult===callback)delete win.onAppUpdateResult;}
  return {renderSettings,start,destroy,check:()=>checkNow(true),handleBack:()=>{if(!prompt)return false;closePrompt(true);return true;},getStatus:()=>({...state,available:available?{...available}:null,busy:!!pending,automatic:prefs.automatic,promptOpen:!!prompt})};
 }
 const api={create,preferences,result,dayStartAt,nextDayAt,localDay};global.SalonUpdates=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
