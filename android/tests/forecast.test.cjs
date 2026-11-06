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
const booking=(id,date,price,status='completed',extra={})=>({id,date,price,status,...extra});
const estimate=(appointments,anchor='2026-10-30',extra={})=>finance.monthlyEstimate({appointments,...extra},anchor);

test('monthly estimates separate received revenue from all active booked value and exclude other statuses',()=>{
 const result=estimate([
  booking('received','2026-10-10',123.45),
  booking('pending-past','2026-10-01',50,'pending'),
  booking('confirmed-future','2026-10-31',75.5,'confirmed'),
  ...['cancelled','canceled','no-show','Completed','unknown',undefined].map((status,index)=>({id:'excluded'+index,date:'2026-10-30',price:999,status}))
 ]);
 assert.deepEqual(plain(result),{
  start:'2026-10-01',end:'2026-10-31',label:'octombrie 2026',
  completedCents:12345,activeCents:12550,totalCents:24895,
  completedCount:1,activeCount:2,totalCount:3
 });
});

test('all active appointments in the month count regardless of their date relative to the anchor',()=>{
 const appointments=[booking('early','2026-10-01',10,'pending'),booking('middle','2026-10-15',20,'confirmed'),booking('late','2026-10-31',30,'pending')];
 for(const anchor of ['2026-10-01','2026-10-15','2026-10-31']){
  const result=estimate(appointments,anchor);
  assert.equal(result.activeCents,6000);assert.equal(result.activeCount,3);
 }
});

test('month and year boundaries are inclusive and never mix the previous or next period',()=>{
 const appointments=[
  booking('nov','2026-11-30',1),booking('dec-first','2026-12-01',2),booking('dec-last','2026-12-31',3,'confirmed'),
  booking('jan-first','2027-01-01',4,'pending'),booking('jan-last','2027-01-31',5),booking('feb','2027-02-01',6)
 ];
 const december=estimate(appointments,'2026-12-31'),january=estimate(appointments,'2027-01-01');
 assert.equal(december.start,'2026-12-01');assert.equal(december.end,'2026-12-31');
 assert.equal(december.completedCents,200);assert.equal(december.activeCents,300);assert.equal(december.totalCount,2);
 assert.equal(january.start,'2027-01-01');assert.equal(january.end,'2027-01-31');
 assert.equal(january.completedCents,500);assert.equal(january.activeCents,400);assert.equal(january.totalCount,2);
});

test('February 2028 includes leap day and rejects adjacent January and March dates',()=>{
 const result=estimate([
  booking('jan','2028-01-31',100),booking('first','2028-02-01',1,'pending'),
  booking('leap','2028-02-29',2.5,'confirmed'),booking('march','2028-03-01',100)
 ],'2028-02-29');
 assert.equal(result.start,'2028-02-01');assert.equal(result.end,'2028-02-29');
 assert.equal(result.activeCents,350);assert.equal(result.totalCount,2);
});

test('saved booking snapshots and the adjusted amount paid take precedence over current catalog prices',()=>{
 const appointments=[
  booking('paid','2026-10-10',99.99,'completed',{serviceIds:['service'],services:[{id:'service',name:'Istoric',price:120,duration:90}],corrections:[{before:{price:120},after:{price:99.99}}]}),
  booking('reserved','2026-10-20',45,'confirmed',{services:[{id:'service',price:300,duration:15}]})
 ];
 const result=estimate(appointments,'2026-10-30',{services:[{id:'service',price:999,duration:300}]});
 assert.equal(result.completedCents,9999);assert.equal(result.activeCents,4500);assert.equal(result.totalCents,14499);
 assert.equal(finance.report({appointments},'month','2026-10-30').revenueCents,result.completedCents);
});

test('decimal rounding uses integer cents per booking and zero prices never fall back to catalog values',()=>{
 const result=estimate([
  booking('zero-paid','2026-10-01',0,'completed',{services:[{price:100}]}),
  booking('zero-reserved','2026-10-02',0,'confirmed',{services:[{price:500}]}),
  booking('one','2026-10-03',0.1),booking('two','2026-10-04',0.2),
  booking('round-half','2026-10-05',1.005,'pending'),booking('round-binary','2026-10-06',10.075,'confirmed')
 ]);
 assert.equal(result.completedCents,30);assert.equal(result.activeCents,1109);assert.equal(result.totalCents,1139);
 assert.equal(result.completedCount,3);assert.equal(result.activeCount,3);
 const halves=estimate([booking('a','2026-10-01',0.005,'pending'),booking('b','2026-10-02',0.005,'pending')]);
 assert.equal(halves.activeCents,2);
});

test('empty or legacy datasets return zero without requiring an expenses field',()=>{
 const state={appointments:[]};
 const result=finance.monthlyEstimate(state,'2027-01-01');
 assert.equal(result.completedCents,0);assert.equal(result.activeCents,0);assert.equal(result.totalCents,0);
 assert.equal(result.completedCount,0);assert.equal(result.activeCount,0);assert.equal(result.totalCount,0);
 assert.equal(Object.hasOwn(state,'expenses'),false);
 assert.equal(result.start,'2027-01-01');assert.equal(result.end,'2027-01-31');
});

