const test=require('node:test'),assert=require('node:assert/strict');
const Timeline=require('../app/src/main/assets/timeline.js');
const close=(actual,expected)=>assert(Math.abs(actual-expected)<1e-8,`${actual} differs from ${expected}`);
const make=(appointments=[],options={})=>Timeline.create({min:600,max:1140,scale:1.15,minCardHeight:64,appointments,...options});
const appointment=(start,duration,extra={})=>({start,duration,status:'confirmed',...extra});

test('the global browser API and CommonJS export expose the same immutable factory',()=>{
 assert.strictEqual(global.SalonTimeline,Timeline);assert(Object.isFrozen(Timeline));assert(Object.isFrozen(make()));
});
test('empty periods retain the configured density and clamp positions outside their bounds',()=>{
 const timeline=make();close(timeline.height,540*1.15);close(timeline.toY(630),30*1.15);close(timeline.toMinute(30*1.15),630);
 assert.equal(timeline.toY(-100),0);assert.equal(timeline.toY(1441),timeline.height);assert.equal(timeline.toMinute(-10),600);assert.equal(timeline.toMinute(timeline.height+1),1140);
});
test('a five-minute appointment receives a readable card while empty time keeps base density',()=>{
 const timeline=make([appointment('16:30',5)]);
 close(timeline.toY(990),390*1.15);close(timeline.toY(995)-timeline.toY(990),68);close(timeline.cardHeight(990,5),64);close(timeline.toY(1005)-timeline.toY(995),10*1.15);close(timeline.height,535*1.15+68);
});
test('back-to-back short appointments retain a visible gap and the following free start',()=>{
 const timeline=make([appointment('16:20',5),appointment('16:25',5)]),firstTop=timeline.toY(980)+2,secondTop=timeline.toY(985)+2,freeTop=timeline.toY(990);
 close(secondTop-firstTop,68);close(secondTop-(firstTop+timeline.cardHeight(980,5)),4);close(freeTop-(secondTop+timeline.cardHeight(985,5)),2);close(timeline.toMinute(freeTop),990);
});
test('short appointments across different week columns use the maximum rate on shared segments',()=>{
 const timeline=make([appointment('10:00',15,{date:'2026-11-02'}),appointment('10:05',5,{date:'2026-11-03'})],{scale:.8});
 close(timeline.toY(605),5*68/15);close(timeline.toY(610)-timeline.toY(605),68);close(timeline.toY(615)-timeline.toY(610),5*68/15);
 assert(timeline.cardHeight(600,15)>64);close(timeline.cardHeight(605,5),64);close(timeline.toY(620)-timeline.toY(615),5*.8);
});
test('inverse projection and monotonic ordering hold across all boundaries and fractional minutes',()=>{
 for(const scale of [.8,1.15,1.6])for(const minCardHeight of [64,74]){
  const timeline=make([appointment('10:00',5),appointment('10:05',15),appointment('10:17',20,{date:'other-day'}),appointment('13:37',60),appointment('18:45',15)],{scale,minCardHeight});
  let previous=-1;
  for(let minute=600;minute<=1140;minute+=.25){const y=timeline.toY(minute);assert(y>previous);close(timeline.toMinute(y),minute);previous=y;}
  for(let y=0;y<=timeline.height;y+=1.125)close(timeline.toY(timeline.toMinute(y)),y);
 }
});
test('long appointments retain their normal duration height and short large-text cards reach 74 pixels',()=>{
 const regular=make([appointment('10:00',60)]),large=make([appointment('10:00',5)],{minCardHeight:74});
 close(regular.cardHeight(600,60),65);close(large.cardHeight(600,5),74);close(large.toY(605),78);
});
test('all occupied statuses expand the shared axis while cancelled records do not',()=>{
 for(const status of ['pending','confirmed','completed','no-show'])close(make([appointment('10:00',5,{status})]).cardHeight(600,5),64);
 const baseline=make(),cancelled=make([appointment('10:00',5,{status:'cancelled'}),appointment('11:00',5,{status:'canceled'})]);close(cancelled.height,baseline.height);close(cancelled.toY(605),baseline.toY(605));
});
test('read-only projection does not change appointment order, times, durations or nested history',()=>{
 const appointments=[appointment('13:00',15,{id:'b',services:[{name:'Serviciu',duration:60}],corrections:[{before:{start:'12:00',duration:30}}]}),appointment('10:00',5,{id:'a'})],before=JSON.stringify(appointments);
 for(const item of appointments){Object.freeze(item.services||[]);Object.freeze(item);}Object.freeze(appointments);
 const timeline=make(appointments);timeline.toMinute(30);timeline.cardHeight(780,15);assert.equal(JSON.stringify(appointments),before);
});
test('midnight bounds and appointments ending exactly at midnight project without losing the last card',()=>{
 const timeline=make([appointment('00:00',5),appointment('23:55',5)],{min:0,max:1440,scale:.8});
 close(timeline.toY(0),0);close(timeline.toMinute(timeline.height),1440);close(timeline.cardHeight(1435,5),64);close(timeline.toY(1440)-(timeline.toY(1435)+2+timeline.cardHeight(1435,5)),2);
});
test('appointments outside cropped bounds are ignored and crossing records enlarge only their visible span',()=>{
 const timeline=make([appointment('08:00',5),appointment('20:00',5),appointment('09:55',10),appointment('18:55',10)],{min:600,max:1140,scale:1});
 close(timeline.toY(605),5*6.8);close(timeline.height-timeline.toY(1135),5*6.8);close(timeline.toY(1135)-timeline.toY(605),530);
});
test('duplicate records add no extra scale and input order does not affect projection',()=>{
 const records=[appointment('10:00',15),appointment('10:05',5),appointment('10:10',5),appointment('10:15',15)],single=make(records),duplicates=make(records.flatMap(item=>Array(200).fill(item))),reverse=make([...records].reverse());
 for(let minute=600;minute<=1140;minute++){close(duplicates.toY(minute),single.toY(minute));close(reverse.toY(minute),single.toY(minute));}
});
test('invalid timeline bounds and non-finite or non-positive dimensions fail clearly',()=>{
 for(const options of [{min:-1},{max:1441},{min:1140},{min:600.5},{max:600},{scale:0},{scale:-1},{scale:NaN},{scale:Infinity},{minCardHeight:0},{minCardHeight:Infinity},{appointments:{}}])assert.throws(()=>make([],options));
 assert.throws(()=>Timeline.create());
});
test('invalid active appointment times and durations are rejected without modifying input',()=>{
 for(const record of [null,{},appointment('9:00',5),appointment('24:00',5),appointment('10:60',5),appointment('10:00',4),appointment('10:00',721),appointment('10:00',5.5),appointment('23:59',5),appointment('10:00','5')])assert.throws(()=>make([record]));
 const timeline=make();for(const value of [NaN,Infinity,'10',undefined]){assert.throws(()=>timeline.toY(value));assert.throws(()=>timeline.toMinute(value));assert.throws(()=>timeline.cardHeight(value,5));}assert.throws(()=>timeline.cardHeight(600,0));
});
