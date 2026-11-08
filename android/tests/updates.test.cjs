const test=require('node:test'),assert=require('node:assert/strict');
process.env.TZ='Europe/Bucharest';
const {create,preferences,result,dayStartAt,nextDayAt,localDay}=require('../app/src/main/assets/updates.js');
function setup({stored,blocked=false,online=true,storageError=false,notify,initialNow=new Date(2026,10,5,7,30).getTime()}={}){
 let now=initialNow,form=blocked,serial=0;const timers=new Map(),events=new Map(),calls=[],writes=[],notifications=[];
 const win={navigator:{onLine:online},addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};
 const storage={getItem(){if(storageError)throw Error('SecurityError');return stored;},setItem(key,value){if(storageError)throw Error('QuotaExceeded');writes.push({key,value});}};
 const bridge={appUpdateInfo:()=>JSON.stringify({versionCode:30,versionName:'1.0.19'}),checkAppUpdate:id=>calls.push({kind:'check',id}),openAppUpdate:id=>calls.push({kind:'open',id})};
 const manager=create({window:win,Android:bridge,storage,now:()=>now,hasOpenForm:()=>form,notify:notify||((text)=>notifications.push(text)),setTimeout:(fn,delay)=>{const id=++serial;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id)});manager.start();
 function reply(payload,id=calls.at(-1)?.id){win.onAppUpdateResult(id,payload);}
 function run(delay){const entry=[...timers].find(([,value])=>value.delay===delay);assert.ok(entry,'scheduled '+delay);timers.delete(entry[0]);entry[1].fn();}
 return {manager,win,calls,writes,notifications,timers,reply,run,advance:value=>now+=value,setNow:value=>now=value,setForm:value=>form=value,bridge,events};
}
const available={status:'available',versionCode:31,versionName:'1.0.20',notes:'Calendar îmbunătățit'};
test('update preference is separate, automatic by default, and tolerant of damaged storage',()=>{
 for(const raw of [undefined,'{','null','42'])assert.deepEqual(preferences(raw),{automatic:true,lastCheck:0,deferDay:''});
 assert.deepEqual(preferences('{"automatic":false,"lastCheck":42}'),{automatic:false,lastCheck:42,deferDay:''});
 assert.equal(preferences('{"lastCheck":-1}').lastCheck,0);
 const s=setup({storageError:true});assert.doesNotThrow(()=>s.run(1500));assert.equal(s.calls.length,1);
});
test('automatic check is once per day and never starts installation',()=>{
 const s=setup();s.run(1500);assert.equal(s.calls.length,1);assert.equal(s.calls[0].kind,'check');assert.equal(s.manager.getStatus().busy,true);
 s.reply(available);s.run(30000);assert.equal(s.calls.length,1);assert.equal(s.manager.getStatus().available.versionName,'1.0.20');
 s.advance(86400000);s.run(30000);assert.equal(s.calls.length,1);s.events.get('focus')();assert.equal(s.calls.length,2);assert.ok(s.calls.every(call=>call.kind==='check'));
 assert.ok(s.writes.every(write=>write.key==='atelier.app-updates.v1'));
});
test('disabled automatic preference leaves manual check available',()=>{
 const s=setup({stored:'{"automatic":false,"lastCheck":0}'});s.run(1500);assert.equal(s.calls.length,0);s.manager.check();assert.equal(s.calls.length,1);assert.equal(s.manager.getStatus().automatic,false);
});
test('automatic check waits for online connection and a closed form',()=>{
 const s=setup({blocked:true,online:false});s.run(1500);assert.equal(s.calls.length,0);s.setForm(false);s.events.get('online')();assert.equal(s.calls.length,0);s.win.navigator.onLine=true;s.events.get('online')();assert.equal(s.calls.length,1);
});
test('manual offline check is actionable and leaves data storage untouched',()=>{
 const s=setup({online:false});s.manager.check();assert.equal(s.calls.length,0);assert.equal(s.manager.getStatus().status,'error');assert.match(s.manager.getStatus().message,/offline/);assert.equal(s.writes.length,0);
});
test('duplicate presses and stale responses cannot replace the current result',()=>{
 const s=setup();s.manager.check();const first=s.calls[0].id;s.manager.check();assert.equal(s.calls.length,1);s.reply(available,'stale');assert.equal(s.manager.getStatus().busy,true);
 s.reply(available,first);s.reply({status:'current'},first);assert.equal(s.manager.getStatus().status,'available');s.manager.check();s.reply({status:'current'},first);assert.equal(s.manager.getStatus().busy,true);s.reply({status:'current'});assert.equal(s.manager.getStatus().available,null);
});
test('a release that is not newer is treated as current',()=>{
 const s=setup();s.manager.check();s.reply({...available,versionCode:30,versionName:'1.0.19'});assert.equal(s.manager.getStatus().status,'current');assert.equal(s.manager.getStatus().available,null);
});
test('check network failure and timeout allow retry without download',()=>{
 const s=setup();s.manager.check();s.reply({status:'error',message:'Fără conexiune'});assert.equal(s.manager.getStatus().busy,false);s.manager.check();s.run(20000);assert.equal(s.manager.getStatus().status,'error');assert.equal(s.manager.getStatus().busy,false);s.manager.check();assert.equal(s.calls.length,3);assert.equal(s.calls.filter(call=>call.kind==='open').length,0);
});
test('malformed response is rejected without accepting update data',()=>{
 const s=setup();s.manager.check();s.reply({...available,versionName:'<script>alert(1)</script>'});assert.equal(s.manager.getStatus().status,'error');assert.equal(s.manager.getStatus().available,null);
 for(const raw of [null,[],{},'{',' '.repeat(16001),{status:'available',versionCode:2,versionName:'abc'}])assert.throws(()=>result(raw));
});
test('unknown callback types cannot accidentally finish a check',()=>{
 const s=setup();s.manager.check();s.reply({status:'browser'});assert.equal(s.manager.getStatus().busy,true);s.reply({status:'current'});assert.equal(s.manager.getStatus().status,'current');
});
test('destroyed controller cannot start another check from queued wake or old callbacks',()=>{
 const s=setup();const callback=s.win.onAppUpdateResult;s.manager.check();s.manager.destroy();callback(s.calls[0].id,available);s.run(1500);assert.equal(s.calls.length,1);assert.equal(s.manager.getStatus().available,null);assert.equal(s.win.onAppUpdateResult,undefined);
});

