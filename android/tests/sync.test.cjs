const test=require('node:test');
const assert=require('node:assert/strict');
const Sync=require('../app/src/main/assets/sync.js');
require('../app/src/main/assets/app.js');
const Business=global.SalonCore;
const copy=value=>JSON.parse(JSON.stringify(value));
const stamp='2026-10-31T10:00:00.000Z';
function state(){return {version:1,demo:false,settings:{theme:'light',workspace:{salonName:'Salon'}},clients:[{id:'c1',name:'Ana'}],services:[{id:'s1',name:'Manichiură',price:120}],appointments:[{id:'a1',clientId:'c1',date:'2026-11-02',start:'10:00',duration:60,price:120,status:'confirmed',services:[{serviceId:'s1',name:'Manichiură',price:120}]}],expenses:[],suppliers:[]};}
function device(base=state()){return {...Sync.createDevice('tablet'),joined:true,enabled:true,role:'master',workspaceId:'salon',base:copy(base),serverRevision:1};}
function update(base,fn){const next=copy(base);fn(next);return next;}
function reply(next,ops,status='applied',revision=2){return {protocol:1,workspaceId:'salon',initialized:true,serverRevision:revision,results:ops.map(op=>({id:op.id,status,reason:status==='applied'?'':'Valoarea de pe server a fost modificată.',keys:op.changes.map(change=>change.key)})),state:copy(next)};}
function conflict(meta,local,server,ops=Sync.prepare(meta)){return Sync.applyResponse(meta,local,ops,reply(server,ops,'conflict'),stamp);}
function auditedState(){const s=Business.createDemo('2026-11-02');s.demo=false;s.appointments=[s.appointments[0]];s.appointments[0].status='completed';s.appointments[0].createdAt=stamp;s.appointments[0].updatedAt=stamp;s.expenses=[];s.suppliers=[];return s;}
function suppliedState(){const s=state();s.suppliers=[{id:'v1',name:'Magazin materiale'}];s.expenses=[{id:'e1',date:'2026-11-02',amount:50,description:'Materiale',createdAt:stamp,updatedAt:stamp,supplierId:'v1',supplierName:'Numele de la achiziție'}];return s;}
function orderedState(){const s=state();s.services=[{id:'z-first',name:'Primul ales',price:120},{id:'s1',name:'Manichiură',price:120},{id:'a-last',name:'Ultimul ales',price:0}];return s;}
function correct(s,price,at){return update(s,next=>{const before=next.appointments[0],after={...before,price,updatedAt:at};next.appointments[0]=Business.recordAppointmentCorrection(before,after,at,'Corecție de test');});}
function clientDeletionRace(){const original=auditedState(),booking=copy(original.appointments[0]);original.appointments=[];const local=Business.deleteClient(original,'c1'),server=update(original,s=>{s.appointments=[booking];Object.assign(s.clients.find(c=>c.id==='c1'),{name:'Nume actual de pe HA',phone:'+40722123456',notes:'Actualizare de pe celălalt dispozitiv'});});return {original,local,server};}

