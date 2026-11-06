'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Catalog=require('../app/src/main/assets/catalog.js');
const modulePath=require.resolve('../app/src/main/assets/catalog.js');
const at='2026-11-01T10:20:30.123Z';
const previousAt='2026-10-01T08:00:00.000Z';
const copy=value=>JSON.parse(JSON.stringify(value));

function fixture(){
 const services=[
  {id:'other',name:'Alt serviciu',category:'Categorie B',price:999,color:'#112233',active:true},
  {id:'target',name:'Serviciu inițial',category:'Categorie A',price:120,color:'#445566',active:true,duration:120},
  {id:'same-name',name:'Serviciu inițial',category:'Categorie A',price:120,color:'#778899',active:false}
 ];
 const make=(id,status,date)=>({
  id,clientId:'client',date,start:'16:30',duration:75,price:150,status,notes:'Notiță păstrată',color:'#ABCdef',
  services:[
   {serviceId:'target',name:'Serviciu inițial',duration:45,price:120,color:'#123aBC',legacy:{kept:true}},
   {serviceId:'other',name:'Alt nume istoric',duration:30,price:30,color:'#bC12aF'}
  ],createdAt:'2025-01-01T12:34:56.789Z',updatedAt:previousAt
 });
 const history=[{at:previousAt,before:{name:'Înainte',price:10,services:[{serviceId:'target',name:'Audit vechi',price:1,color:'#ABCDEF'}]},after:{name:'După',price:15},reason:'Istoric păstrat exact'}];
 return {
  version:1,demo:false,settings:{workspace:{accent:'#79536e',salonName:'Salon păstrat'}},
  clients:[{id:'client',name:'Client păstrat',phone:'',archived:false}],services,
  appointments:[
   make('past','pending','2024-01-01'),make('present','confirmed','2026-11-01'),make('future','pending','2029-12-31'),
   {...make('completed','completed','2026-11-02'),corrections:copy(history)},
   {...make('cancelled','cancelled','2028-01-01'),corrections:copy(history)},
   {...make('no-show','no-show','2026-11-01'),corrections:copy(history)}
  ],suppliers:[{id:'supplier',name:'Furnizor'}],expenses:[{id:'expense',amount:25.5,date:'2026-11-01'}]
 };
}
function valueFor(state,changes={}){
 const service=state.services.find(item=>item.id==='target');
 return {id:service.id,name:service.name,category:service.category,price:service.price,color:service.color,active:service.active,...changes};
}
function update(state,changes={},timestamp=at){return Catalog.updateService(state,'target',valueFor(state,changes),timestamp);}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

test('the standalone browser and CommonJS API expose the same frozen service updater',()=>{
 assert.strictEqual(global.SalonCatalog,Catalog);assert(Object.isFrozen(Catalog));
 assert.equal(Catalog.MANUAL_PRICE_REASON,'Preț stabilit manual în programare');
 assert.equal(Catalog.CATALOG_UPDATE_REASON,'Actualizare denumire/preț din catalogul de servicii');
 assert.equal(typeof Catalog.isManualPrice,'function');assert.equal(typeof Catalog.selectedPrice,'function');
 const sandbox={};vm.runInNewContext(fs.readFileSync(modulePath,'utf8'),sandbox);
 assert.equal(typeof sandbox.SalonCatalog.updateService,'function');
 const state=fixture(),result=sandbox.SalonCatalog.updateService(state,'target',valueFor(state,{name:'Nou'}),at);
 assert.equal(result.state.appointments[0].services[0].name,'Nou');
});

test('name and price edits propagate to every pending and confirmed booking without a date cutoff',()=>{
 const state=fixture(),result=update(state,{name:'Serviciu actualizat',price:150});
 assert.deepEqual(result.appointmentIds,['past','present','future']);
 for(const appointment of result.state.appointments.slice(0,3)){
  assert.equal(appointment.services[0].name,'Serviciu actualizat');assert.equal(appointment.services[0].price,150);
  assert.equal(appointment.price,180);assert.equal(appointment.updatedAt,at);
 }
});

