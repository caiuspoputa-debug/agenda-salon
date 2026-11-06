'use strict';
process.env.TZ='Europe/Bucharest';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/app.js'),'utf8');
const boundary=" if(typeof document==='undefined')return;";
const sandbox={};vm.runInNewContext(source.slice(0,source.indexOf(boundary))+'\n})(globalThis);',sandbox);
const core=sandbox.SalonCore;
const plain=value=>JSON.parse(JSON.stringify(value));
const date='2026-10-30';
function fixture(){const state=plain(core.createDemo(date));state.appointments=[];return state;}
function booking(id,start,duration,status='confirmed',day=date){return {id,date:day,start,duration,status};}
function available(state,min=0,max=1440){return plain(core.calendarSlots(date,state,min,max)).filter(slot=>slot.available);}
function starts(state){return available(state).map(slot=>core.minutesToTime(slot.start));}
function completeBooking(state,start,duration){return {id:'candidate',clientId:state.clients[0].id,date,start,duration,price:120,status:'confirmed',notes:'',services:[{serviceId:state.services[0].id,name:state.services[0].name,price:120,color:state.services[0].color}],createdAt:'2026-10-30T07:00:00.000Z',updatedAt:'2026-10-30T07:00:00.000Z'};}

test('empty calendar offers exactly whole-hour starts10:00 through18:00 every day',()=>{
 const state=fixture(),expected=Array.from({length:9},(_,i)=>(10+i)+':00');
 assert.deepEqual(starts(state),expected);
 for(const day of ['2026-10-30','2026-10-31','2026-11-01'])assert.deepEqual(plain(core.calendarSlots(day,state)).filter(slot=>slot.available).map(slot=>core.minutesToTime(slot.start)),expected);
});

test('10:00+90 creates11:30 then12:00 without propagating half-hours',()=>{
 const state=fixture();state.appointments=[booking('first','10:00',90)];
 assert.deepEqual(starts(state),['11:30','12:00','13:00','14:00','15:00','16:00','17:00','18:00']);
 assert(!available(state).some(slot=>slot.start<690));
});

test('10:00+77 creates11:17 then12:00 without11:47',()=>{
 const state=fixture();state.appointments=[booking('first','10:00',77)];
 assert.deepEqual(starts(state),['11:17','12:00','13:00','14:00','15:00','16:00','17:00','18:00']);
 assert(!available(state).some(slot=>slot.start===707));
});

test('consecutive manual durations add only each real end and keep whole-hour grid',()=>{
 const state=fixture();state.appointments=[booking('first','10:00',90),booking('second','11:30',77)];
 assert.deepEqual(starts(state),['12:47','13:00','14:00','15:00','16:00','17:00','18:00']);
 state.appointments.push(booking('third','12:47',30));assert.deepEqual(starts(state),['13:17','14:00','15:00','16:00','17:00','18:00']);
});

test('whole-hour ends are deduplicated and busy imported overlaps reserve their union',()=>{
 const state=fixture();state.appointments=[booking('a','10:00',90),booking('b','11:00',60),booking('nested','10:30',15)];
 assert.deepEqual(starts(state),['12:00','13:00','14:00','15:00','16:00','17:00','18:00']);
 assert.equal(starts(state).filter(value=>value==='12:00').length,1);
 const slots=plain(core.calendarSlots(date,state));assert(slots.every(slot=>slot.end<=600||slot.start>=720),'No slot rectangles are rendered under busy union');
});

test('cancelled records release time and remove their fractional ends while completed records stay busy',()=>{
 const state=fixture();state.appointments=[booking('a','10:00',77,'cancelled')];assert.deepEqual(starts(state),Array.from({length:9},(_,i)=>(10+i)+':00'));
 for(const status of ['confirmed','pending','completed','no-show']){state.appointments=[booking('a','10:00',77,status)];assert.equal(starts(state)[0],'11:17',status);assert(!starts(state).includes('10:00'),status);}
 state.appointments=[booking('other-day','10:00',77,'confirmed','2026-10-31')];assert(!starts(state).includes('11:17'),'Other dates do not add fractional candidates');
});