test('first opening before 08 is eligible and a same-day successful check prevents repeats',()=>{
 const s=setup();s.run(1500);assert.equal(s.calls.length,1);s.reply({status:'current'});s.setNow(new Date(2026,10,5,23,59).getTime());s.events.get('focus')();assert.equal(s.calls.length,1);
 s.setNow(new Date(2026,10,6,0,1).getTime());s.events.get('focus')();assert.equal(s.calls.length,2);
});
test('local calendar rollover works across both 23-hour and 25-hour DST days',()=>{
 for(const [month,day,hours] of [[2,28,23],[9,24,25]]){
  const now=new Date(2026,month,day,8).getTime(),next=new Date(2026,month,day+1,8).getTime();assert.equal((next-now)/3600000,hours);
  const s=setup({initialNow:now});s.run(1500);s.reply({status:'current'});s.setNow(next);s.events.get('focus')();assert.equal(s.calls.length,2);
 }
 const spring=new Date(2026,2,29,0).getTime(),fall=new Date(2026,9,25,0).getTime();assert.equal((nextDayAt(spring)-dayStartAt(spring))/3600000,23);assert.equal((nextDayAt(fall)-dayStartAt(fall))/3600000,25);
});
test('later persists for the rest of the local day while manual checks remain available',()=>{
 const now=new Date(2026,10,5,7,30).getTime(),s=setup({stored:JSON.stringify({automatic:true,lastCheck:0,deferDay:localDay(now)}),initialNow:now});s.run(1500);assert.equal(s.calls.length,0);s.manager.check();assert.equal(s.calls.length,1);s.reply(available);assert.equal(s.manager.getStatus().available.versionCode,31);
 s.setNow(new Date(2026,10,6,7,30).getTime());s.events.get('focus')();assert.equal(s.calls.length,2);
});
test('failed metadata does not consume the day and retries after a bounded backoff',()=>{
 const s=setup();s.run(1500);s.reply({status:'error'});assert.equal(s.writes.length,0);s.events.get('focus')();assert.equal(s.calls.length,1);s.advance(300001);s.events.get('focus')();assert.equal(s.calls.length,2);s.reply({status:'current'});assert.equal(s.writes.length,1);
});