test('canonical record maps round-trip business data and normalize absent optional collections',()=>{
 const original=state();delete original.expenses;delete original.suppliers;const map=Sync.flatten(original);
 assert.deepEqual(Object.keys(map).sort(),['appointments/a1','clients/c1','meta','services/s1','settings']);
 assert.deepEqual(map.meta,{demo:false});assert.deepEqual(Sync.inflate(map),{...original,expenses:[],suppliers:[]});assert.equal('token' in map,false);
 map['clients/c1'].name='Changed';assert.equal(original.clients[0].name,'Ana');
});
test('supplier records and historical expense snapshots round-trip without modifying legacy expenses',()=>{
 const original=suppliedState();original.expenses.push({id:'legacy',date:'2025-01-01',amount:20,description:'Înregistrare veche'});
 const map=Sync.flatten(original),result=Sync.inflate(map);
 assert.deepEqual(map['suppliers/v1'],original.suppliers[0]);assert.deepEqual(result,original);
 assert.equal(result.expenses[0].supplierName,'Numele de la achiziție');assert.equal(result.suppliers[0].name,'Magazin materiale');assert.equal('supplierId' in result.expenses[1],false);
 const legacy=state();delete legacy.suppliers;assert.deepEqual(Sync.diff(legacy,{...legacy,suppliers:[]}),[]);
 result.suppliers[0].name='Changed copy';assert.equal(original.suppliers[0].name,'Magazin materiale');
});
test('creating a supplier with an expense remains one complete atomic operation',()=>{
 const original=state(),local=suppliedState(),meta=Sync.queueChange(device(original),original,local,'supplier-and-expense',stamp),sent=Sync.prepare(meta);
 assert.deepEqual(sent[0].changes.map(c=>c.key),['expenses/e1','suppliers/v1']);assert.ok(sent[0].changes.every(c=>c.before===null));
 const result=Sync.applyResponse(meta,local,sent,reply(local,sent),stamp);assert.deepEqual(result.state,local);assert.deepEqual(result.meta.queue,[]);
});
test('comparison is independent of object key order but preserves array ordering',()=>{
 assert.equal(Sync.equal({a:1,b:{c:2,d:[1,2]}},{b:{d:[1,2],c:2},a:1}),true);
 assert.equal(Sync.equal([1,2],[2,1]),false);assert.equal(Sync.equal(null,{}),false);
 const original=state(),reordered=copy(original);reordered.settings={workspace:{salonName:'Salon'},theme:'light'};assert.deepEqual(Sync.diff(original,reordered),[]);
});
test('inflate optionally preserves existing service preferences and appends unknown new records canonically',()=>{
 const original=orderedState(),map=Sync.flatten(original),preferred=original.services.map(s=>s.id);map['services/new-b']={id:'new-b',name:'Nou B',price:0};map['services/new-a']={id:'new-a',name:'Nou A',price:0};
 assert.deepEqual(Sync.inflate(map).services.map(s=>s.id),['a-last','new-a','new-b','s1','z-first']);assert.deepEqual(Sync.inflate(map,[...preferred,'already-deleted']).services.map(s=>s.id),[...preferred,'new-a','new-b']);assert.deepEqual(preferred,['z-first','s1','a-last']);
 const result=Sync.inflate(map,preferred);result.services[0].name='Changed copy';assert.equal(original.services[0].name,'Primul ales');
 for(const invalid of [null,{},'s1',['s1','s1'],[7],['']])assert.throws(()=>Sync.inflate(map,invalid));
});
test('service array reordering remains a local preference and generates no CAS changes',()=>{
 const original=orderedState(),reordered=update(original,s=>s.services.reverse()),meta=Sync.queueChange(device(original),original,reordered,'order-only',stamp);
 assert.deepEqual(Sync.diff(original,reordered),[]);assert.deepEqual(meta.queue,[]);assert.deepEqual(Sync.flatten(original),Sync.flatten(reordered));
});
test('an unchanged sync response cannot reorder the current service catalog by ID',()=>{
 const original=orderedState(),meta=device(original),server=Sync.inflate(Sync.flatten(original)),result=Sync.applyResponse(meta,original,[],reply(server,[]),stamp);
 assert.deepEqual(result.state.services,original.services);assert.deepEqual(result.meta.base.services,server.services);assert.deepEqual(result.meta.queue,[]);assert.deepEqual(result.meta.conflicts,[]);
 const repeated=Sync.applyResponse(result.meta,result.state,[],reply(server,[],'applied',3),stamp);assert.deepEqual(repeated.state.services,original.services);
});
test('sync adopts service additions and deletions while retaining the relative order of survivors',()=>{
 const original=orderedState(),remote=update(original,s=>{s.services=s.services.filter(service=>service.id!=='s1');s.services.unshift({id:'new-b',name:'Nou B',price:0});s.services.push({id:'new-a',name:'Nou A',price:0});}),result=Sync.applyResponse(device(original),original,[],reply(remote,[]),stamp);
 assert.deepEqual(result.state.services.map(s=>s.id),['z-first','a-last','new-a','new-b']);assert.equal(result.state.services.some(s=>s.id==='s1'),false);assert.deepEqual(Sync.diff(remote,result.state),[]);
});
test('an acknowledgement preserves an order changed locally while the request was in flight',()=>{
 const original=orderedState(),edited=update(original,s=>s.clients[0].name='Sent'),meta=Sync.queueChange(device(original),original,edited,'sent',stamp),sent=Sync.prepare(meta),latest=update(edited,s=>s.services=[s.services[2],s.services[0],s.services[1]]);
 const queued=Sync.queueChange(meta,edited,latest,'local-order',stamp),result=Sync.applyResponse(queued,latest,sent,reply(edited,sent),stamp);
 assert.deepEqual(result.state.services,latest.services);assert.deepEqual(result.meta.queue,[]);assert.equal(result.state.clients[0].name,'Sent');
});
test('both conflict resolution choices preserve current service order while retaining atomic edits',()=>{
 for(const choice of ['server','local']){
  const original=orderedState(),local=update(original,s=>{s.services[0].price=180;s.clients[0].name='Local';}),server=update(original,s=>{s.services[0].price=150;s.services.push({id:'server-new',name:'Nou HA',price:20});}),first=conflict(Sync.queueChange(device(original),original,local,'catalog-edit',stamp),local,server),latest=update(first.state,s=>s.services=[s.services.find(x=>x.id==='a-last'),s.services.find(x=>x.id==='z-first'),s.services.find(x=>x.id==='s1'),s.services.find(x=>x.id==='server-new')]),result=Sync.resolve(first.meta,latest,0,choice,'resolve-'+choice,stamp);
  assert.deepEqual(first.state.services.map(s=>s.id),['z-first','s1','a-last','server-new']);assert.deepEqual(result.state.services.map(s=>s.id),['a-last','z-first','s1','server-new']);assert.equal(result.state.services.find(s=>s.id==='z-first').price,choice==='server'?150:180);assert.equal(result.state.clients[0].name,choice==='server'?'Ana':'Local');assert.equal(result.meta.conflicts.length,0);
  if(choice==='local')assert.deepEqual(result.meta.queue[0].changes.map(c=>c.key),['clients/c1','services/z-first']);else assert.deepEqual(result.meta.queue,[]);
 }
});
test('diff groups all changed records including additions and deletions into one atomic operation',()=>{
 const original=state(),next=update(original,s=>{s.clients.push({id:'c2',name:'Dan'});s.appointments.push({...s.appointments[0],id:'a2',clientId:'c2'});s.services=[];});
 const changes=Sync.diff(original,next);assert.deepEqual(changes.map(x=>x.key),['appointments/a2','clients/c2','services/s1']);
 assert.equal(changes[0].before,null);assert.equal(changes[2].after,null);assert.deepEqual(original.services,[{id:'s1',name:'Manichiură',price:120}]);
});
test('queueing while paused preserves offline changes and an offline chain keeps CAS predecessors',()=>{
 const original=state(),first=update(original,s=>s.clients[0].name='First'),second=update(first,s=>s.clients[0].name='Second');
 let meta=device(original);meta.enabled=false;meta=Sync.queueChange(meta,original,first,'op1',stamp);meta=Sync.queueChange(meta,first,second,'op2',stamp);
 assert.equal(meta.enabled,false);assert.equal(meta.queue.length,2);assert.deepEqual(meta.queue[1].changes[0].before,first.clients[0]);
 const sent=Sync.prepare(meta),result=Sync.applyResponse(meta,second,sent,reply(second,sent,'applied',3),stamp);
 assert.equal(result.meta.queue.length,0);assert.deepEqual(result.state,second);assert.equal(result.meta.serverRevision,3);
});
test('unjoined or unchanged agendas never invent queued operations',()=>{
 const original=state(),next=update(original,s=>s.clients[0].name='New');const meta=Sync.createDevice('phone');
 assert.equal(Sync.queueChange(meta,original,next,'op1',stamp).queue.length,0);assert.equal(Sync.queueChange(device(),original,original,'op2',stamp).queue.length,0);
});
test('stable operation IDs are idempotent locally and cannot be reused for different edits',()=>{
 const original=state(),next=update(original,s=>s.clients[0].name='New'),meta=Sync.queueChange(device(),original,next,'op1',stamp);
 assert.equal(Sync.queueChange(meta,original,next,'op1',stamp).queue.length,1);
 assert.throws(()=>Sync.queueChange(meta,original,update(original,s=>s.clients[0].name='Other'),'op1',stamp));
});
test('newer local edits made during a request survive the response and retain their queued CAS',()=>{
 const original=state(),first=update(original,s=>s.clients[0].name='Sent'),second=update(first,s=>s.clients[0].name='Latest');
 const queued=Sync.queueChange(device(),original,first,'op1',stamp),sent=Sync.prepare(queued),current=Sync.queueChange(queued,first,second,'op2',stamp);
 const remote=update(first,s=>s.services.push({id:'s2',name:'Pedichiură',price:130}));
 const result=Sync.applyResponse(current,second,sent,reply(remote,sent),stamp);
 assert.equal(result.state.clients[0].name,'Latest');assert.equal(result.state.services.length,2);assert.deepEqual(result.meta.queue.map(op=>op.id),['op2']);
 assert.equal(result.meta.base.clients[0].name,'Sent');
});
test('local pending deletion overrides the remote record without losing independent server additions',()=>{
 const original=state(),local=update(original,s=>s.services=[]),meta=Sync.queueChange(device(),original,local,'delete',stamp),remote=update(original,s=>s.expenses.push({id:'e1',amount:25}));
 const result=Sync.applyResponse(meta,local,[],reply(remote,[]),stamp);
 assert.deepEqual(result.state.services,[]);assert.deepEqual(result.state.expenses,[{id:'e1',amount:25}]);assert.equal(result.meta.queue.length,1);
});
test('server deletions are adopted if no remaining local operation protects that key',()=>{
 const original=state(),remote=update(original,s=>s.services=[]),result=Sync.applyResponse(device(),original,[],reply(remote,[]),stamp);
 assert.deepEqual(result.state.services,[]);assert.deepEqual(original.services,[{id:'s1',name:'Manichiură',price:120}]);
});
test('server deletion of a client and booking preserves the client needed by a conflicted local booking',()=>{
 const original=auditedState();original.appointments[0].status='confirmed';const local=update(original,s=>s.appointments[0].notes='Local edit'),server=update(original,s=>{s.clients=s.clients.filter(c=>c.id!=='c1');s.appointments=[];}),meta=Sync.queueChange(device(original),original,local,'edit-booking',stamp),sent=Sync.prepare(meta),payload=JSON.stringify(sent),result=conflict(meta,local,server,sent);
 assert.deepEqual(result.meta.retainedDependencies,{'edit-booking':['clients/c1']});assert.equal(result.state.clients.find(c=>c.id==='c1').name,'Ana Popescu');assert.equal(result.state.appointments[0].notes,'Local edit');assert.doesNotThrow(()=>Business.validateState(result.state));
 assert.equal(JSON.stringify(sent),payload);assert.deepEqual(result.meta.conflicts[0].changes,sent[0].changes);assert.deepEqual(Sync.operationKeys(result.meta,result.meta.conflicts[0]),['appointments/a1','clients/c1']);
});
test('unsent in-flight edits keep missing client support without changing their immutable CAS payload',()=>{
 const original=auditedState();original.appointments[0].status='confirmed';const local=update(original,s=>s.appointments[0].notes='Queued during request'),server=update(original,s=>{s.clients=s.clients.filter(c=>c.id!=='c1');s.appointments=[];}),meta=Sync.queueChange(device(original),original,local,'unsent',stamp),payload=JSON.stringify(Sync.prepare(meta)),result=Sync.applyResponse(meta,local,[],reply(server,[]),stamp);
 assert.deepEqual(result.meta.retainedDependencies,{unsent:['clients/c1']});assert.equal(JSON.stringify(Sync.prepare(result.meta)),payload);assert.doesNotThrow(()=>Business.validateState(result.state));
});
test('server resolution removes the protected booking and missing client together and archives the client copy',()=>{
 const original=auditedState();original.appointments[0].status='confirmed';const local=update(original,s=>s.appointments[0].notes='Local edit'),server=update(original,s=>{s.clients=s.clients.filter(c=>c.id!=='c1');s.appointments=[];}),first=conflict(Sync.queueChange(device(original),original,local,'edit',stamp),local,server),result=Sync.resolve(first.meta,first.state,0,'server','unused',stamp);
 assert.equal(result.state.clients.some(c=>c.id==='c1'),false);assert.deepEqual(result.state.appointments,[]);assert.equal('retainedDependencies' in result.meta,false);assert.deepEqual(result.meta.resolutionArchive[0].retainedRecords['clients/c1'],original.clients[0]);assert.doesNotThrow(()=>Business.validateState(result.state));assert.doesNotThrow(()=>Sync.validateDevice(result.meta));
});
test('local resolution recreates a missing server client and appointment in one fresh atomic operation',()=>{
 const original=auditedState();original.appointments[0].status='confirmed';const local=update(original,s=>s.appointments[0].notes='Keep local'),server=update(original,s=>{s.clients=s.clients.filter(c=>c.id!=='c1');s.appointments=[];}),first=conflict(Sync.queueChange(device(original),original,local,'edit',stamp),local,server),result=Sync.resolve(first.meta,first.state,0,'local','recreate',stamp);
 assert.deepEqual(result.meta.queue[0].changes.map(c=>c.key),['appointments/a1','clients/c1']);assert.ok(result.meta.queue[0].changes.every(change=>change.before===null));assert.equal(result.meta.queue[0].changes.find(c=>c.key==='clients/c1').after.name,'Ana Popescu');assert.doesNotThrow(()=>Business.validateState(result.state));
 const acknowledged=Sync.applyResponse(result.meta,result.state,Sync.prepare(result.meta),reply(result.state,Sync.prepare(result.meta),'applied',3),stamp);assert.equal('retainedDependencies' in acknowledged.meta,false);assert.deepEqual(acknowledged.meta.queue,[]);
});
test('audit-only client dependencies are retained while existing server client updates remain visible',()=>{
 const original=auditedState(),local=update(original,s=>{const before=s.appointments[0],after={...before,clientId:'c2',price:180};s.appointments[0]=Business.recordAppointmentCorrection(before,after,stamp,'Client corectat');}),server=update(original,s=>{s.clients=s.clients.filter(c=>c.id!=='c1');s.clients.find(c=>c.id==='c2').name='Remote name';s.appointments=[];}),first=conflict(Sync.queueChange(device(original),original,local,'audit',stamp),local,server);
 assert.deepEqual(first.meta.retainedDependencies,{audit:['clients/c1']});assert.equal(first.state.appointments[0].clientId,'c2');assert.equal(first.state.clients.find(c=>c.id==='c2').name,'Remote name');assert.equal(first.state.clients.find(c=>c.id==='c1').name,'Ana Popescu');assert.doesNotThrow(()=>Business.validateState(first.state));
});
test('new queued appointments sharing a missing client join the conflict closure without being sent prematurely',()=>{
 const original=auditedState();original.appointments[0].status='confirmed';const local=update(original,s=>s.appointments[0].notes='Edited'),server=update(original,s=>{s.clients=s.clients.filter(c=>c.id!=='c1');s.appointments=[];}),first=conflict(Sync.queueChange(device(original),original,local,'edit',stamp),local,server),latest=update(first.state,s=>s.appointments.push({...s.appointments[0],id:'a2',start:'14:00'})),meta=Sync.queueChange(first.meta,first.state,latest,'new-booking',stamp);
 assert.deepEqual(meta.retainedDependencies['new-booking'],['clients/c1']);assert.deepEqual(Sync.prepare(meta),[]);
 const result=Sync.resolve(meta,latest,0,'local','recreate-all',stamp);assert.deepEqual(result.meta.queue[0].changes.map(c=>c.key),['appointments/a1','appointments/a2','clients/c1']);assert.doesNotThrow(()=>Business.validateState(result.state));
});
test('restored server clients stop being retained and expose independent current server values',()=>{
 const original=auditedState();original.appointments[0].status='confirmed';const local=update(original,s=>s.appointments[0].notes='Edited'),deleted=update(original,s=>{s.clients=s.clients.filter(c=>c.id!=='c1');s.appointments=[];}),first=conflict(Sync.queueChange(device(original),original,local,'edit',stamp),local,deleted),restored=update(original,s=>s.clients[0].name='Recreated on HA'),result=Sync.applyResponse(first.meta,first.state,[],reply(restored,[],'applied',3),stamp);
 assert.equal('retainedDependencies' in result.meta,false);assert.equal(result.state.clients.find(c=>c.id==='c1').name,'Recreated on HA');assert.equal(result.state.appointments[0].notes,'Edited');assert.doesNotThrow(()=>Business.validateState(result.state));
});
test('invalid or orphaned retained dependency metadata is rejected',()=>{
 const original=state(),next=update(original,s=>s.appointments[0].price=150),meta=Sync.queueChange(device(),original,next,'op',stamp);
 for(const mapping of [{missing:['clients/c1']},{op:['services/s1']},{op:['clients/']},{op:[]},{op:['clients/c1','clients/c1']},{op:null}])assert.throws(()=>Sync.validateDevice({...meta,retainedDependencies:mapping}));
});
test('deleted HA supplier support survives a conflicted expense without changing sent CAS payloads',()=>{
 const original=suppliedState(),local=update(original,s=>s.expenses[0].amount=75),server=update(original,s=>{s.suppliers=[];s.expenses=[];}),meta=Sync.queueChange(device(original),original,local,'edit-expense',stamp),sent=Sync.prepare(meta),serialized=JSON.stringify(sent),result=conflict(meta,local,server,sent);
 assert.deepEqual(result.meta.retainedDependencies,{'edit-expense':['suppliers/v1']});assert.deepEqual(result.state.suppliers,original.suppliers);assert.equal(result.state.expenses[0].amount,75);assert.equal(result.state.expenses[0].supplierName,'Numele de la achiziție');
 assert.deepEqual(Sync.operationKeys(result.meta,result.meta.conflicts[0]),['expenses/e1','suppliers/v1']);assert.equal(JSON.stringify(sent),serialized);assert.deepEqual(result.meta.conflicts[0].changes,sent[0].changes);assert.doesNotThrow(()=>Sync.validateDevice(result.meta));
});
test('in-flight queued expense and booking edits retain both missing dependency families',()=>{
 const original=suppliedState(),local=update(original,s=>{s.expenses[0].amount=75;s.appointments[0].notes='Local';}),server=update(original,s=>{s.clients=[];s.appointments=[];s.suppliers=[];s.expenses=[];}),meta=Sync.queueChange(device(original),original,local,'both',stamp),serialized=JSON.stringify(Sync.prepare(meta)),result=Sync.applyResponse(meta,local,[],reply(server,[]),stamp);
 assert.deepEqual(result.meta.retainedDependencies,{both:['clients/c1','suppliers/v1']});assert.deepEqual(result.state.clients,original.clients);assert.deepEqual(result.state.suppliers,original.suppliers);assert.equal(JSON.stringify(Sync.prepare(result.meta)),serialized);
});
test('server conflict resolution removes deleted supplier and expense together and archives their full proposal',()=>{
 const original=suppliedState(),local=update(original,s=>s.expenses[0].amount=75),server=update(original,s=>{s.suppliers=[];s.expenses=[];}),first=conflict(Sync.queueChange(device(original),original,local,'edit',stamp),local,server),result=Sync.resolve(first.meta,first.state,0,'server','unused',stamp);
 assert.deepEqual(result.state.suppliers,[]);assert.deepEqual(result.state.expenses,[]);assert.equal('retainedDependencies' in result.meta,false);assert.deepEqual(result.meta.resolutionArchive[0].retainedRecords,{'suppliers/v1':original.suppliers[0]});assert.deepEqual(result.meta.resolutionArchive[0].operations,first.meta.conflicts);
 const checked=Sync.validateDevice(result.meta);checked.resolutionArchive[0].retainedRecords['suppliers/v1'].name='Copy';assert.equal(result.meta.resolutionArchive[0].retainedRecords['suppliers/v1'].name,'Magazin materiale');
});
test('local conflict resolution recreates a deleted supplier and expense with one fresh CAS',()=>{
 const original=suppliedState(),local=update(original,s=>s.expenses[0].amount=75),server=update(original,s=>{s.suppliers=[];s.expenses=[];}),first=conflict(Sync.queueChange(device(original),original,local,'edit',stamp),local,server),result=Sync.resolve(first.meta,first.state,0,'local','recreate-supplier',stamp);
 assert.deepEqual(result.meta.queue[0].changes.map(c=>c.key),['expenses/e1','suppliers/v1']);assert.ok(result.meta.queue[0].changes.every(c=>c.before===null));assert.deepEqual(result.state,local);assert.deepEqual(result.meta.resolutionArchive[0].retainedRecords['suppliers/v1'],original.suppliers[0]);
 const sent=Sync.prepare(result.meta),ack=Sync.applyResponse(result.meta,result.state,sent,reply(result.state,sent,'applied',3),stamp);assert.deepEqual(ack.meta.queue,[]);assert.equal('retainedDependencies' in ack.meta,false);
});
test('missing supplier dependency closes over queued catalog edits and other dependent expenses',()=>{
 const original=suppliedState(),local=update(original,s=>s.expenses[0].amount=75),server=update(original,s=>{s.suppliers=[];s.expenses=[];}),first=conflict(Sync.queueChange(device(original),original,local,'edit',stamp),local,server),renamed=update(first.state,s=>s.suppliers[0].name='Catalog nou'),second=update(renamed,s=>s.expenses.push({...s.expenses[0],id:'e2',amount:100})),latest=update(second,s=>s.services[0].price=160);
 let meta=Sync.queueChange(first.meta,first.state,renamed,'rename',stamp);meta=Sync.queueChange(meta,renamed,second,'second-expense',stamp);meta=Sync.queueChange(meta,second,latest,'independent',stamp);
 assert.deepEqual(meta.retainedDependencies['second-expense'],['suppliers/v1']);assert.deepEqual(Sync.prepare(meta).map(op=>op.id),['independent']);
 const result=Sync.resolve(meta,latest,0,'local','recreate-all',stamp);assert.deepEqual(result.meta.queue.map(op=>op.id),['independent','recreate-all']);assert.deepEqual(result.meta.queue[1].changes.map(c=>c.key),['expenses/e1','expenses/e2','suppliers/v1']);assert.equal(result.meta.queue[1].changes[2].after.name,'Catalog nou');assert.deepEqual(result.meta.resolutionArchive[0].operations.map(op=>op.id),['edit','rename','second-expense']);
});
test('existing or restored HA supplier names stay authoritative without changing historical expense snapshots',()=>{
 const original=suppliedState(),local=update(original,s=>s.expenses[0].amount=75),meta=Sync.queueChange(device(original),original,local,'edit',stamp),renamed=update(original,s=>s.suppliers[0].name='Nume HA'),result=Sync.applyResponse(meta,local,[],reply(renamed,[]),stamp);
 assert.equal(result.state.suppliers[0].name,'Nume HA');assert.equal(result.state.expenses[0].supplierName,'Numele de la achiziție');assert.equal('retainedDependencies' in result.meta,false);
 const deleted=update(original,s=>{s.suppliers=[];s.expenses=[];}),first=conflict(meta,local,deleted),restored=Sync.applyResponse(first.meta,first.state,[],reply(renamed,[],'applied',3),stamp);
 assert.equal(restored.state.suppliers[0].name,'Nume HA');assert.equal(restored.state.expenses[0].amount,75);assert.equal('retainedDependencies' in restored.meta,false);
});
test('an independent catalog-name conflict does not block a queued expense for an existing supplier',()=>{
 const original=suppliedState(),local=update(original,s=>s.suppliers[0].name='Nume local'),server=update(original,s=>s.suppliers[0].name='Nume HA'),first=conflict(Sync.queueChange(device(original),original,local,'rename',stamp),local,server),latest=update(first.state,s=>s.expenses[0].amount=75),meta=Sync.queueChange(first.meta,first.state,latest,'expense',stamp);
 assert.equal('retainedDependencies' in meta,false);assert.deepEqual(Sync.prepare(meta).map(op=>op.id),['expense']);
});
test('conflicts retain the full atomic client plus appointment edit and all local values',()=>{
 const original=state(),local=update(original,s=>{s.clients.push({id:'c2',name:'Dan'});s.appointments.push({...s.appointments[0],id:'a2',clientId:'c2'});}),meta=Sync.queueChange(device(),original,local,'atomic',stamp);
 const result=conflict(meta,local,original);
 assert.equal(result.meta.queue.length,0);assert.equal(result.meta.conflicts.length,1);assert.equal(result.meta.conflicts[0].changes.length,2);assert.equal(result.state.clients.length,2);assert.equal(result.state.appointments.length,2);
});
test('rejected operations remain recoverable conflicts rather than disappearing',()=>{
 const original=state(),local=update(original,s=>s.clients[0].name='Local'),meta=Sync.queueChange(device(),original,local,'rejected',stamp),sent=Sync.prepare(meta),result=Sync.applyResponse(meta,local,sent,reply(original,sent,'rejected'),stamp);
 assert.equal(result.meta.conflicts[0].status,'rejected');assert.equal(result.state.clients[0].name,'Local');assert.equal(Sync.prepare(result.meta).length,0);
});