test('short free gaps are clipped and candidates without five minutes before next booking are hidden',()=>{
 const state=fixture();state.appointments=[booking('a','10:00',167),booking('later','13:00',60)];
 const gap=available(state).find(slot=>slot.start===767);assert(gap);assert.equal(gap.end,780);assert.equal(starts(state)[1],'14:00');
 state.appointments=[booking('a','10:00',77),booking('later','11:20',60)];assert(!starts(state).includes('11:17'),'Three minutes cannot fit minimum duration');
 state.appointments=[booking('later','12:03',60)];assert(!starts(state).includes('12:00'));assert(starts(state).includes('13:03'));
});

test('legacy hours, breaks, closed overrides and slot preferences remain data but cannot alter fixed grid',()=>{
 const state=fixture();state.settings.schedule.forEach(rule=>Object.assign(rule,{closed:true,start:'07:00',end:'14:00',breakStart:'12:00',breakEnd:'13:00'}));
 state.settings.overrides=[{id:'old',date,closed:true,start:'08:00',end:'17:00',breakStart:'',breakEnd:''}];
 state.settings.bookingEndIsLastStart=false;delete state.settings.schedulePolicy;
 Object.assign(state.settings.workspace,{visibleStart:'06:00',visibleEnd:'23:00'});
 const before=plain(state),expected=Array.from({length:9},(_,i)=>(10+i)+':00');
 for(const step of [15,30,60]){state.settings.slotMinutes=step;assert.deepEqual(starts(state),expected);}
 state.settings.slotMinutes=before.settings.slotMinutes;assert.deepEqual(plain(state),before,'Grid calculations never mutate legacy settings');
 assert.deepEqual(plain(core.validateState(state)),before,'Dormant data remain lossless in backup');
});

test('fixed start window accepts18:00–19:30 and ignores old closed/break policy but rejects crossing midnight',()=>{
 const state=fixture();state.settings.schedule.forEach(rule=>Object.assign(rule,{closed:true,start:'07:00',end:'14:00',breakStart:'12:00',breakEnd:'13:00'}));state.settings.bookingEndIsLastStart=false;
 for(const [start,duration]of [['10:00',90],['12:00',90],['18:00',90],['18:00',360]]){const result=core.validateAppointment(completeBooking(state,start,duration),state);assert.equal(result.valid,true);assert.equal(result.outsideHours,false,start);}
 assert.equal(core.validateAppointment(completeBooking(state,'18:01',90),state).outsideHours,true);assert.equal(core.validateAppointment(completeBooking(state,'09:59',90),state).outsideHours,true);assert.equal(core.validateAppointment(completeBooking(state,'18:00',361),state).valid,false);
 state.appointments=[booking('late','18:00',90)];assert(!starts(state).some(value=>value>'18:00'));assert(!starts(state).includes('18:00'));
});

test('last-minute real ends may extend beyond18:00 only when no later booking blocks minimum duration',()=>{
 const state=fixture();state.appointments=[booking('a','10:00',478)];assert(starts(state).includes('17:58'));assert(starts(state).includes('18:00'));
 state.appointments.push(booking('later','18:01',60));assert(!starts(state).includes('17:58'));assert(!starts(state).includes('18:00'));
});

test('calendar bounds use10:00–19:00 and expand for retained old appointments outside the fixed window',()=>{
 const state=fixture();Object.assign(state.settings.workspace,{visibleStart:'06:00',visibleEnd:'23:00'});assert.deepEqual(plain(core.calendarBounds([date],state)),{min:600,max:1140,scale:1.15});
 state.appointments=[booking('early','09:30',75),booking('late','18:00',90)];const bounds=core.calendarBounds([date],state);assert.equal(bounds.min,540);assert.equal(bounds.max,1200);
 state.appointments=[booking('cancelled','00:00',60,'cancelled'),booking('other','23:00',60,'confirmed','2026-10-31')];assert.equal(core.calendarBounds([date],state).min,600);assert.equal(core.calendarBounds([date],state).max,1140);
});

test('candidate clipping and availability calculations leave all source records untouched',()=>{
 const state=fixture();state.appointments=[booking('first','10:00',77),booking('cancelled','15:00',60,'cancelled')];state.settings.workspace.accent='#356c68';state.settings.workspace.textSize='large';
 const before=plain(state);const slots=available(state,720,1000);assert(slots.every(slot=>slot.start>=720&&slot.start<1000&&slot.end<=1000));assert.deepEqual(plain(core.calendarSlots(date,state,800,700)),[]);assert.deepEqual(plain(state),before);
});