test('a failed fresh check cannot offer stale metadata from an earlier available release',()=>{
 const s=setup();s.manager.check();s.reply(available);assert.ok(s.manager.getStatus().available);s.manager.check();assert.equal(s.manager.getStatus().available,null);s.reply({status:'error'});assert.equal(s.manager.getStatus().available,null);assert.equal(s.manager.getStatus().status,'error');
});

test('browser handoff responses are bounded; former native installer statuses are rejected',()=>{
 for(const status of ['browser']){
  assert.deepEqual(result({status,message:'Actualizare Android'}),{status,message:'Actualizare Android'});
  assert.equal(result(JSON.stringify({status,message:'x'.repeat(1100)})).message.length,1000);
 }
 for(const status of ['downloading','permission','installer'])assert.throws(()=>result({status}));
});
test('browser handoff cannot replace metadata or open a browser during an automatic check',()=>{
 const s=setup();s.run(1500);const id=s.calls[0].id;
 for(const status of ['browser']){s.reply({status},id);assert.equal(s.manager.getStatus().busy,true);assert.equal(s.writes.length,0);assert.equal(s.calls.filter(call=>call.kind==='open').length,0);}
 s.reply(available);assert.equal(s.manager.getStatus().status,'available');assert.equal(s.calls.filter(call=>call.kind==='open').length,0);
});

test('manual current result is announced once without a popup or stale callback notification',()=>{
 const s=setup();s.manager.check();const first=s.calls[0].id;s.reply({status:'current'});
 assert.deepEqual(s.notifications,['Ai cea mai nouă versiune disponibilă.']);assert.equal(s.manager.getStatus().busy,false);assert.equal(s.manager.getStatus().promptOpen,false);
 s.reply({status:'current'},first);s.reply({status:'error',message:'Stale'},'unknown');assert.equal(s.notifications.length,1);
 s.manager.check();s.reply({status:'error',message:'Stale'},first);assert.equal(s.manager.getStatus().busy,true);assert.equal(s.notifications.length,1);
 s.reply({status:'current',message:'Versiune verificată'});assert.deepEqual(s.notifications,['Ai cea mai nouă versiune disponibilă.','Versiune verificată']);
});

test('manual server error and default error are announced with an unlocked check',()=>{
 const s=setup();s.manager.check();s.reply({status:'error',message:'GitHub nu răspunde. Reîncearcă.'});
 assert.deepEqual(s.notifications,['GitHub nu răspunde. Reîncearcă.']);assert.equal(s.manager.getStatus().busy,false);
 s.manager.check();s.reply({status:'error'});assert.match(s.notifications[1],/nu a putut fi verificată/);assert.equal(s.manager.getStatus().busy,false);
 assert.equal(s.calls.some(call=>call.kind==='open'),false);
});

test('manual offline check announces the reason without starting a bridge or writing data',()=>{
 const s=setup({online:false});s.run(1500);assert.deepEqual(s.notifications,[]);
 s.manager.check();assert.equal(s.notifications.length,1);assert.match(s.notifications[0],/Nu există conexiune/);assert.equal(s.calls.length,0);assert.equal(s.writes.length,0);assert.equal(s.manager.getStatus().busy,false);
});

test('manual timeout announces recovery exactly once and ignores its late callback',()=>{
 const s=setup();s.manager.check();const id=s.calls[0].id;s.run(20000);
 assert.equal(s.notifications.length,1);assert.match(s.notifications[0],/a durat prea mult/);assert.equal(s.manager.getStatus().busy,false);
 s.reply({status:'current'},id);assert.equal(s.notifications.length,1);assert.equal(s.manager.getStatus().status,'error');
});

test('manual malformed response and synchronous bridge failure are announced',()=>{
 const s=setup();s.manager.check();s.reply('{');assert.equal(s.notifications.length,1);assert.match(s.notifications[0],/nu este valid/);assert.equal(s.manager.getStatus().busy,false);
 s.bridge.checkAppUpdate=()=>{throw Error('bridge unavailable');};s.manager.check();assert.equal(s.notifications.length,2);assert.match(s.notifications[1],/nu a putut fi pornită/);assert.equal(s.manager.getStatus().busy,false);
});