test('a rejected physical client deletion preserves a new HA booking through a valid tombstone projection',()=>{
 const {original,local,server}=clientDeletionRace(),meta=Sync.queueChange(device(original),original,local,'delete-client',stamp),sent=Sync.prepare(meta),inputs=JSON.stringify({meta,local,server,sent}),result=Sync.applyResponse(meta,local,sent,reply(server,sent,'rejected'),stamp),client=result.state.clients.find(c=>c.id==='c1');
 assert.deepEqual(client,{...server.clients.find(c=>c.id==='c1'),deleted:true,archived:true,phone:'',notes:''});assert.deepEqual(result.state.appointments,server.appointments);assert.doesNotThrow(()=>Business.validateState(result.state));
 assert.equal(result.meta.queue.length,0);assert.equal(result.meta.conflicts.length,1);assert.equal(result.meta.conflicts[0].status,'rejected');assert.deepEqual(result.meta.conflicts[0].changes,sent[0].changes);assert.equal(result.meta.conflicts[0].changes[0].after,null);assert.deepEqual(result.meta.base,server);
 assert.equal(JSON.stringify({meta,local,server,sent}),inputs);assert.deepEqual(Sync.prepare(result.meta),[]);assert.doesNotThrow(()=>Sync.validateDevice(result.meta));
});