test('completed, cancelled, no-show and unknown statuses remain byte-for-byte unchanged with their audits',()=>{
 const state=fixture();state.appointments.push({...copy(state.appointments[0]),id:'unknown',status:'unknown'});
 const before=state.appointments.slice(3).map(item=>JSON.stringify(item)),result=update(state,{name:'Nou',price:140});
 assert.deepEqual(result.state.appointments.slice(3).map(item=>JSON.stringify(item)),before);
 for(let index=3;index<state.appointments.length;index++)assert.notStrictEqual(result.state.appointments[index],state.appointments[index]);
});

test('only the exact service ID is matched even when another service has the same name',()=>{
 const state=fixture();
 state.appointments[0].services=[{serviceId:'same-name',name:'Serviciu inițial',price:120,color:'#778899'}];
 const before=JSON.stringify(state.appointments[0]),result=update(state,{name:'Nou',price:140});
 assert.equal(JSON.stringify(result.state.appointments[0]),before);
 assert.deepEqual(result.appointmentIds,['present','future']);
 assert.equal(result.state.services[2].name,'Serviciu inițial');assert.equal(result.state.services[2].price,120);
});

test('a name-only edit preserves both manual and ordinary appointment totals and every component price',()=>{
 const state=fixture();state.appointments[0].price=100;state.appointments[1].price=150;
 state.appointments[0].services[0].price=80;
 const result=update(state,{name:'Denumire nouă'});
 assert.equal(result.state.appointments[0].price,100);assert.equal(result.state.appointments[1].price,150);
 assert.equal(result.state.appointments[0].services[0].price,80);
 assert.equal(result.state.appointments[1].services[0].price,120);
});

test('a price-only edit leaves stale snapshot names and other service snapshots untouched',()=>{
 const state=fixture();state.appointments[0].services[0].name='Nume istoric diferit';
 const others=state.appointments.slice(0,3).map(item=>JSON.stringify(item.services[1]));
 const result=update(state,{price:140});
 assert.equal(result.state.appointments[0].services[0].name,'Nume istoric diferit');
 for(let index=0;index<3;index++){
  assert.equal(JSON.stringify(result.state.appointments[index].services[1]),others[index]);
  assert.equal(result.state.appointments[index].price,170,'sum uses saved 30 lei, not current catalog 999 lei');
 }
});

test('editing the catalog price preserves a manual total even when the selected snapshot already has the new price',()=>{
 const state=fixture();state.appointments[0].services[0].price=150;
 const before=JSON.stringify(state.appointments[0]);
 const result=update(state,{price:150});
 assert.equal(JSON.stringify(result.state.appointments[0]),before);
 assert.deepEqual(result.appointmentIds,['present','future']);
});

test('an already-updated snapshot and total receive no metadata change or affected ID',()=>{
 const state=fixture();Object.assign(state.appointments[0].services[0],{name:'Nou',price:150});state.appointments[0].price=180;
 const before=JSON.stringify(state.appointments[0]),result=update(state,{name:'Nou',price:150});
 assert.equal(JSON.stringify(result.state.appointments[0]),before);
 assert.deepEqual(result.appointmentIds,['present','future']);
});

test('duplicate matching selected components all update while their booking is returned only once',()=>{
 const state=fixture();state.appointments=state.appointments.slice(0,1);
 state.appointments[0].services.splice(1,0,{serviceId:'target',name:'Alt nume vechi',price:120,duration:20,color:'#654321'});
 state.appointments[0].price=270;
 const result=update(state,{name:'Nou',price:150}),appointment=result.state.appointments[0];
 assert.deepEqual(result.appointmentIds,['past']);assert.equal(appointment.price,330);
 assert.equal(appointment.services[0].price,150);assert.equal(appointment.services[1].price,150);
 assert.equal(appointment.services[0].name,'Nou');assert.equal(appointment.services[1].name,'Nou');
 assert.equal(appointment.services[1].duration,20);assert.equal(appointment.services[1].color,'#654321');
});

