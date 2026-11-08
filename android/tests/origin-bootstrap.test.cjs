'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/boot.js'),'utf8');
const HOME='https://appassets.androidplatform.net/assets/index.html',OLD='file:///android_asset/index.html',KEY='atelier.app-updates.v1';
function setup({url=HOME,old=null,current=null,captured=true,bridge=true,readError=false,writeError=false,silentWrite=false}={}){
 const calls=[],loads=[],values=new Map(current===null?[]:[[KEY,current]]),status={textContent:'Preparing',remove(){calls.push('remove-status');}};
 const context={location:{href:url},document:{getElementById:id=>id==='boot-status'?status:null,createElement:tag=>({tag}),head:{append(node){if(node.tag==='script'){loads.push(node.src);node.onload();}}}},localStorage:{getItem(k){calls.push(['read',k]);if(readError)throw Error();return values.get(k)??null;},setItem(k,v){calls.push(['write',k,v]);if(writeError)throw Error();if(!silentWrite)values.set(k,v);}}};
 if(bridge)context.SalonOriginMigration={captureUpdatePreferences:raw=>calls.push(['capture',raw]),readCapturedPreferences:()=>JSON.stringify({captured,raw:old}),finishUpdatePreferences:()=>calls.push('finish')};
 context.window=context;vm.runInNewContext(script,context);
 return{context,calls,loads,values,status};
}
test('legacy origin only captures updater preference; never loads agenda or changes storage',()=>{
 for(const current of [null,'',JSON.stringify({automatic:false,lastCheck:123,deferDay:'2026-11-08'})]){
  const f=setup({url:OLD,current});assert.deepEqual(f.calls,[['read',KEY],['capture',current]]);assert.deepEqual(f.loads,[]);
 }
});
test('read failure or missing legacy bridge keeps application stopped for retry',()=>{
 for(const opts of [{readError:true},{bridge:false}]){const f=setup({url:OLD,...opts});assert.equal(f.loads.length,0);assert(!f.calls.some(x=>Array.isArray(x)&&x[0]==='capture'));assert.match(f.status.textContent,/reîncerca/);}
});
test('new origin restores exact raw preference before durable acknowledgement and application start',()=>{
 const raw=JSON.stringify({automatic:false,lastCheck:234,deferDay:'2026-11-08',extra:'</script><script>throw 1</script>'});
 const f=setup({old:raw});assert.equal(f.values.get(KEY),raw);assert.equal(f.calls.at(-1),'finish');assert.equal(f.loads.length,0);
 f.context.SalonOriginMigrationReady();f.context.SalonOriginMigrationReady();assert.equal(f.loads.length,13);assert.equal(f.loads.at(-1),'app.js');assert.equal(f.calls.at(-1),'remove-status');
});
test('retry preserves a preference already written/changed at the new origin',()=>{
 const f=setup({old:'old-preference',current:'newer-preference'});assert.equal(f.values.get(KEY),'newer-preference');assert(!f.calls.some(x=>Array.isArray(x)&&x[0]==='write'));assert(f.calls.includes('finish'));
});
test('fresh install migrates absent preference without inventing a stored value',()=>{const f=setup();assert.equal(f.values.size,0);assert.deepEqual(f.calls,['finish']);});
test('write failure and silent storage failure cannot finish migration or load agenda',()=>{
 for(const opts of [{writeError:true},{silentWrite:true},{readError:true}]){const f=setup({old:'saved',...opts});assert.equal(f.loads.length,0);assert(!f.calls.includes('finish'));assert.match(f.status.textContent,/reîncerca/);}
});
test('uncaptured and wrong-origin callbacks cannot start application',()=>{
 for(const opts of [{captured:false},{url:'https://other.invalid/'},{url:HOME+'?x=1'}]){const f=setup(opts);assert.equal(f.loads.length,0);assert(!f.calls.includes('finish'));}
});
test('completed migration loads packaged scripts once with no preference operations',()=>{const f=setup({bridge:false});assert.equal(f.loads.length,13);assert.deepEqual(f.calls,['remove-status']);});
