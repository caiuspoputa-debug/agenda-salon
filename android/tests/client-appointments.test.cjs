const test=require('node:test'),assert=require('node:assert/strict');
require('../app/src/main/assets/app.js');
const Core=global.SalonCore,copy=x=>JSON.parse(JSON.stringify(x)),today='2026-10-31';
function appointment(id,date,start='10:00',status='confirmed',clientId='c1'){return {id,clientId,date,start,duration:60,price:100,status,notes:'',services:[{serviceId:'s1',name:'Serviciu istoric',price:100,color:'#79536e'}],createdAt:'2026-01-01T08:00:00.000Z',updatedAt:'2026-01-01T08:00:00.000Z'};}
function state(appointments){return {clients:[{id:'c1',name:'Alex',archived:false},{id:'c2',name:'Alex',archived:true}],appointments};}
const ids=records=>records.map(a=>a.id);

test('today and appointments many months or years ahead appear before newest-first history',()=>{
 const s=state([appointment('year-2030','2030-01-02'),appointment('old','2024-02-29'),appointment('tomorrow','2026-11-01'),appointment('today','2026-10-31'),appointment('months','2027-06-15'),appointment('yesterday','2026-10-30')]),result=Core.appointmentsForClient(s,'c1',today);
 assert.deepEqual(ids(result.upcoming),['today','tomorrow','months','year-2030']);assert.deepEqual(ids(result.past),['yesterday','old']);assert.deepEqual(ids(result.all),['today','tomorrow','months','year-2030','yesterday','old']);
});
test('ascending order uses date then start then exact ID and past reverses the full ordering',()=>{
 const s=state([appointment('z','2026-10-31','10:00'),appointment('early','2026-10-31','09:00'),appointment('a','2026-10-31','10:00'),appointment('past-a','2026-10-30','11:00'),appointment('past-z','2026-10-30','11:00'),appointment('past-earlier','2026-10-30','09:00')]),result=Core.appointmentsForClient(s,'c1',today);
 assert.deepEqual(ids(result.upcoming),['early','a','z']);assert.deepEqual(ids(result.past),['past-z','past-a','past-earlier']);
});
test('exact client ID separates equal names and includes archived clients when requested',()=>{
 const own=appointment('own','2026-11-01'),other=appointment('other','2026-11-02','10:00','completed','c2'),s=state([other,own]);
 assert.deepEqual(ids(Core.appointmentsForClient(s,'c1',today).all),['own']);assert.deepEqual(ids(Core.appointmentsForClient(s,'c2',today).all),['other']);assert.deepEqual(Core.appointmentsForClient(s,'missing',today),{upcoming:[],past:[],all:[],active:[],lastClosed:null});
});
test('all statuses, including cancellation and completed records dated today, remain visible',()=>{
 const statuses=['pending','confirmed','completed','cancelled','no-show'],s=state(statuses.flatMap((status,index)=>[appointment(status+'-future','2027-01-01','10:00',status),appointment(status+'-past','2025-01-01','10:00',status),appointment(status+'-today','2026-10-31','00:00',status)])),result=Core.appointmentsForClient(s,'c1',today);
 assert.equal(result.upcoming.length,10);assert.equal(result.past.length,5);assert.equal(result.all.length,15);for(const status of statuses)assert(result.upcoming.some(a=>a.id===status+'-today'));
});
test('the cutoff is an explicit local calendar date and never the runtime clock or current minute',()=>{
 const s=state([appointment('end-year','2026-12-31','23:00'),appointment('new-year','2027-01-01','00:00'),appointment('old','2026-01-01','10:00')]);
 assert.deepEqual(ids(Core.appointmentsForClient(s,'c1','2026-12-31').upcoming),['end-year','new-year']);assert.deepEqual(ids(Core.appointmentsForClient(s,'c1','2027-01-01').upcoming),['new-year']);assert.deepEqual(ids(Core.appointmentsForClient(s,'c1','2030-01-01').past),['new-year','end-year','old']);
});
test('result arrays are new while original records, audit snapshots and input order stay untouched',()=>{
 const completed=appointment('audited','2026-10-29','09:17','completed');completed.services[0].duration=60;completed.color='#AA12CD';const corrected=Core.recordAppointmentCorrection(completed,{...completed,price:150,notes:'Corecție păstrată'},'2026-10-30T08:00:00.000Z','Istoric');
 const upcoming=appointment('future','2027-02-28'),s=state([corrected,upcoming]),before=copy(s),result=Core.appointmentsForClient(s,'c1',today);
 assert.deepEqual(s,before);assert.notStrictEqual(result.all,s.appointments);assert.notStrictEqual(result.upcoming,result.all);assert.notStrictEqual(result.past,result.all);assert.strictEqual(result.upcoming[0],upcoming);assert.strictEqual(result.past[0],corrected);assert.strictEqual(result.all[1].corrections,corrected.corrections);result.all.reverse();result.upcoming.pop();assert.deepEqual(s,before);assert.equal(result.past.length,1);
});
test('empty data returns independent empty arrays and invalid selection arguments fail clearly',()=>{
 const empty=Core.appointmentsForClient(state([]),'c1',today);assert.deepEqual(empty,{upcoming:[],past:[],all:[],active:[],lastClosed:null});assert.notStrictEqual(empty.upcoming,empty.past);
 for(const date of ['2026-02-30','31.10.2026','2026-10-31T10:00:00Z','',null])assert.throws(()=>Core.appointmentsForClient(state([]),'c1',date));
 for(const id of ['',null,42,'x'.repeat(101)])assert.throws(()=>Core.appointmentsForClient(state([]),id,today));assert.throws(()=>Core.appointmentsForClient({},'c1',today));
});
test('active includes pending and confirmed appointments from the past through distant future',()=>{
 const s=state([appointment('future','2030-01-01','10:00','pending'),appointment('old-confirmed','2024-01-01','12:00','confirmed'),appointment('old-pending','2024-01-01','09:00','pending'),appointment('closed','2026-11-01','10:00','completed'),appointment('today','2026-10-31','00:00','confirmed')]),before=copy(s),result=Core.appointmentsForClient(s,'c1',today);
 assert.deepEqual(ids(result.active),['old-pending','old-confirmed','today','future']);assert(result.active.every(a=>a.price===100));assert.strictEqual(result.active[0],s.appointments[2]);assert.notStrictEqual(result.active,result.all);assert.deepEqual(s,before);
 assert.deepEqual(ids(Core.appointmentsForClient(s,'c1','2035-01-01').active),ids(result.active));
});
test('last closed uses latest scheduled date/start/id across all three closed statuses even in the future',()=>{
 const s=state([appointment('completed','2025-01-01','18:00','completed'),appointment('future-cancelled','2030-01-01','10:00','cancelled'),appointment('future-no-show-a','2030-01-01','11:00','no-show'),appointment('future-no-show-z','2030-01-01','11:00','no-show'),appointment('later-active','2040-01-01','10:00','confirmed')]),result=Core.appointmentsForClient(s,'c1',today);
 assert.strictEqual(result.lastClosed,s.appointments[3]);assert.equal(result.lastClosed.status,'no-show');assert.equal(result.lastClosed.price,100);assert.deepEqual(ids(result.active),['later-active']);
 for(const status of ['completed','cancelled','no-show']){const only=appointment(status,'2026-10-31','10:00',status);assert.strictEqual(Core.appointmentsForClient(state([only]),'c1',today).lastClosed,only);}
});
test('clients with no closed or no active appointments receive null or independent empty lists',()=>{
 const activeOnly=Core.appointmentsForClient(state([appointment('pending','2025-01-01','10:00','pending')]),'c1',today);assert.equal(activeOnly.lastClosed,null);assert.equal(activeOnly.active.length,1);
 const closedOnly=Core.appointmentsForClient(state([appointment('done','2026-10-31','10:00','completed')]),'c1',today);assert.deepEqual(closedOnly.active,[]);assert.equal(closedOnly.lastClosed.id,'done');assert.notStrictEqual(closedOnly.active,closedOnly.past);
});
test('active and last closed use only current client ownership, never equal names or audit client snapshots',()=>{
 const before=appointment('changed-client','2026-10-30','10:00','completed','c1'),corrected=Core.recordAppointmentCorrection(before,{...before,clientId:'c2',price:175},'2026-10-31T08:00:00.000Z','Client corectat'),ownActive=appointment('own-active','2024-01-01','10:00','confirmed','c1'),otherActive=appointment('other-active','2028-01-01','10:00','pending','c2'),s=state([corrected,ownActive,otherActive]),saved=copy(s),first=Core.appointmentsForClient(s,'c1',today),second=Core.appointmentsForClient(s,'c2',today);
 assert.deepEqual(ids(first.active),['own-active']);assert.equal(first.lastClosed,null);assert.deepEqual(ids(second.active),['other-active']);assert.strictEqual(second.lastClosed,corrected);assert.equal(second.all.filter(a=>a.id==='changed-client').length,1);assert.strictEqual(second.lastClosed.corrections,corrected.corrections);assert.deepEqual(s,saved);
});
