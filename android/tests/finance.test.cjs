'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const sandbox={};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../app/src/main/assets/finance.js'),'utf8'),sandbox,{filename:'finance.js'});
const finance=sandbox.SalonFinance;
const plain=value=>JSON.parse(JSON.stringify(value));
const bounds=(kind,anchor)=>{const result=finance.periodBounds(kind,anchor);return [result.start,result.end];};
const booking=(id,date,price,status='completed',extra={})=>({id,date,price,status,...extra});
const expense=(id,date,amount,createdAt='2026-10-30T10:00:00.000Z')=>({id,date,amount,createdAt});

test('day, month and year have inclusive local-calendar endpoints and Romanian labels',()=>{
 assert.deepEqual(bounds('day','2026-10-30'),['2026-10-30','2026-10-30']);
 assert.deepEqual(bounds('month','2026-10-30'),['2026-10-01','2026-10-31']);
 assert.deepEqual(bounds('year','2026-10-30'),['2026-01-01','2026-12-31']);
 assert.match(finance.periodBounds('day','2026-10-30').label,/30 octombrie 2026/);
 assert.match(finance.periodBounds('month','2026-10-30').label,/octombrie 2026/);
 assert.equal(finance.periodBounds('year','2026-10-30').label,'2026');
});

test('weeks are Monday through Sunday within one calendar year, with clipped New Year segments',()=>{
 for(const anchor of ['2026-10-26','2026-10-30','2026-11-01'])assert.deepEqual(bounds('week',anchor),['2026-10-26','2026-11-01']);
 assert.deepEqual(bounds('week','2026-12-31'),['2026-12-28','2026-12-31']);
 assert.deepEqual(bounds('week','2027-01-01'),['2027-01-01','2027-01-03']);
 assert.deepEqual(bounds('week','2027-01-03'),['2027-01-01','2027-01-03']);
 assert.deepEqual(bounds('week','2027-01-04'),['2027-01-04','2027-01-10']);
 assert.match(finance.periodBounds('week','2027-01-01').label,/1 ianuarie 2027 – 3 ianuarie 2027/);
 assert.match(finance.periodBounds('week','2026-12-31').label,/28 decembrie 2026 – 31 decembrie 2026/);
});

test('leap years, century rules and daylight-saving dates retain correct date bounds',()=>{
 assert.deepEqual(bounds('month','2024-02-29'),['2024-02-01','2024-02-29']);
 assert.deepEqual(bounds('month','2026-02-28'),['2026-02-01','2026-02-28']);
 assert.deepEqual(bounds('month','2000-02-29'),['2000-02-01','2000-02-29']);
 assert.deepEqual(bounds('month','1900-02-28'),['1900-02-01','1900-02-28']);
 assert.deepEqual(bounds('year','2024-02-29'),['2024-01-01','2024-12-31']);
 assert.deepEqual(bounds('week','2026-03-29'),['2026-03-23','2026-03-29']);
 assert.deepEqual(bounds('week','2026-10-25'),['2026-10-19','2026-10-25']);
});

test('invalid period kinds and rollover dates produce explicit errors',()=>{
 for(const kind of ['daily','',null,undefined,{},1])assert.throws(()=>finance.periodBounds(kind,'2026-10-30'),/Perioada/);
 for(const date of ['2026-02-29','2026-02-30','2026-04-31','2026-13-01','2026-00-01','2026-1-01','2026-10-30T12:00:00Z','',null,undefined])assert.throws(()=>finance.periodBounds('day',date),/Data/);
 assert.throws(()=>finance.report({appointments:[]},'year','not-a-date'),/Data/);
});

test('period navigation advances whole dates and clamps month and year ends',()=>{
 const examples=[
  ['day','2026-12-31',1,'2027-01-01'],['day','2026-03-29',1,'2026-03-30'],
  ['day','2026-10-25',-1,'2026-10-24'],['week','2026-12-30',1,'2027-01-01'],
  ['week','2027-01-03',-1,'2026-12-31'],['month','2026-01-31',1,'2026-02-28'],
  ['month','2024-01-31',1,'2024-02-29'],['month','2026-03-31',-1,'2026-02-28'],
  ['month','2026-12-31',1,'2027-01-31'],['month','2026-12-31',14,'2028-02-29'],
  ['year','2024-02-29',1,'2025-02-28'],['year','2024-02-29',-4,'2020-02-29'],
  ['year','2000-02-29',-100,'1900-02-28'],['month','2026-10-30',0,'2026-10-30']
 ];
 for(const [kind,anchor,delta,expected]of examples)assert.equal(finance.shiftPeriod(kind,anchor,delta),expected,`${kind} ${anchor} ${delta}`);
 for(const delta of [1.5,NaN,Infinity,'1',undefined])assert.throws(()=>finance.shiftPeriod('day','2026-10-30',delta),/întreg/);
 assert.throws(()=>finance.shiftPeriod('day','2026-02-30',1),/Data/);
 assert.throws(()=>finance.shiftPeriod('unknown','2026-10-30',1),/Perioada/);
});