test('expenses and supplier data have no role in an appointment-value estimate',()=>{
 const appointments=[booking('paid','2026-10-01',20),booking('active','2026-10-02',30,'pending')];
 const state={appointments};
 Object.defineProperty(state,'expenses',{get(){throw new Error('Expenses must not be read.');}});
 Object.defineProperty(state,'suppliers',{get(){throw new Error('Suppliers must not be read.');}});
 assert.equal(finance.monthlyEstimate(state,'2026-10-30').totalCents,5000);
 assert.equal(estimate(appointments,'2026-10-30',{expenses:[{date:'2026-10-01',amount:1000000}]}).totalCents,5000);
 assert.equal(estimate(appointments,'2026-10-30',{expenses:null}).totalCents,5000);
});

test('completed and active categories are disjoint when the same booking moves to completion',()=>{
 const appointment=booking('one','2026-10-20',100,'confirmed');
 const before=estimate([appointment]);
 assert.equal(before.activeCount,1);assert.equal(before.completedCount,0);assert.equal(before.totalCount,1);
 appointment.status='completed';appointment.price=95;
 const after=estimate([appointment]);
 assert.equal(after.activeCount,0);assert.equal(after.completedCount,1);assert.equal(after.totalCount,1);
 assert.equal(after.activeCents,0);assert.equal(after.completedCents,9500);assert.equal(after.totalCents,9500);
});

test('frozen snapshots, audit history, service order and settings remain unchanged',()=>{
 const state={
  appointments:[booking('b','2026-10-20',2,'confirmed',{services:[{name:'B'}],corrections:[{before:{price:5}}]}),booking('a','2026-10-01',1)],
  expenses:[{id:'expense',date:'2026-10-10',amount:10}],services:[{id:'b',price:500},{id:'a',price:100}],
  settings:{workspace:{accent:'#7f2abc',calendarView:'week'}}
 };
 const before=JSON.stringify(state);
 function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
 freeze(state);
 const first=finance.monthlyEstimate(state,'2026-10-30');
 const second=finance.monthlyEstimate(state,'2026-10-01');
 assert.equal(first.totalCents,300);assert.deepEqual(plain(first),plain(second));assert.equal(JSON.stringify(state),before);
 first.totalCents=999;
 assert.equal(finance.monthlyEstimate(state,'2026-10-30').totalCents,300);
});

test('invalid state shapes, anchors and included monetary values fail clearly',()=>{
 for(const state of [null,undefined,[],{},'state',{appointments:null},{appointments:{}},{appointments:'appointments'}])assert.throws(()=>finance.monthlyEstimate(state,'2026-10-30'),/valide/);
 for(const anchor of [null,undefined,'','2026-10-30T00:00:00Z','2026-2-01','2026-02-29','2027-02-29','2028-02-30','2026-04-31'])assert.throws(()=>finance.monthlyEstimate({appointments:[]},anchor),/Data/);
 for(const status of ['completed','pending','confirmed'])for(const price of [NaN,Infinity,-Infinity,'120',null,undefined]){
  assert.throws(()=>estimate([booking('invalid','2026-10-30',price,status)]),/Suma/);
 }
 assert.throws(()=>estimate([booking('bad-date','2026-10-3',1)]),/Data/);
});

test('invalid prices on excluded statuses or outside the selected month are never included or validated',()=>{
 const result=estimate([
  booking('cancelled','2026-10-30',NaN,'cancelled'),booking('noshow','2026-10-30',Infinity,'no-show'),
  booking('unknown','2026-10-30','invalid','unknown'),booking('earlier','2026-09-30',undefined),
  booking('later','2026-11-01',NaN,'confirmed'),booking('next-year','2027-10-30',Infinity,'pending'),
  booking('valid','2026-10-30',5,'confirmed'),null
 ]);
 assert.equal(result.totalCents,500);assert.equal(result.totalCount,1);
});

test('unsafe individual amounts and overflow in either category or their combined sum fail',()=>{
 const large=60000000000000;
 for(const status of ['completed','pending','confirmed'])assert.throws(()=>estimate([booking('huge','2026-10-30',1e20,status)]),/intervalul/);
 assert.throws(()=>estimate([booking('a','2026-10-01',large),booking('b','2026-10-02',large)]),/Totalul/);
 assert.throws(()=>estimate([booking('a','2026-10-01',large,'pending'),booking('b','2026-10-02',large,'confirmed')]),/Totalul/);
 assert.throws(()=>estimate([booking('a','2026-10-01',large),booking('b','2026-10-02',large,'pending')]),/Totalul/);
});

test('the existing financial report shape and exact completed revenue remain unchanged',()=>{
 const state={appointments:[booking('paid','2026-10-30',25),booking('future','2026-10-31',75,'confirmed')],expenses:[{id:'e',date:'2026-10-30',amount:5}]};
 const report=finance.report(state,'month','2026-10-30');
 assert.deepEqual(Object.keys(report),['kind','start','end','label','revenueCents','expenseCents','netCents','appointmentCount','expenses','appointments','supplierTotals']);
 assert.equal(report.revenueCents,2500);assert.equal(report.expenseCents,500);assert.equal(report.netCents,2000);assert.equal(report.appointmentCount,1);
 const forecast=finance.monthlyEstimate(state,'2026-10-30');
 assert.equal(forecast.totalCents,10000);
 assert.deepEqual(plain(finance.report(state,'month','2026-10-30')),plain(report));
});