test('a pull protects a still-pending physical deletion without rewriting its CAS or duplicating later rejection',()=>{
 const {original,local,server}=clientDeletionRace(),meta=Sync.queueChange(device(original),original,local,'delete-client',stamp),serialized=JSON.stringify(meta.queue),pulled=Sync.applyResponse(meta,local,[],reply(server,[]),stamp),again=Sync.applyResponse(pulled.meta,pulled.state,[],reply(server,[]),stamp);
 assert.equal(JSON.stringify(pulled.meta.queue),serialized);assert.equal(pulled.meta.conflicts.length,0);assert.equal(pulled.state.clients.find(c=>c.id==='c1').deleted,true);assert.deepEqual(again,pulled);assert.doesNotThrow(()=>Business.validateState(pulled.state));
 const sent=Sync.prepare(pulled.meta),response=reply(server,sent,'rejected',3),rejected=Sync.applyResponse(pulled.meta,pulled.state,sent,response,stamp),repeated=Sync.applyResponse(rejected.meta,rejected.state,sent,response,stamp);
 assert.equal(JSON.stringify(sent),serialized);assert.deepEqual(repeated,rejected);assert.equal(repeated.meta.queue.length,0);assert.equal(repeated.meta.conflicts.length,1);assert.doesNotThrow(()=>Business.validateState(repeated.state));
});