test('zero service prices and a zero recomputed total are valid and do not use fallback values',()=>{
 const state=fixture();state.appointments=state.appointments.slice(0,1);state.appointments[0].services=state.appointments[0].services.slice(0,1);
 state.appointments[0].price=120;
 const result=update(state,{price:0});
 assert.equal(result.state.services[1].price,0);assert.equal(result.state.appointments[0].services[0].price,0);
 assert.equal(result.state.appointments[0].price,0);assert.deepEqual(result.appointmentIds,['past']);
});

test('appointment totals round each saved component to cents before summing decimal values',()=>{
 const state=fixture();state.appointments=state.appointments.slice(0,1);state.appointments[0].services[1].price=10.075;
 state.appointments[0].price=130.08;
 const result=update(state,{price:1.005});
 assert.equal(result.state.appointments[0].services[0].price,1.005);
 assert.equal(result.state.appointments[0].services[1].price,10.075);
 assert.equal(result.state.appointments[0].price,11.09);
 const tiny=fixture();tiny.appointments=tiny.appointments.slice(0,1);tiny.appointments[0].services[1].price=0.005;
 tiny.appointments[0].price=120.01;
 assert.equal(update(tiny,{price:0.005}).state.appointments[0].price,0.02);
});

test('catalog edits preserve original order, IDs, optional legacy duration and unrelated catalog fields',()=>{
 const state=fixture();state.services[1].metadata={original:true};
 const result=Catalog.updateService(state,'target',{...valueFor(state,{name:'Nou',price:140}),duration:5,metadata:{original:false}},at);
 assert.deepEqual(result.state.services.map(item=>item.id),['other','target','same-name']);
 assert.equal(result.state.services[1].duration,120);assert.deepEqual(result.state.services[1].metadata,{original:true});
 assert.deepEqual(result.state.services[0],state.services[0]);assert.deepEqual(result.state.services[2],state.services[2]);
});

test('category, color or active-only edits update the catalog without refreshing any existing appointment',()=>{
 for(const changes of [{category:'Nouă categorie'},{color:'#AABBCC'},{active:false},{category:'Nou',color:'#AABBCC',active:false}]){
  const state=fixture();state.appointments[0].services[0].name='Stale';state.appointments[0].services[0].price=80;
  const before=JSON.stringify(state.appointments),result=update(state,changes);
  assert.equal(JSON.stringify(result.state.appointments),before);assert.deepEqual(result.appointmentIds,[]);
  for(const [key,value]of Object.entries(changes))assert.equal(result.state.services[1][key],value);
 }
});

test('unchanged catalog name and price never refresh a stale snapshot or reset its manual total',()=>{
 const state=fixture();state.appointments[0].services[0].name='Stale';state.appointments[0].services[0].price=80;
 const result=update(state);
 assert.deepEqual(result.state,state);assert.deepEqual(result.appointmentIds,[]);
 assert.notStrictEqual(result.state,state);assert.notStrictEqual(result.state.appointments[0].services[0],state.appointments[0].services[0]);
});

test('only selected snapshot name/price, appointment total and updatedAt may change; reopened audits stay intact',()=>{
 const state=fixture();state.appointments[0].corrections=copy(state.appointments[3].corrections);
 const before=copy(state),result=update(state,{name:'Nou',price:140,category:'Nou',color:'#998877',active:false});
 for(let index=0;index<3;index++){
  const actual=copy(result.state.appointments[index]),expected=copy(before.appointments[index]);
  actual.services[0].name=expected.services[0].name;actual.services[0].price=expected.services[0].price;
  actual.price=expected.price;actual.updatedAt=expected.updatedAt;
  assert.deepEqual(actual,expected);
 }
 assert.equal(JSON.stringify(result.state.appointments[0].corrections),JSON.stringify(before.appointments[0].corrections));
 assert.deepEqual(result.state.settings,before.settings);assert.deepEqual(result.state.clients,before.clients);
 assert.deepEqual(result.state.expenses,before.expenses);assert.deepEqual(result.state.suppliers,before.suppliers);
});

