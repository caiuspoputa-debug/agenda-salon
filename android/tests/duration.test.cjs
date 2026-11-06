'use strict';

// Catalog durations from 0.2.1 remain valid historical data; the appointment's
// manually entered total is now the only scheduling duration.
process.env.TZ = 'Europe/Bucharest';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/app.js'), 'utf8');
const boundary = " if(typeof document==='undefined')return;";
const sandbox = {};
assert.ok(source.includes(boundary));
vm.runInNewContext(source.slice(0, source.indexOf(boundary)) + '\n})(globalThis);', sandbox);
const core = sandbox.SalonCore;
const plain = value => JSON.parse(JSON.stringify(value));

function legacy() {
  const settings = plain(core.defaultSettings());
  settings.theme = 'dark';
  settings.slotMinutes = 15;
  delete settings.bookingEndIsLastStart;
  delete settings.schedulePolicy;
  settings.schedule = Array.from({length:7},(_,day)=>({day,closed:day===0,start:'09:00',end:day===6?'14:00':'18:00',breakStart:'',breakEnd:''}));
  settings.workspace = {
    salonName: 'Salonul meu', accent: '#356c68', defaultView: 'day',
    density: 'compact', textSize: 'large', showStats: false, showIntro: false,
    visibleStart: '07:15', visibleEnd: '21:45'
  };
  settings.schedule[5] = {day:5,closed:false,start:'08:00',end:'20:00',breakStart:'12:00',breakEnd:'12:30'};
  settings.overrides = [{id:'vacation',date:'2026-12-25',closed:true,start:'09:00',end:'18:00',breakStart:'',breakEnd:''}];
  return {
    version: 1, demo: false, settings,
    clients: [{id:'legacy-client',name:'Clienta păstrată',phone:'+40722123456',notes:'Notiță personală',archived:false},
      {id:'archived-client',name:'Clienta arhivată',phone:'',notes:'Istoric',archived:true}],
    services: [{id:'legacy-service',name:'Serviciul original',category:'Manichiură',duration:120,price:170,color:'#5aafa0',active:true},
      {id:'inactive-service',name:'Serviciul inactiv',category:'Pedichiură',duration:30,price:50,color:'#70599a',active:false}],
    appointments: [{id:'legacy-booking',clientId:'legacy-client',date:'2026-10-30',start:'10:00',duration:75,price:157.5,status:'confirmed',notes:'Durată ajustată manual',
      services:[{serviceId:'legacy-service',name:'Denumirea istorică',duration:90,price:155,color:'#356c68'}],
      color:'#ea8c67',createdAt:'2026-10-01T08:05:00.000Z',updatedAt:'2026-10-04T09:15:00.000Z'},
    {id:'cancelled-booking',clientId:'archived-client',date:'2026-09-15',start:'09:00',duration:45,price:50,status:'cancelled',notes:'Istoric anulat',
      services:[{serviceId:'inactive-service',name:'Serviciul inactiv',duration:30,price:50,color:'#70599a'}],
      createdAt:'2026-09-01T08:00:00.000Z',updatedAt:'2026-09-15T07:00:00.000Z'}]
  };
}

test('0.2.1 backup keeps every setting, catalog duration, historical snapshot and manual total exactly', () => {
  const previous = legacy();
  const loaded = core.validateState(plain(previous));
  assert.deepEqual(plain(loaded), previous);
  assert.deepEqual(plain(core.validateState(plain(loaded))), previous);
  loaded.settings.workspace.accent = '#688fd0';
  loaded.services[0].name = 'Changed';
  assert.equal(previous.settings.workspace.accent, '#356c68');
  assert.equal(previous.services[0].name, 'Serviciul original');
});

test('new services need no catalog duration and survive save/backup round trips without adding one', () => {
  const state = legacy();
  state.services.push({id:'new-service',name:'Serviciu nou',category:'Manichiură',price:130,color:'#d66b8a',active:true});
  const restored = core.validateState(plain(state));
  assert.deepEqual(plain(restored), state);
  assert.equal(Object.hasOwn(restored.services.at(-1), 'duration'), false);
});

test('invalid legacy catalog duration is rejected when supplied', () => {
  for (const duration of [null, '', '60', 0, 4, 721, -15, 30.5, NaN, Infinity]) {
    const state = legacy();
    state.services[0].duration = duration;
    assert.throws(() => core.validateState(state), String(duration));
  }
});

test('new booking snapshots omit catalog duration while the manual total is preserved', () => {
  const state = legacy();
  const a = state.appointments[0];
  delete state.services[0].duration;
  delete a.services[0].duration;
  a.duration = 125;
  assert.deepEqual(plain(core.validateState(plain(state))), state);
  assert.equal(core.validateAppointment(a, state).valid, true);
});

test('mixed old and new service snapshots remain valid without rewriting historic values', () => {
  const state = legacy();
  state.appointments[0].services.push({serviceId:'new-service',name:'Nou',price:30,color:'#d66b8a'});
  const result = core.validateState(plain(state));
  assert.deepEqual(plain(result), state);
  assert.equal(result.appointments[0].duration, 75);
  assert.equal(result.appointments[0].services[0].duration, 90);
  assert.equal(Object.hasOwn(result.appointments[0].services[1], 'duration'), false);
});

test('invalid optional legacy snapshot duration is rejected when supplied', () => {
  for (const duration of [null, '', '60', 0, 4, 721, -15, 30.5, NaN, Infinity]) {
    const state = legacy();
    state.appointments[0].services[0].duration = duration;
    assert.throws(() => core.validateState(state), String(duration));
  }
});

test('appointments always require their own valid manual duration', () => {
  const state = legacy();
  for (const duration of [undefined, null, '', 0, 4, 721, 60.5, NaN]) {
    const appointment = {...state.appointments[0], duration};
    assert.equal(core.validateAppointment(appointment, state).valid, false, String(duration));
    const invalidBackup = plain(state);
    if (duration === undefined) delete invalidBackup.appointments[0].duration;
    else invalidBackup.appointments[0].duration = duration;
    assert.throws(() => core.validateState(invalidBackup), String(duration));
  }
});

test('manual duration may differ from one service or many service durations and controls overlap', () => {
  const state = legacy();
  const booking = state.appointments[0];
  booking.services.push({...state.appointments[1].services[0]});
  booking.duration = 75;
  const adjacent = {...booking, id:'after', start:'11:15', duration:15};
  assert.equal(core.findConflicts(adjacent, [booking]).length, 0);
  assert.equal(core.findConflicts({...adjacent, start:'11:14'}, [booking]).length, 1);
  assert.equal(core.validateAppointment(booking, state).valid, true);
  assert.deepEqual(plain(core.validateState(plain(state))), state);
});

test('catalog edits and service archival do not alter appointment time, snapshot or custom color', () => {
  const state = legacy();
  const recorded = plain(state.appointments);
  Object.assign(state.services[0], {name:'Nou',price:999,duration:240,color:'#688fd0',active:false});
  assert.deepEqual(plain(core.validateState(plain(state))).appointments, recorded);
});