test('server resolution restores the HA contact and leaves its new booking and history untouched',()=>{
 const {original,local,server}=clientDeletionRace(),meta=Sync.queueChange(device(original),original,local,'delete-client',stamp),sent=Sync.prepare(meta),first=Sync.applyResponse(meta,local,sent,reply(server,sent,'rejected'),stamp),result=Sync.resolve(first.meta,first.state,0,'server','unused',stamp);
 assert.deepEqual(result.state,server);assert.deepEqual(result.meta.queue,[]);assert.deepEqual(result.meta.conflicts,[]);assert.equal(result.meta.resolutionArchive[0].choice,'server');assert.equal(result.meta.resolutionArchive[0].operations[0].changes[0].after,null);assert.deepEqual(result.meta.resolutionArchive[0].operations,first.meta.conflicts);assert.doesNotThrow(()=>Business.validateState(result.state));
});

test('local resolution replaces a physical delete with one active-to-tombstone CAS and never rewrites HA bookings',()=>{
 const {original,local,server}=clientDeletionRace(),meta=Sync.queueChange(device(original),original,local,'delete-client',stamp),sent=Sync.prepare(meta),first=Sync.applyResponse(meta,local,sent,reply(server,sent,'rejected'),stamp),result=Sync.resolve(first.meta,first.state,0,'local','delete-with-history',stamp),client=result.state.clients.find(c=>c.id==='c1');
 assert.deepEqual(result.meta.queue.map(op=>op.id),['delete-with-history']);assert.deepEqual(result.meta.queue[0].changes,[{key:'clients/c1',before:server.clients.find(c=>c.id==='c1'),after:client}]);assert.equal(client.deleted,true);assert.equal(client.name,'Nume actual de pe HA');assert.equal(client.phone,'');assert.equal(client.notes,'');assert.equal(client.archived,true);assert.deepEqual(result.state.appointments,server.appointments);
 assert.equal(result.meta.resolutionArchive[0].choice,'local');assert.equal(result.meta.resolutionArchive[0].operations[0].changes[0].after,null);assert.deepEqual(result.meta.conflicts,[]);assert.doesNotThrow(()=>Business.validateState(result.state));
 const retry=Sync.prepare(result.meta),ack=Sync.applyResponse(result.meta,result.state,retry,reply(result.state,retry,'applied',3),stamp);assert.deepEqual(ack.meta.queue,[]);assert.deepEqual(ack.state,result.state);assert.deepEqual(Sync.diff(ack.state,result.state),[]);assert.doesNotThrow(()=>Business.validateState(ack.state));
});

test('audit-only references also protect a physically deleted client without replacing independently updated clients',()=>{
 const {original,local,server}=clientDeletionRace(),before=server.appointments[0],after={...before,clientId:'c2',price:180};server.appointments[0]=Business.recordAppointmentCorrection(before,after,stamp,'Client corectat pe HA');server.clients.find(c=>c.id==='c2').name='Alt client actualizat pe HA';
 const meta=Sync.queueChange(device(original),original,local,'delete-audit-client',stamp),sent=Sync.prepare(meta),first=Sync.applyResponse(meta,local,sent,reply(server,sent,'rejected'),stamp);
 assert.equal(first.state.appointments[0].clientId,'c2');assert.equal(first.state.appointments[0].corrections[0].before.clientId,'c1');assert.equal(first.state.clients.find(c=>c.id==='c1').deleted,true);assert.deepEqual(first.state.clients.find(c=>c.id==='c2'),server.clients.find(c=>c.id==='c2'));assert.deepEqual(first.state.appointments,server.appointments);assert.doesNotThrow(()=>Business.validateState(first.state));
 for(const choice of ['server','local']){const result=Sync.resolve(first.meta,first.state,0,choice,'resolve-'+choice,stamp);assert.deepEqual(result.state.appointments,server.appointments);assert.doesNotThrow(()=>Business.validateState(result.state));assert.equal(!!result.state.clients.find(c=>c.id==='c1').deleted,choice==='local');}
});

test('unreferenced physical deletions stay deleted and same-name client identities are never projected together',()=>{
 const {original}=clientDeletionRace();original.clients.find(c=>c.id==='c2').name=original.clients.find(c=>c.id==='c1').name;const local=Business.deleteClient(original,'c1'),meta=Sync.queueChange(device(original),original,local,'delete-unused',stamp),sent=Sync.prepare(meta),remote=update(original,s=>s.clients.find(c=>c.id==='c2').notes='Independent HA edit'),first=Sync.applyResponse(meta,local,sent,reply(remote,sent,'conflict'),stamp);
 assert.equal(first.state.clients.some(c=>c.id==='c1'),false);assert.deepEqual(first.state.clients.find(c=>c.id==='c2'),remote.clients.find(c=>c.id==='c2'));assert.doesNotThrow(()=>Business.validateState(first.state));
 const accepted=Sync.applyResponse(meta,local,sent,reply(local,sent),stamp);assert.equal(accepted.state.clients.some(c=>c.id==='c1'),false);assert.deepEqual(accepted.meta.queue,[]);assert.deepEqual(accepted.meta.conflicts,[]);assert.doesNotThrow(()=>Business.validateState(accepted.state));
});