test('frozen input stays unchanged and the complete returned state is detached deeply',()=>{
 const state=fixture(),before=JSON.stringify(state);freeze(state);
 const result=update(state,{name:'Nou',price:140});assert.equal(JSON.stringify(state),before);
 result.state.settings.workspace.accent='#FFFFFF';result.state.appointments[3].corrections[0].before.services[0].name='Mutat';
 result.state.clients[0].name='Alt client';result.state.services[0].name='Alt serviciu';
 assert.equal(JSON.stringify(state),before);
});

test('the ISO timestamp is required only when an active appointment actually changes',()=>{
 for(const invalid of [undefined,null,'','2026-11-01','2026-11-01T10:20:30Z','2026-02-30T10:20:30.123Z',at.slice(0,-1)+'+00:00']){
  const state=fixture();assert.throws(()=>Catalog.updateService(state,'target',valueFor(state,{name:'Nou'}),invalid),/Actualizarea/);
  assert.doesNotThrow(()=>Catalog.updateService(state,'target',valueFor(state,{category:'Nou'}),invalid));
 }
 const state=fixture();state.appointments=state.appointments.slice(3);
 assert.doesNotThrow(()=>Catalog.updateService(state,'target',valueFor(state,{name:'Nou',price:140}),undefined));
});

test('invalid service identity, fields, prices or state shapes fail without changing input',()=>{
 const state=fixture(),before=JSON.stringify(state);
 for(const changes of [{id:'another'},{name:''},{name:'   '},{name:'x'.repeat(151)},{name:null},{category:null},{category:'x'.repeat(101)},{color:'#fff'},{color:'red'},{active:1},{price:-1},{price:1000000.01},{price:NaN},{price:Infinity},{price:'120'},{price:null}]){
  assert.throws(()=>Catalog.updateService(state,'target',valueFor(state,changes),at));assert.equal(JSON.stringify(state),before);
 }
 for(const invalid of [null,undefined,[],{},'state',{services:[],appointments:null},{services:null,appointments:[]}])assert.throws(()=>Catalog.updateService(invalid,'target',valueFor(state),at));
 for(const id of ['',null,undefined,'missing','x'.repeat(101)])assert.throws(()=>Catalog.updateService(state,id,{...valueFor(state),id},at));
 const duplicate=fixture();duplicate.services.push(copy(duplicate.services[1]));assert.throws(()=>update(duplicate,{name:'Nou'}),/disponibil/);
 assert.equal(JSON.stringify(state),before);
});

test('overflow in a later affected appointment aborts the entire operation without a partial catalog or booking save',()=>{
 const state=fixture();state.appointments[0].services=state.appointments[0].services.slice(0,1);state.appointments[0].price=120;
 state.appointments[1].services[1].price=0.01;state.appointments[1].price=120.01;
 const before=JSON.stringify(state);
 assert.throws(()=>update(state,{name:'Nou',price:1000000}),/Totalul/);
 assert.equal(JSON.stringify(state),before);
 const exact=fixture();exact.appointments=exact.appointments.slice(0,1);exact.appointments[0].services[1].price=0;exact.appointments[0].price=120;
 assert.equal(update(exact,{price:1000000}).state.appointments[0].price,1000000);
 exact.appointments[0].services[1].price=0.005;exact.appointments[0].price=120.01;assert.throws(()=>update(exact,{price:1000000}),/Totalul/);
});

test('invalid saved component prices abort repricing atomically, while name-only edits preserve their totals',()=>{
 for(const invalid of [NaN,Infinity,undefined,'30',-1,1000001]){
  const state=fixture();state.appointments[0].services[1].price=invalid;
  assert.throws(()=>update(state,{price:140}),/Prețul/);
  assert.equal(state.services[1].price,120);assert.equal(state.appointments[0].services[0].price,120);
  assert.equal(update(state,{name:'Nou'}).state.appointments[0].price,150);
 }
});