test('automatic current, errors, malformed replies and timeout remain silent',()=>{
 for(const response of [{status:'current'},{status:'error',message:'Fără conexiune'},'{','timeout']){
  const s=setup();s.run(1500);if(response==='timeout')s.run(20000);else s.reply(response);
  assert.deepEqual(s.notifications,[]);assert.equal(s.manager.getStatus().busy,false);
  s.manager.check();s.reply({status:'current'});assert.equal(s.notifications.length,1);
 }
});

test('available release keeps popup flow silent, while an older release announces current',()=>{
 const s=setup();s.manager.check();s.reply(available);assert.deepEqual(s.notifications,[]);assert.equal(s.manager.getStatus().status,'available');
 s.manager.check();s.reply({...available,versionCode:30,versionName:'1.0.19'});assert.deepEqual(s.notifications,['Ai cea mai nouă versiune disponibilă.']);assert.equal(s.manager.getStatus().status,'current');
});

test('a notification failure cannot leave a completed check busy or accept destroyed callbacks',()=>{
 const s=setup({notify:()=>{throw Error('view unavailable');}});s.manager.check();assert.doesNotThrow(()=>s.reply({status:'current'}));assert.equal(s.manager.getStatus().busy,false);
 const normal=setup();normal.manager.check();const callback=normal.win.onAppUpdateResult,id=normal.calls[0].id;normal.manager.destroy();callback(id,{status:'current'});assert.deepEqual(normal.notifications,[]);
});


test('manual check adopts an automatic request without duplicate network work or extending its deadline',()=>{
 for(const response of [{status:'current',message:'Versiunea a fost verificată.'},{status:'error',message:'Server indisponibil'},'{']){
  const s=setup();s.run(1500);const id=s.calls[0].id;
  s.advance(12000);s.manager.check();s.manager.check();assert.equal(s.calls.length,1);
  s.reply(response,id);assert.equal(s.manager.getStatus().busy,false);assert.equal(s.notifications.length,1);
  s.reply(response,id);assert.equal(s.notifications.length,1);
 }
 const s=setup();s.run(1500);const timeout=[...s.timers.values()].find(v=>v.delay===20000);
 s.advance(19000);s.manager.check();assert.equal([...s.timers.values()].find(v=>v.delay===20000),timeout);
 s.advance(1001);s.events.get('focus')();assert.equal(s.manager.getStatus().status,'error');assert.equal(s.notifications.length,1);
 assert.equal(s.calls.length,1);s.reply({status:'current'});assert.equal(s.notifications.length,1);
});

test('a cancelled timeout cannot finish a newer check',()=>{
 const s=setup();s.manager.check();const expired=[...s.timers.values()].find(v=>v.delay===20000).fn;
 s.reply({status:'current'});s.manager.check();const id=s.calls.at(-1).id;
 expired();assert.equal(s.manager.getStatus().busy,true);assert.equal(s.manager.getStatus().status,'checking');
 s.reply({status:'current'},id);assert.equal(s.notifications.length,2);
});

test('an overdue suspended manual check finishes on return without another twenty second wait',()=>{
 const s=setup();s.manager.check();const id=s.calls[0].id;
 s.advance(60000);s.events.get('focus')();assert.equal(s.manager.getStatus().busy,false);
 assert.equal(s.manager.getStatus().status,'error');assert.equal(s.notifications.length,1);
 s.reply(available,id);assert.equal(s.manager.getStatus().available,null);
 s.manager.check();assert.equal(s.calls.length,2);s.reply({status:'current'});assert.equal(s.notifications.length,2);
});


test('cached native terminals finish checks even when the push callback is lost',()=>{
 for(const response of [{status:'current'},{status:'error',message:'Eroare nativă păstrată'},available]){
  const s=setup();let cached='';s.bridge.appUpdateResult=()=>cached;s.manager.check();const id=s.calls[0].id;
  cached=JSON.stringify({requestId:id,stage:'terminal',revision:3,result:response});s.run(250);
  assert.equal(s.manager.getStatus().busy,false);assert.equal(s.manager.getStatus().status,response.status);
  assert.equal(s.notifications.length,response.status==='available'?0:1);assert.equal(s.calls.length,1);
  s.reply(response,id);assert.equal(s.notifications.length,response.status==='available'?0:1);
 }
});