test('independent concurrent physical deletions remain separate conflicts while both HA bookings survive resolution',()=>{
 const {original,server}=clientDeletionRace();server.appointments.push({...copy(server.appointments[0]),id:'a2',clientId:'c2',start:'12:00'});const firstLocal=Business.deleteClient(original,'c1'),local=Business.deleteClient(firstLocal,'c2');let meta=Sync.queueChange(device(original),original,firstLocal,'delete-one',stamp);meta=Sync.queueChange(meta,firstLocal,local,'delete-two',stamp);const sent=Sync.prepare(meta),first=Sync.applyResponse(meta,local,sent,reply(server,sent,'rejected'),stamp),resolved=Sync.resolve(first.meta,first.state,0,'server','unused',stamp);
 assert.equal(first.meta.conflicts.length,2);assert.equal(first.state.clients.find(c=>c.id==='c1').deleted,true);assert.equal(first.state.clients.find(c=>c.id==='c2').deleted,true);assert.deepEqual(first.state.appointments,server.appointments);assert.doesNotThrow(()=>Business.validateState(first.state));
 assert.deepEqual(resolved.meta.conflicts.map(op=>op.id),['delete-two']);assert.deepEqual(resolved.state.clients.find(c=>c.id==='c1'),server.clients.find(c=>c.id==='c1'));assert.equal(resolved.state.clients.find(c=>c.id==='c2').deleted,true);assert.deepEqual(resolved.state.appointments,server.appointments);assert.doesNotThrow(()=>Business.validateState(resolved.state));
});
test('blocked-key closure reaches earlier and later connected queue operations but independent edits can sync',()=>{
 const original=state(),first=update(original,s=>s.clients[0].name='Local');let result=conflict(Sync.queueChange(device(),original,first,'bad',stamp),first,original);
 const service=update(first,s=>s.services[0].price=150),bridge=update(service,s=>{s.clients[0].name='Latest';s.services[0].price=175;}),other=update(bridge,s=>s.expenses.push({id:'e1',amount:50}));
 result.meta=Sync.queueChange(result.meta,first,service,'earlier',stamp);result.meta=Sync.queueChange(result.meta,service,bridge,'bridge',stamp);result.meta=Sync.queueChange(result.meta,bridge,other,'independent',stamp);
 assert.deepEqual(Sync.prepare(result.meta).map(op=>op.id),['independent']);
});
test('duplicate response acknowledgements are harmless and cannot duplicate conflicts',()=>{
 const original=state(),local=update(original,s=>s.clients[0].name='Local'),meta=Sync.queueChange(device(),original,local,'op',stamp),sent=Sync.prepare(meta),response=reply(original,sent,'conflict');
 const first=Sync.applyResponse(meta,local,sent,response,stamp),second=Sync.applyResponse(first.meta,first.state,sent,response,stamp);
 assert.equal(second.meta.conflicts.length,1);assert.deepEqual(second,first);
});
test('an applied acknowledgement repeated after a newer local edit cannot erase that edit',()=>{
 const original=state(),first=update(original,s=>s.clients[0].name='First'),meta=Sync.queueChange(device(),original,first,'first',stamp),sent=Sync.prepare(meta),response=reply(first,sent);
 const acknowledged=Sync.applyResponse(meta,first,sent,response,stamp),latest=update(acknowledged.state,s=>s.clients[0].name='Latest'),queued=Sync.queueChange(acknowledged.meta,acknowledged.state,latest,'newer',stamp),result=Sync.applyResponse(queued,latest,sent,response,stamp);
 assert.equal(result.state.clients[0].name,'Latest');assert.deepEqual(result.meta.queue.map(op=>op.id),['newer']);assert.deepEqual(result.meta.conflicts,[]);
});
test('server resolution adopts the full connected component without splitting atomic operations',()=>{
 const original=state(),local=update(original,s=>{s.clients[0].name='Local';s.appointments[0].price=200;}),first=conflict(Sync.queueChange(device(),original,local,'conflict',stamp),local,original);
 const latest=update(local,s=>s.appointments[0].notes='Latest'),meta=Sync.queueChange(first.meta,local,latest,'followup',stamp);
 const result=Sync.resolve(meta,latest,0,'server','unused',stamp);
 assert.deepEqual(result.state,original);assert.deepEqual(result.meta.queue,[]);assert.deepEqual(result.meta.conflicts,[]);assert.equal(latest.clients[0].name,'Local');
});
test('local resolution replaces a conflicted chain with one fresh CAS from latest server base',()=>{
 const original=state(),local=update(original,s=>s.clients[0].name='Local'),remote=update(original,s=>s.clients[0].name='Remote'),first=conflict(Sync.queueChange(device(),original,local,'conflict',stamp),local,remote),latest=update(local,s=>s.clients[0].name='Latest'),meta=Sync.queueChange(first.meta,local,latest,'followup',stamp);
 const result=Sync.resolve(meta,latest,0,'local','retry',stamp);
 assert.equal(result.meta.conflicts.length,0);assert.equal(result.meta.queue.length,1);assert.equal(result.meta.queue[0].id,'retry');
 assert.equal(result.meta.queue[0].changes[0].before.name,'Remote');assert.equal(result.meta.queue[0].changes[0].after.name,'Latest');assert.equal(result.state.clients[0].name,'Latest');
});
test('concurrent completed corrections rebase onto the server audit prefix with exactly one new event',()=>{
 const original=auditedState(),local=correct(original,180,'2026-10-31T10:01:00.000Z'),server=correct(original,150,'2026-10-31T10:02:00.000Z'),queued=Sync.queueChange(device(original),original,local,'local-correction',stamp),first=conflict(queued,local,server),resolvedAt='2026-10-31T10:03:00.000Z',result=Sync.resolve(first.meta,first.state,0,'local','rebased',resolvedAt),record=result.state.appointments[0];
 assert.equal(record.price,180);assert.equal(record.corrections.length,2);assert.deepEqual(record.corrections[0],server.appointments[0].corrections[0]);
 assert.deepEqual(record.corrections[1],{at:resolvedAt,before:Business.appointmentSnapshot(server.appointments[0]),after:Business.appointmentSnapshot(local.appointments[0]),reason:'Rezolvare conflict de sincronizare'});
 assert.equal(result.meta.queue.length,1);assert.deepEqual(result.meta.queue[0].changes[0].before,server.appointments[0]);assert.deepEqual(result.meta.queue[0].changes[0].after,record);
 assert.doesNotThrow(()=>Business.validateState(result.state));assert.equal(first.state.appointments[0].corrections.length,1);
});
test('offline completion plus multiple corrections collapse to one fresh audit event against a pending server record',()=>{
 const original=auditedState();original.appointments[0].status='confirmed';const completed=update(original,s=>s.appointments[0].status='completed'),firstEdit=correct(completed,180,'2026-10-31T10:01:00.000Z'),latest=correct(firstEdit,210,'2026-10-31T10:02:00.000Z');
 let meta=Sync.queueChange(device(original),original,completed,'complete',stamp);const failed=conflict(meta,completed,original);meta=Sync.queueChange(failed.meta,completed,firstEdit,'first-correction',stamp);meta=Sync.queueChange(meta,firstEdit,latest,'second-correction',stamp);
 const result=Sync.resolve(meta,latest,0,'local','resolved',stamp),record=result.state.appointments[0];
 assert.equal(record.status,'completed');assert.equal(record.price,210);assert.equal(record.corrections.length,1);assert.deepEqual(record.corrections[0].before,Business.appointmentSnapshot(original.appointments[0]));assert.deepEqual(record.corrections[0].after,Business.appointmentSnapshot(latest.appointments[0]));
 assert.deepEqual(result.meta.resolutionArchive[0].operations.map(op=>op.id),['complete','first-correction','second-correction']);assert.equal(result.meta.resolutionArchive[0].operations[2].changes[0].after.corrections.length,2);
 assert.doesNotThrow(()=>Business.validateState(result.state));assert.doesNotThrow(()=>Sync.validateDevice(result.meta));
});
test('equal completed business values adopt the server audit without inventing another correction',()=>{
 const original=auditedState(),local=correct(original,180,'2026-10-31T10:01:00.000Z'),server=correct(original,180,'2026-10-31T10:02:00.000Z');local.appointments[0].updatedAt=server.appointments[0].updatedAt;
 const first=conflict(Sync.queueChange(device(original),original,local,'local',stamp),local,server),result=Sync.resolve(first.meta,first.state,0,'local','unused',stamp);
 assert.deepEqual(result.state.appointments[0].corrections,server.appointments[0].corrections);assert.equal(result.meta.queue.length,0);assert.equal(result.meta.resolutionArchive[0].operations[0].changes[0].after.corrections[0].at,'2026-10-31T10:01:00.000Z');
});
test('case-only color differences retain the authoritative audit with no additional event',()=>{
 const original=auditedState();original.appointments[0].color='#ABCDEF';const local=update(original,s=>s.appointments[0].color='#abcdef'),first=conflict(Sync.queueChange(device(original),original,local,'case',stamp),local,original),result=Sync.resolve(first.meta,first.state,0,'local','case-retry',stamp);
 assert.equal('corrections' in result.state.appointments[0],false);assert.equal(result.state.appointments[0].color,'#abcdef');assert.doesNotThrow(()=>Business.validateState(result.state));
});
test('server resolution archives every discarded proposal while unrelated proposals remain available',()=>{
 const original=auditedState(),local=correct(original,180,'2026-10-31T10:01:00.000Z'),first=conflict(Sync.queueChange(device(original),original,local,'local-correction',stamp),local,original),latest=update(first.state,s=>s.clients[0].name='New client name'),meta=Sync.queueChange(first.meta,first.state,latest,'unrelated',stamp),result=Sync.resolve(meta,latest,0,'server','unused',stamp);
 assert.equal(result.state.appointments[0].price,120);assert.equal(result.state.clients[0].name,'New client name');assert.deepEqual(result.meta.queue.map(op=>op.id),['unrelated']);
 assert.equal(result.meta.resolutionArchive[0].choice,'server');assert.equal(result.meta.resolutionArchive[0].at,stamp);assert.deepEqual(result.meta.resolutionArchive[0].operations,first.meta.conflicts);
 const checked=Sync.validateDevice(result.meta);checked.resolutionArchive[0].operations[0].changes[0].after.price=999;assert.equal(result.meta.resolutionArchive[0].operations[0].changes[0].after.price,180);
});
test('locally created audited appointments with no server predecessor keep their complete original history',()=>{
 const original=auditedState();original.appointments=[];const local=auditedState(),firstEdit=correct(local,180,'2026-10-31T10:01:00.000Z'),meta=Sync.queueChange(device(original),original,firstEdit,'create',stamp),first=conflict(meta,firstEdit,original),result=Sync.resolve(first.meta,first.state,0,'local','create-retry',stamp);
 assert.deepEqual(result.state.appointments[0],firstEdit.appointments[0]);assert.deepEqual(result.meta.queue[0].changes[0].before,null);assert.equal(result.meta.resolutionArchive[0].choice,'local');
});
test('local resolution does not queue a no-op and unrelated conflict components remain untouched',()=>{
 const original=state(),local=update(original,s=>s.clients[0].name='Local');let first=conflict(Sync.queueChange(device(),original,local,'client',stamp),local,original);
 const withService=update(local,s=>s.services[0].price=999);first.meta=Sync.queueChange(first.meta,local,withService,'service',stamp);const serviceOp=Sync.prepare(first.meta);first=conflict(first.meta,withService,original,serviceOp);
 const serverEquivalent=update(withService,s=>s.clients[0].name='Ana'),result=Sync.resolve(first.meta,serverEquivalent,0,'local','noop',stamp);
 assert.equal(result.meta.queue.length,0);assert.deepEqual(result.meta.conflicts.map(op=>op.id),['service']);assert.equal(result.state.services[0].price,999);
});
test('resolution closes over multiple conflicts linked by a later atomic queue operation',()=>{
 const original=state(),client=update(original,s=>s.clients[0].name='Local');let first=conflict(Sync.queueChange(device(),original,client,'client',stamp),client,original);
 const service=update(client,s=>s.services[0].price=200);first.meta=Sync.queueChange(first.meta,client,service,'service',stamp);first=conflict(first.meta,service,original,Sync.prepare(first.meta));
 const bridge=update(service,s=>{s.clients[0].name='Latest';s.services[0].price=300;s.appointments[0].price=300;}),meta=Sync.queueChange(first.meta,service,bridge,'bridge',stamp),result=Sync.resolve(meta,bridge,0,'local','resolved',stamp);
 assert.equal(result.meta.conflicts.length,0);assert.deepEqual(result.meta.queue.map(op=>op.id),['resolved']);assert.deepEqual(result.meta.queue[0].changes.map(c=>c.key),['appointments/a1','clients/c1','services/s1']);assert.deepEqual(result.state,bridge);
});
test('successful bootstrap clears recovery payload only after acknowledged same-workspace initialization',()=>{
 const original=state(),meta=device();meta.bootstrap={id:'bootstrap-stable',state:copy(original)};meta.name='Tableta salonului';meta.joinRecoveryNeeded=true;
 const latest=update(original,s=>s.clients[0].name='During request'),queued=Sync.queueChange(meta,original,latest,'edit',stamp),result=Sync.applyResponse(queued,latest,[],reply(original,[]),stamp);
 assert.equal('bootstrap' in result.meta,false);assert.equal(result.meta.name,'Tableta salonului');assert.equal(result.meta.joinRecoveryNeeded,true);assert.equal(result.state.clients[0].name,'During request');
 assert.throws(()=>Sync.applyResponse(queued,latest,[],{...reply(original,[]),workspaceId:'foreign'},stamp));assert.equal(queued.bootstrap.id,'bootstrap-stable');
});
test('upgrading a frozen legacy bootstrap preserves the exact retry payload and collection order',()=>{
 const original=state();delete original.expenses;delete original.suppliers;original.clients.unshift({id:'c2',name:'Înainte de c1'});
 const meta=device(original);meta.bootstrap={id:'lost-legacy-bootstrap-response',state:copy(original)};const frozen=JSON.stringify(meta.bootstrap),checked=Sync.validateDevice(JSON.parse(JSON.stringify(meta)));
 assert.equal(JSON.stringify(checked.bootstrap),frozen);assert.equal('suppliers' in checked.bootstrap.state,false);assert.equal('expenses' in checked.bootstrap.state,false);assert.equal(checked.bootstrap.state.clients[0].id,'c2');
 const next=update(original,s=>s.clients.find(c=>c.id==='c1').name='Editare în așteptare'),queued=Sync.queueChange(checked,original,next,'new-local-edit',stamp);
 assert.equal(JSON.stringify(queued.bootstrap),frozen);assert.equal(queued.queue.length,1);checked.bootstrap.state.clients[0].name='Changed copy';assert.equal(meta.bootstrap.state.clients[0].name,'Înainte de c1');
 assert.throws(()=>Sync.validateDevice({...meta,bootstrap:{id:meta.bootstrap.id,state:{...original,clients:null}}}));
});
test('first successful handshake may bind an empty workspace ID and records the supplied sync timestamp',()=>{
 const original=state(),meta=device();meta.workspaceId='';const result=Sync.applyResponse(meta,original,[],reply(original,[]),stamp);
 assert.equal(result.meta.workspaceId,'salon');assert.equal(result.meta.lastSync,stamp);assert.equal(result.meta.joined,true);
});
test('metadata validation keeps credentials separate and retains bootstrap and JSON-safe recovery flags',()=>{
 const meta=device();meta.token='secret';meta.remoteUrl='https://salon.example';meta.bootstrap={id:'initial',state:state()};meta.recovery={requested:true};
 const checked=Sync.validateDevice(meta);checked.bootstrap.state.clients[0].name='Changed';assert.equal(meta.bootstrap.state.clients[0].name,'Ana');assert.deepEqual(checked.recovery,{requested:true});assert.equal(checked.token,'secret');assert.equal('token' in Sync.flatten(state()),false);
 for(const mutate of [m=>m.enabled='yes',m=>m.role='admin',m=>m.base={},m=>m.queue=[{id:'x'}],m=>m.serverRevision=-1,m=>m.bootstrap={id:'x',state:null},m=>m.recovery=()=>{}]){const bad=copy(meta);mutate(bad);assert.throws(()=>Sync.validateDevice(bad));}
});
test('permanent disconnect can archive pending operations in standalone device metadata',()=>{
 const original=state(),local=update(original,s=>s.clients[0].name='Pending'),queued=Sync.queueChange(device(),original,local,'pending',stamp),fresh={...Sync.createDevice('standalone'),role:'master',resolutionArchive:[{at:stamp,choice:'disconnect',operations:queued.queue}]};
 const checked=Sync.validateDevice(fresh);assert.equal(checked.joined,false);assert.deepEqual(checked.queue,[]);assert.equal(checked.resolutionArchive[0].choice,'disconnect');assert.deepEqual(checked.resolutionArchive[0].operations,queued.queue);
 checked.resolutionArchive[0].operations[0].changes[0].after.name='Changed copy';assert.equal(fresh.resolutionArchive[0].operations[0].changes[0].after.name,'Pending');
});
test('supplier recovery records survive disconnect archives while malformed catalog metadata is rejected',()=>{
 const original=suppliedState(),local=update(original,s=>s.expenses[0].amount=75),queued=Sync.queueChange(device(original),original,local,'pending-expense',stamp),archive={at:stamp,choice:'disconnect',operations:queued.queue,retainedRecords:{'suppliers/v1':original.suppliers[0]}},fresh={...Sync.createDevice('standalone'),resolutionArchive:[archive]},checked=Sync.validateDevice(fresh);
 assert.deepEqual(checked.resolutionArchive[0].retainedRecords,archive.retainedRecords);
 for(const recordMap of [{'suppliers/':{id:'',name:'Bad'}},{'suppliers/v1':{id:'wrong',name:'Bad'}},{'suppliers/v1':null},{'services/s1':{id:'s1',name:'Bad'}}])assert.throws(()=>Sync.validateDevice({...fresh,resolutionArchive:[{...archive,retainedRecords:recordMap}]}));
 assert.throws(()=>Sync.validateDevice({...queued,retainedDependencies:{'pending-expense':['suppliers/']}}));assert.throws(()=>Sync.validateDevice({...queued,retainedDependencies:{missing:['suppliers/v1']}}));
 const duplicate=copy(original);duplicate.suppliers.push(copy(duplicate.suppliers[0]));assert.throws(()=>Sync.flatten(duplicate));assert.throws(()=>Sync.flatten({...original,suppliers:null}));
});
test('server URLs allow secure roots and private LAN or Tailscale roots while rejecting unsafe destinations',()=>{
 for(const url of ['https://public.example','https://public.example:8443/','http://192.168.1.2:8787','http://10.2.3.4','http://172.16.0.1','http://localhost:8787','http://salon.local','http://localhost.','http://100.64.0.1','http://100.127.255.254','http://salon.tailnet.ts.net','http://[::1]:8787','http://[fd12:3456::1]'])assert.equal(Sync.validServerUrl(url),true,url);
 for(const url of ['http://8.8.8.8','http://public.example','http://homeassistant','http://salon.lan','http://0.0.0.0','http://127.1','http://0177.0.0.1','http://192.168.1.2:0','http://100.128.0.1','http://172.32.0.1','ftp://192.168.1.2','https://user:password@public.example','https://@public.example','https://public.example/path','https://public.example/?','https://public.example/#',' https://public.example','https:public.example','https://public.example\\',null])assert.equal(Sync.validServerUrl(url),false,String(url));
});
test('invalid or ambiguous CAS operations cannot enter persisted device metadata',()=>{
 const original=state(),next=update(original,s=>s.clients[0].name='New'),valid=Sync.queueChange(device(),original,next,'op',stamp);
 for(const mutate of [m=>m.queue[0].changes[0].key='unknown/x',m=>m.queue[0].changes.push(copy(m.queue[0].changes[0])),m=>m.queue[0].changes[0].after.id='different',m=>m.queue[0].changes[0].after=copy(m.queue[0].changes[0].before),m=>m.queue.push(copy(m.queue[0]))]){
  const bad=copy(valid);mutate(bad);assert.throws(()=>Sync.validateDevice(bad));
 }
 const invalidSettings=copy(valid);invalidSettings.queue[0].changes=[{key:'settings',before:original.settings,after:null}];assert.throws(()=>Sync.validateDevice(invalidSettings));
});
test('malformed, partial, foreign or regressing responses throw without mutating any local input',()=>{
 const original=state(),local=update(original,s=>s.clients[0].name='Local'),meta=Sync.queueChange(device(),original,local,'op',stamp),sent=Sync.prepare(meta),baseline=copy(meta);
 const mutations=[r=>r.protocol=2,r=>r.initialized=false,r=>r.workspaceId='other',r=>r.serverRevision=0,r=>r.results=[],r=>r.results[0].id='other',r=>r.results[0].status='unknown',r=>r.results[0].keys=['clients/foreign'],r=>r.state.clients[0].id=7,r=>r.results.push(copy(r.results[0]))];
 for(const mutate of mutations){const response=reply(local,sent);mutate(response);assert.throws(()=>Sync.applyResponse(meta,local,sent,response,stamp));assert.deepEqual(meta,baseline);assert.equal(local.clients[0].name,'Local');}
});
test('malformed record maps and duplicate IDs are rejected rather than silently overwriting records',()=>{
 assert.throws(()=>Sync.inflate({settings:{},meta:{demo:false},'clients/c1':{id:'different'}}));assert.throws(()=>Sync.inflate({settings:{},meta:{demo:false},'unknown/x':{id:'x'}}));
 const duplicate=state();duplicate.clients.push(copy(duplicate.clients[0]));assert.throws(()=>Sync.flatten(duplicate));
});
test('prepare respects the 50-operation batch limit and returns independent operations',()=>{
 let current=state(),meta=device();for(let i=0;i<55;i++){const next=update(current,s=>s.clients[0].name='Client '+i);meta=Sync.queueChange(meta,current,next,'op'+i,stamp);current=next;}
 const sent=Sync.prepare(meta);assert.equal(sent.length,50);assert.equal(sent[0].id,'op0');sent[0].changes[0].after.name='Tampered';assert.equal(meta.queue[0].changes[0].after.name,'Client 0');assert.throws(()=>Sync.prepare(meta,51));
});