test('manual total and every saved component price survive catalog repricing while names still update',()=>{
 const state=fixture();state.appointments[0].price=100;
 const result=update(state,{name:'Denumire nouă',price:140}),manual=result.state.appointments[0];
 assert.equal(Catalog.isManualPrice(state.appointments[0]),true);
 assert.equal(manual.price,100);assert.equal(manual.services[0].price,120);assert.equal(manual.services[1].price,30);
 assert.equal(manual.services[0].name,'Denumire nouă');assert.equal(manual.updatedAt,at);
 assert.equal(result.state.appointments[1].price,170);assert.equal(result.state.appointments[1].services[0].price,140);
 assert.deepEqual(result.appointmentIds,['past','present','future']);
});

test('a price-only edit never touches a manual booking or its metadata',()=>{
 const state=fixture();state.appointments[0].price=100;
 const before=JSON.stringify(state.appointments[0]),result=update(state,{price:140});
 assert.equal(JSON.stringify(result.state.appointments[0]),before);
 assert.deepEqual(result.appointmentIds,['present','future']);
});

test('inferred manual protection survives repeated edits including a catalog price equal to the custom total',()=>{
 const state=fixture();state.appointments=state.appointments.slice(0,1);state.appointments[0].services=state.appointments[0].services.slice(0,1);state.appointments[0].price=100;
 const before=JSON.stringify(state.appointments[0]);
 const first=update(state,{price:100}),second=update(first.state,{price:200}),third=update(second.state,{price:0});
 for(const result of [first,second,third]){
  assert.equal(JSON.stringify(result.state.appointments[0]),before);
  assert.deepEqual(result.appointmentIds,[]);assert.equal(Catalog.isManualPrice(result.state.appointments[0]),true);
 }
});

test('an exact manual-price correction marker protects a total that equals its component sum',()=>{
 const state=fixture(),appointment=state.appointments[0];
 appointment.corrections=[{at:previousAt,before:{price:100},after:{price:150},reason:Catalog.MANUAL_PRICE_REASON}];
 assert.equal(Catalog.isManualPrice(appointment),true);
 const before=JSON.stringify(appointment),first=update(state,{price:140}),second=update(first.state,{price:160});
 assert.equal(JSON.stringify(first.state.appointments[0]),before);assert.equal(JSON.stringify(second.state.appointments[0]),before);
 assert.equal(first.state.appointments[1].price,170);assert.equal(second.state.appointments[1].price,190);
});

test('manual marker reasons with the exact audit separator remain durable through later history entries',()=>{
 const state=fixture(),appointment=state.appointments[0];
 appointment.corrections=[
  {at:previousAt,before:{price:100},after:{price:150},reason:Catalog.MANUAL_PRICE_REASON+' · Corecție cerută'},
  {at,before:{price:150},after:{price:150},reason:'Altă schimbare de nume'}
 ];
 assert.equal(Catalog.isManualPrice(appointment),true);
 const before=JSON.stringify(appointment.corrections),result=update(state,{name:'Nou',price:140});
 assert.equal(result.state.appointments[0].price,150);assert.equal(result.state.appointments[0].services[0].price,120);
 assert.equal(result.state.appointments[0].services[0].name,'Nou');assert.equal(JSON.stringify(result.state.appointments[0].corrections),before);
});

test('a zero manual total remains protected even when its saved component sum is also zero',()=>{
 const state=fixture(),appointment=state.appointments[0];
 appointment.price=0;appointment.services.forEach(service=>{service.price=0;});
 appointment.corrections=[{at:previousAt,before:{price:120},after:{price:0},reason:Catalog.MANUAL_PRICE_REASON}];
 assert.equal(Catalog.isManualPrice(appointment),true);
 const result=update(state,{price:140});
 assert.equal(result.state.appointments[0].price,0);assert.equal(result.state.appointments[0].services[0].price,0);assert.equal(result.state.appointments[0].services[1].price,0);
 assert.equal(result.state.appointments[0].updatedAt,previousAt);
});