test('native cache is read before deadline and foreground expiry can report a completed check',()=>{
 for(const resumed of [false,true]){
  const s=setup();let cached='';s.bridge.appUpdateResult=()=>cached;s.manager.check();const id=s.calls[0].id;
  cached=JSON.stringify({requestId:id,stage:'terminal',revision:2,result:{status:'current'}});
  if(resumed){s.advance(60000);s.events.get('focus')();}else s.run(20000);
  assert.equal(s.manager.getStatus().status,'current');assert.equal(s.manager.getStatus().busy,false);
  assert.equal(s.notifications.length,1);assert.equal(s.calls.length,1);
 }
});

test('a stale native mailbox cannot finish a newer request or produce duplicate notices',()=>{
 const s=setup();let cached='';s.bridge.appUpdateResult=()=>cached;s.manager.check();const old=s.calls[0].id;
 cached=JSON.stringify({requestId:old,stage:'terminal',revision:2,result:{status:'current'}});s.run(250);
 s.manager.check();const current=s.calls.at(-1).id;s.run(250);
 assert.equal(s.manager.getStatus().busy,true);assert.equal(s.notifications.length,1);
 cached=JSON.stringify({requestId:current,stage:'terminal',revision:2,result:{status:'error',message:'Răspuns nou'}});s.run(250);
 assert.equal(s.manager.getStatus().busy,false);assert.equal(s.notifications.length,2);
});

test('queued Android entry failure is distinguished from an internet timeout',()=>{
 const s=setup();s.bridge.appUpdateResult=id=>JSON.stringify({requestId:id,stage:'queued',revision:1});
 s.manager.check();s.run(20000);assert.equal(s.manager.getStatus().status,'error');assert.equal(s.manager.getStatus().busy,false);
 assert.match(s.notifications[0],/Android nu a pornit/);assert.doesNotMatch(s.notifications[0],/internet/);
 assert.equal(s.writes.length,0);
});

test('native getter failure is bounded and does not misreport internet connectivity',()=>{
 const s=setup();s.bridge.appUpdateResult=()=>{throw Error('native getter unavailable');};
 s.manager.check();s.run(20000);assert.equal(s.manager.getStatus().busy,false);
 assert.match(s.notifications[0],/nu a primit rezultatul/);assert.doesNotMatch(s.notifications[0],/internet/);
 assert.equal(s.writes.length,0);
});

test('automatic cached results remain silent and destroyed polling cannot access the bridge',()=>{
 const s=setup();let cached='',reads=0;s.bridge.appUpdateResult=()=>{reads++;return cached;};
 s.run(1500);const id=s.calls[0].id;cached=JSON.stringify({requestId:id,stage:'terminal',revision:2,result:{status:'current'}});s.run(250);
 assert.deepEqual(s.notifications,[]);assert.equal(s.manager.getStatus().busy,false);
 s.manager.check();const queued=[...s.timers.values()].find(v=>v.delay===250).fn;
 s.manager.destroy();const before=reads;queued();assert.equal(reads,before);
});

test('invalid or decreasing mailbox revisions cannot replace a native result',()=>{
 const s=setup();let cached='';s.bridge.appUpdateResult=()=>cached;s.manager.check();const id=s.calls[0].id;
 cached=JSON.stringify({requestId:id,stage:'started',revision:3});s.run(250);
 for(const receipt of [{requestId:id,stage:'terminal',revision:2,result:{status:'current'}},{requestId:'wrong',stage:'terminal',revision:4,result:{status:'current'}},{requestId:id,stage:'terminal',revision:4.5,result:{status:'current'}}]){
  cached=JSON.stringify(receipt);s.run(250);assert.equal(s.manager.getStatus().busy,true);
 }
 cached=JSON.stringify({requestId:id,stage:'terminal',revision:4,result:{status:'current'}});s.run(250);
 assert.equal(s.manager.getStatus().status,'current');assert.equal(s.notifications.length,1);
});
