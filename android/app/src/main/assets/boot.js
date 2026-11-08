/* No agenda code runs until the local origin's preferences are safely transferred. */
(function(global){
 'use strict';
 const scripts=['gestures.js','finance.js','sync.js','sync-ui.js','contacts.js','timeline.js','holidays.js','catalog.js','feedback.js','updates.js','logo.js','legacy-logo.js','app.js'];
 const preference='atelier.app-updates.v1',legacy='file:///android_asset/index.html';
 const home='https://appassets.androidplatform.net/assets/index.html',bridge=global.SalonOriginMigration;
 let started=false;
 function fail(){const status=document.getElementById('boot-status');if(status)status.textContent='Pregătirea aplicației nu s-a încheiat. Închide și redeschide aplicația pentru a reîncerca. Datele tale sunt păstrate.';}
 function start(){
  if(started)return;started=true;
  const style=document.createElement('link');style.rel='stylesheet';style.href='styles.css';document.head.append(style);
  function next(index){
   if(index===scripts.length){document.getElementById('boot-status')?.remove();return;}
   const script=document.createElement('script');script.src=scripts[index];script.onload=()=>next(index+1);script.onerror=fail;document.head.append(script);
  }
  next(0);
 }
 global.SalonOriginMigrationFailed=fail;
 global.SalonOriginMigrationReady=start;
 if(global.location.href===legacy){
  try{
   if(!bridge||typeof bridge.captureUpdatePreferences!=='function')throw Error('Migration unavailable');
   bridge.captureUpdatePreferences(global.localStorage.getItem(preference));
  }catch(_){fail();}
  return;
 }
 if(!bridge){start();return;}
 try{
  if(global.location.href!==home)throw Error('Unexpected origin');
  const captured=JSON.parse(bridge.readCapturedPreferences());
  if(captured.captured!==true||!(captured.raw===null||typeof captured.raw==='string'))throw Error('Invalid capture');
  if(captured.raw!==null&&global.localStorage.getItem(preference)===null){
   global.localStorage.setItem(preference,captured.raw);
   if(global.localStorage.getItem(preference)!==captured.raw)throw Error('Preference write failed');
  }
  bridge.finishUpdatePreferences();
 }catch(_){fail();}
})(window);