test('a reason marker without an actual cent change or complete price snapshots does not imply a manual price',()=>{
 for(const entry of [
  {before:{price:150},after:{price:150},reason:Catalog.MANUAL_PRICE_REASON},
  {before:{price:0.001},after:{price:0.002},reason:Catalog.MANUAL_PRICE_REASON},
  {reason:Catalog.MANUAL_PRICE_REASON}
 ]){
  const state=fixture();state.appointments[0].corrections=[entry];
  assert.equal(Catalog.isManualPrice(state.appointments[0]),false);
  assert.equal(update(state,{price:140}).state.appointments[0].price,170);
 }
});

test('legacy audited price changes protect manual values even without a recognized reason or current mismatch',()=>{
 for(const reason of [undefined,'Motiv vechi personalizat','',Catalog.MANUAL_PRICE_REASON+' alt text']){
  const state=fixture(),appointment=state.appointments[0];
  appointment.corrections=[{at:previousAt,before:{price:100},after:{price:150},...(reason===undefined?{}:{reason})}];
  assert.equal(Catalog.isManualPrice(appointment),true);
  const before=JSON.stringify(appointment),result=update(state,{price:140});
  assert.equal(JSON.stringify(result.state.appointments[0]),before);
  assert.equal(result.state.appointments[1].price,170);
 }
});

test('known automatic catalog price audits alone do not protect an otherwise automatic booking',()=>{
 const state=fixture(),appointment=state.appointments[0];
 appointment.corrections=[{at:previousAt,before:{price:100},after:{price:150},reason:Catalog.CATALOG_UPDATE_REASON}];
 assert.equal(Catalog.isManualPrice(appointment),false);
 const result=update(state,{price:140});
 assert.equal(result.state.appointments[0].price,170);assert.equal(result.state.appointments[0].services[0].price,140);
 assert.equal(JSON.stringify(result.state.appointments[0].corrections),JSON.stringify(appointment.corrections));
});

test('a manual legacy change remains protected when later history includes automatic catalog changes',()=>{
 const state=fixture(),appointment=state.appointments[0];
 appointment.corrections=[
  {at:previousAt,before:{price:100},after:{price:120},reason:'Preț ajustat anterior'},
  {at,before:{price:120},after:{price:150},reason:Catalog.CATALOG_UPDATE_REASON}
 ];
 assert.equal(Catalog.isManualPrice(appointment),true);
 const result=update(state,{price:140});
 assert.equal(result.state.appointments[0].price,150);assert.equal(result.state.appointments[0].services[0].price,120);
});

test('name-only and other unchanged-price legacy audits keep an ordinary booking eligible for catalog repricing',()=>{
 const state=fixture(),appointment=state.appointments[0];
 appointment.corrections=[{at:previousAt,before:{name:'Vechi',price:150},after:{name:'Nou',price:150},reason:'Redenumire veche'}];
 assert.equal(Catalog.isManualPrice(appointment),false);
 assert.equal(update(state,{price:140}).state.appointments[0].price,170);
});

test('manual inference permits a saved component sum above the total limit without changing the custom total',()=>{
 const state=fixture();state.appointments=state.appointments.slice(0,1);
 state.appointments[0].services[1].price=1000000;state.appointments[0].price=50;
 assert.equal(Catalog.isManualPrice(state.appointments[0]),true);
 assert.throws(()=>Catalog.selectedPrice(state.appointments[0].services),/Totalul/);
 const before=JSON.stringify(state.appointments[0]),result=update(state,{price:999});
 assert.equal(JSON.stringify(result.state.appointments[0]),before);assert.deepEqual(result.appointmentIds,[]);
});

test('selectedPrice shares exact per-component cents and rejects unsafe or over-limit automatic totals',()=>{
 assert.equal(Catalog.selectedPrice([{price:1.005},{price:10.075}]),11.09);
 assert.equal(Catalog.selectedPrice([{price:0},{price:0}]),0);
 assert.equal(Catalog.selectedPrice([{price:1000000}]),1000000);
 assert.throws(()=>Catalog.selectedPrice([{price:1000000},{price:0.005}]),/Totalul/);
 assert.throws(()=>Catalog.selectedPrice([{price:NaN}]),/Prețul/);
 assert.throws(()=>Catalog.selectedPrice(null),/Serviciile/);
});