test('weekly navigation visits each New Year segment and retains ordinary full-week offsets',()=>{
 const examples=[
  ['2026-12-31',1,'2027-01-01'],['2027-01-01',1,'2027-01-04'],
  ['2027-01-01',-1,'2026-12-31'],['2027-01-04',-1,'2027-01-03'],
  ['2026-12-31',2,'2027-01-04'],['2027-01-04',-2,'2026-12-31'],
  ['2026-10-30',1,'2026-11-06'],['2026-10-30',-1,'2026-10-23'],
  ['2026-10-30',0,'2026-10-30'],['2023-12-31',1,'2024-01-07']
 ];
 for(const [anchor,delta,expected]of examples)assert.equal(finance.shiftPeriod('week',anchor,delta),expected,`${anchor} ${delta}`);
 assert.throws(()=>finance.shiftPeriod('week','2027-01-01',Number.MAX_SAFE_INTEGER),/intervalul acceptat/);
 assert.throws(()=>finance.shiftPeriod('week','2027-01-01',-Number.MAX_SAFE_INTEGER),/intervalul acceptat/);
});

test('weekly navigation covers every date of a year once, including first and last partial weeks',()=>{
 const covered=new Set();let anchor='2027-01-01',segments=0;
 for(let guard=0;guard<60&&anchor.startsWith('2027-');guard++){
  const current=finance.periodBounds('week',anchor);segments++;
  assert.ok(current.start.startsWith('2027-'));assert.ok(current.end.startsWith('2027-'));
  const cursor=new Date(current.start+'T00:00:00Z');
  while(cursor.toISOString().slice(0,10)<=current.end){
   const date=cursor.toISOString().slice(0,10);assert.equal(covered.has(date),false,`duplicate date ${date}`);covered.add(date);cursor.setUTCDate(cursor.getUTCDate()+1);
  }
  anchor=finance.shiftPeriod('week',anchor,1);
 }
 assert.equal(anchor,'2028-01-01');assert.equal(covered.size,365);assert.equal(segments,53);
 assert.equal(covered.has('2027-01-01'),true);assert.equal(covered.has('2027-12-31'),true);
 assert.equal(finance.shiftPeriod('week','2027-01-01',53),'2028-01-01');
 assert.equal(finance.shiftPeriod('week','2028-01-01',-53),'2027-01-03');
 assert.deepEqual(bounds('week',finance.shiftPeriod('week','2028-01-01',-53)),['2027-01-01','2027-01-03']);
});

test('January reports start at zero for the new year while old-year reports remain readable',()=>{
 const dates=['2026-12-31','2027-01-01','2027-01-03','2027-01-04','2027-12-31','2028-01-01'];
 const state={settings:{workspace:{salonName:'Salon păstrat'}},appointments:dates.map((date,i)=>booking('a'+i,date,[120,30,40,50,60,70][i])),expenses:dates.map((date,i)=>expense('e'+i,date,[20,5,6,7,8,9][i]))};
 const before=plain(state),expectations={day:[3000,500,1],week:[7000,1100,2],month:[12000,1800,3],year:[18000,2600,4]};
 for(const [kind,[revenue,expenses,count]]of Object.entries(expectations)){
  const current=finance.report(state,kind,'2027-01-01');
  assert.ok(current.start>='2027-01-01',kind);assert.ok(current.end<='2027-12-31',kind);
  assert.equal(current.revenueCents,revenue,kind);assert.equal(current.expenseCents,expenses,kind);assert.equal(current.appointmentCount,count,kind);assert.equal(current.netCents,revenue-expenses,kind);
  assert.equal(current.appointments.some(a=>a.id==='a0'),false,kind);assert.equal(current.expenses.some(e=>e.id==='e0'),false,kind);
  const archived=finance.report(state,kind,'2026-12-31');
  assert.equal(archived.revenueCents,12000,`archived ${kind}`);assert.equal(archived.expenseCents,2000,`archived ${kind}`);assert.equal(archived.appointmentCount,1,`archived ${kind}`);
  assert.ok(archived.end<='2026-12-31',kind);
 }
 assert.deepEqual(plain(state),before,'new-year reporting never deletes or moves old records');
 assert.equal(state.appointments.length,6);assert.equal(state.expenses.length,6);
});

test('revenue includes only completed appointments by appointment date, independent of update dates',()=>{
 const state={appointments:[
  booking('today','2026-10-30',120,'completed',{createdAt:'2025-01-01',updatedAt:'2026-11-01'}),
  booking('yesterday','2026-10-29',90,'completed',{updatedAt:'2026-10-30'}),
  booking('tomorrow','2026-10-31',150,'completed',{createdAt:'2026-10-30'}),
  ...['confirmed','pending','cancelled','no-show','Completed'].map((status,i)=>booking('excluded'+i,'2026-10-30',999,status))
 ]};
 const report=finance.report(state,'day','2026-10-30');
 assert.equal(report.revenueCents,12000);assert.equal(report.appointmentCount,1);
 assert.deepEqual(plain(report.appointments.map(a=>a.id)),['today']);
 assert.equal(report.expenseCents,0);assert.equal(report.netCents,12000);
});

