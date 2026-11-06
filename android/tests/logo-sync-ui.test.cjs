const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Sync=require('../app/src/main/assets/sync.js');require('../app/src/main/assets/app.js');const Core=global.SalonCore;
const source=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/sync-ui.js'),'utf8');
const copy=x=>JSON.parse(JSON.stringify(x)),OLD=['suppliers-v1','client-deletion-v1'],NEW=[...OLD,'salon-logo-v1'];
function setup({logo=false,capabilities=OLD,omitLogo=false,serverLogo=false}={}){
 const initial=Core.validateState(Core.createDemo('2026-11-06'));initial.demo=false;
 const state=copy(initial);if(logo)state.settings.workspace.logoData=null;else state.clients[0].name='Nume schimbat offline';
 const device={...Sync.createDevice('tablet-logo-test'),enabled:true,joined:true,role:'master',token:'a'.repeat(64),workspaceId:'workspace-logo',base:copy(initial),serverRevision:1};
 const queued=Sync.queueChange(device,initial,state,'offline-edit','2026-11-06T06:00:00.000Z');
 const writes=[],requests=[];let current=state;
 const sandbox={SalonSyncCore:Sync,document:{addEventListener(){},querySelectorAll(){return[];}},addEventListener(){},setTimeout(){return 1;},clearTimeout(){},crypto:{randomUUID:()=>String(requests.length+1)},localStorage:{},console,
 Android:{loadDevice:()=>JSON.stringify(queued),saveLocal:(s,d)=>{writes.push({state:JSON.parse(s),device:JSON.parse(d)});return true;},syncRequest(id,base,endpoint,token,json){
  const payload=JSON.parse(json);requests.push({endpoint,payload});
  let body={protocol:1,capabilities,workspaceId:'workspace-logo',initialized:true};
  if(endpoint==='/v1/sync'){
   const remote=copy(state);if(omitLogo)delete remote.settings.workspace.logoData;if(serverLogo)remote.settings.workspace.logoData=null;
   body={...body,state:remote,serverRevision:2,results:payload.operations.map(o=>({id:o.id,status:'applied',keys:o.changes.map(c=>c.key)}))};
  }
  queueMicrotask(()=>sandbox.salonSyncResponse(id,JSON.stringify({ok:true,status:200,body})));
 }}};
 sandbox.window=sandbox;vm.runInNewContext(source,sandbox);
 const manager=sandbox.SalonSyncUI.create({getState:()=>current,setState:s=>{current=s;},validate:Core.validateState,refresh(){},hasOpenForm:()=>false});
 return {api:sandbox.SalonSyncUI,manager,initial,state,queued,writes,requests,current:()=>current};
}
test('logo capability is conditional: legacy agendas still sync to HA0.3',async()=>{
 const s=setup();await s.manager.run();assert.deepEqual(s.requests.map(r=>r.endpoint),['/v1/status','/v1/sync']);assert.equal(s.writes.length,1);assert.equal(s.manager.getDevice().queue.length,0);assert.equal(s.current().clients[0].name,'Nume schimbat offline');assert.equal(Object.hasOwn(s.current().settings.workspace,'logoData'),false);
});
test('HA0.3 cannot receive/drop queued logo: preflight stops before any business write',async()=>{
 const s=setup({logo:true}),before=copy(s.queued);await s.manager.run();assert.deepEqual(s.requests.map(r=>r.endpoint),['/v1/status']);assert.equal(s.writes.length,0);assert.deepEqual(copy(s.manager.getDevice()),before);assert.equal(s.current().settings.workspace.logoData,null);assert(s.requests[0].payload.capabilities.includes('salon-logo-v1'));
});
test('HA0.4 acknowledges the same queued logo/reset atomically without erasing clients',async()=>{
 const s=setup({logo:true,capabilities:NEW});await s.manager.run();assert.equal(s.writes.length,1);assert.equal(s.manager.getDevice().queue.length,0);assert.equal(s.current().settings.workspace.logoData,null);assert.deepEqual(copy(s.current().clients),s.initial.clients);assert(s.requests.every(r=>r.payload.capabilities.includes('salon-logo-v1')));
});
test('declared logo support followed by missing logo cannot clear local data or queue',async()=>{
 const s=setup({logo:true,capabilities:NEW,omitLogo:true});await s.manager.run();assert.equal(s.writes.length,0);assert.equal(s.manager.getDevice().queue.length,1);assert.equal(s.current().settings.workspace.logoData,null);
});
test('unexpected logo in a response without capability is rejected before saving',async()=>{
 const s=setup({serverLogo:true});await s.manager.run();assert.equal(s.writes.length,0);assert.equal(s.manager.getDevice().queue.length,1);assert.equal(Object.hasOwn(s.current().settings.workspace,'logoData'),false);
});
test('logo requirements include base, bootstrap and queued/conflicted before/after settings',()=>{
 const {api}=setup(),state={settings:{workspace:{}}},withLogo={settings:{workspace:{logoData:null}}};assert.equal(api.requiresLogoSync(state,{}),false);assert.equal(api.requiresLogoSync(withLogo,{}),true);
 for(const device of [{base:withLogo},{bootstrap:{state:withLogo}},{queue:[{changes:[{key:'settings',before:withLogo.settings,after:state.settings}]}]},{conflicts:[{changes:[{key:'settings',before:state.settings,after:withLogo.settings}]}]}])assert.equal(api.requiresLogoSync(state,device),true);
 assert.throws(()=>api.requireCapabilities({protocol:1,capabilities:OLD},true),/0\.4\.0/);assert.doesNotThrow(()=>api.requireCapabilities({protocol:1,capabilities:OLD},false));
});
test('many offline logo edits are sent in bounded atomic batches, with remaining edits untouched',()=>{
 const {api}=setup(),operations=Array.from({length:30},(_,n)=>({id:'op-'+n,changes:[{key:'settings',before:{workspace:{logoData:'a'.repeat(699074)}},after:{workspace:{logoData:'b'.repeat(699074)}}}]}));
 const before=JSON.stringify(operations),batch=api.prepareSyncBatch({prepare:()=>operations},{});
 assert(batch.length>1&&batch.length<operations.length);assert(Buffer.byteLength(JSON.stringify(batch),'utf8')<20*1024*1024);assert.equal(JSON.stringify(operations),before);assert.deepEqual(copy(batch),operations.slice(0,batch.length));
});
test('batch size uses UTF8 bytes and never silently splits a single atomic operation',()=>{
 const {api}=setup(),operations=[{id:'big',description:'ă'.repeat(11*1024*1024)},{id:'later',description:'kept queued'}];
 const batch=api.prepareSyncBatch({prepare:()=>operations},{});assert.equal(batch.length,1);assert.equal(batch[0],operations[0]);assert.equal(operations[1].description,'kept queued');
});