test('revenue and expenses include each boundary of the selected week and exclude adjacent dates',()=>{
 const dates=['2026-10-25','2026-10-26','2026-11-01','2026-11-02'];
 const state={appointments:dates.map((date,i)=>booking('a'+i,date,100+i)),expenses:dates.map((date,i)=>expense('e'+i,date,10+i))};
 const report=finance.report(state,'week','2026-10-30');
 assert.equal(report.kind,'week');assert.equal(report.start,'2026-10-26');assert.equal(report.end,'2026-11-01');
 assert.equal(report.appointmentCount,2);assert.equal(report.revenueCents,20300);assert.equal(report.expenseCents,2300);assert.equal(report.netCents,18000);
 assert.deepEqual(plain(report.appointments.map(a=>a.id)),['a1','a2']);
 assert.deepEqual(plain(report.expenses.map(e=>e.id)),['e2','e1']);
});

test('expenses sort by descending date then creation time without sorting the source',()=>{
 const state={appointments:[],expenses:[expense('first','2026-10-30',1,'2026-10-30T10:00:00Z'),expense('new-date','2026-10-31',2),expense('new-time','2026-10-30',3,'2026-10-30T12:00:00Z'),expense('old-date','2026-10-29',4)]};
 const before=plain(state.expenses);
 const report=finance.report(state,'month','2026-10-30');
 assert.deepEqual(plain(report.expenses.map(e=>e.id)),['new-date','new-time','first','old-date']);
 assert.deepEqual(plain(state.expenses),before);assert.equal(report.expenseCents,1000);
 assert.equal(report.revenueCents,0);assert.equal(report.netCents,-1000);
});

test('sums round each record to integer cents before addition',()=>{
 const state={appointments:[booking('one','2026-10-30',0.1),booking('two','2026-10-30',0.2),booking('binary','2026-10-30',0.1+0.2)],expenses:[expense('round1','2026-10-30',1.005),expense('round2','2026-10-30',10.075)]};
 const report=finance.report(state,'day','2026-10-30');
 assert.equal(report.revenueCents,60);assert.equal(report.expenseCents,1109);assert.equal(report.netCents,-1049);
 state.appointments=[booking('small1','2026-10-30',0.004),booking('small2','2026-10-30',0.004)];
 assert.equal(finance.report(state,'day','2026-10-30').revenueCents,0);
 state.appointments=[booking('half1','2026-10-30',0.005),booking('half2','2026-10-30',0.005)];
 assert.equal(finance.report(state,'day','2026-10-30').revenueCents,2);
});

test('monthly and yearly reports filter expenses and completed revenue across leap and year boundaries',()=>{
 const state={appointments:[booking('previous','2023-12-31',10),booking('jan','2024-01-01',20),booking('leap','2024-02-29',30),booking('dec','2024-12-31',40),booking('next','2025-01-01',50)],expenses:[expense('previous','2023-12-31',1),expense('leap','2024-02-29',2),expense('dec','2024-12-31',3),expense('next','2025-01-01',4)]};
 const month=finance.report(state,'month','2024-02-20'),year=finance.report(state,'year','2024-10-30');
 assert.equal(month.revenueCents,3000);assert.equal(month.expenseCents,200);assert.equal(month.appointmentCount,1);
 assert.equal(year.revenueCents,9000);assert.equal(year.expenseCents,500);assert.equal(year.appointmentCount,3);
});

test('older agendas with no expense field and empty periods return zero totals',()=>{
 const state={appointments:[booking('other','2026-10-29',120)]};
 const report=finance.report(state,'day','2026-10-30');
 assert.equal(report.revenueCents,0);assert.equal(report.expenseCents,0);assert.equal(report.netCents,0);assert.equal(report.appointmentCount,0);
 assert.deepEqual(plain(report.expenses),[]);assert.deepEqual(plain(report.appointments),[]);
 assert.equal(Object.hasOwn(state,'expenses'),false);
});

test('reports accept frozen data and never mutate agenda, workspace, records or arrays',()=>{
 const state={settings:{workspace:{accent:'#79536e'}},appointments:[booking('one','2026-10-30',120)],expenses:[expense('older','2026-10-30',5),expense('newer','2026-10-31',10)]};
 const before=plain(state);
 function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
 freeze(state);
 const report=finance.report(state,'month','2026-10-30');
 assert.equal(report.netCents,10500);assert.deepEqual(plain(state),before);
 assert.notEqual(report.appointments,state.appointments);assert.notEqual(report.expenses,state.expenses);
});

test('invalid monetary fields and unsafe totals fail instead of reporting misleading figures',()=>{
 for(const price of [NaN,Infinity,'120',undefined])assert.throws(()=>finance.report({appointments:[booking('invalid','2026-10-30',price)]},'day','2026-10-30'),/Suma/);
 assert.throws(()=>finance.report({appointments:[],expenses:[expense('invalid','2026-10-30',null)]},'day','2026-10-30'),/Suma/);
 assert.throws(()=>finance.report({appointments:[booking('huge','2026-10-30',1e20)]},'day','2026-10-30'),/intervalul/);
 assert.throws(()=>finance.report({appointments:[],expenses:null},'day','2026-10-30'),/valide/);
});
