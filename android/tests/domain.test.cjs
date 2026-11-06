'use strict';

// Exercise the shipped domain functions without creating a browser or replacing
// their implementation. The application explicitly separates these functions
// from browser startup with the document guard below.
process.env.TZ = 'Europe/Bucharest';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/app.js'), 'utf8');
const boundary = " if(typeof document==='undefined')return;";
assert.ok(source.includes(boundary), 'the domain startup guard must remain available');
const sandbox = {};
vm.runInNewContext(source.slice(0, source.indexOf(boundary)) + '\n})(globalThis);', sandbox, { filename: 'app-domain.js' });
const core = sandbox.SalonCore;
const plain = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const state = core.createDemo('2026-10-30');
  state.appointments = [];
  return state;
}
function appointment(changes = {}) {
  return {
    id: 'a-test', clientId: 'c1', date: '2026-10-30', start: '10:00',
    duration: 60, price: 120, status: 'confirmed', notes: '',
    services: [{ serviceId: 's1', name: 'Manichiură', duration: 60, price: 120, color: '#bc8a9f' }],
    createdAt: '2026-10-30T07:00:00.000Z', updatedAt: '2026-10-30T07:00:00.000Z',
    ...changes
  };
}

test('time conversion accepts valid times and rejects invalid clock values', () => {
  assert.equal(core.timeToMinutes('00:00'), 0);
  assert.equal(core.timeToMinutes('09:30'), 570);
  assert.equal(core.timeToMinutes('23:59'), 1439);
  assert.equal(core.minutesToTime(690), '11:30');
  for (const invalid of ['24:00', '9:30', '12:60', '-1:00', '', null]) {
    assert.ok(Number.isNaN(core.timeToMinutes(invalid)), String(invalid));
  }
});

test('dates reject rollover, invalid leap days, malformed and missing values', () => {
  for (const valid of ['2024-02-29', '2026-10-30', '2026-12-31']) assert.equal(core.validDate(valid), true, valid);
  for (const invalid of ['2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-00-01', '2026-1-01', '', undefined]) {
    assert.equal(core.validDate(invalid), false, String(invalid));
  }
});

test('Romanian calendar days survive spring and autumn daylight-saving changes', () => {
  assert.equal(new Date('2026-01-15T12:00:00').getTimezoneOffset(), -120);
  assert.equal(new Date('2026-07-15T12:00:00').getTimezoneOffset(), -180);
  for (const [date, next] of [['2026-03-28', '2026-03-29'], ['2026-03-29', '2026-03-30'], ['2026-10-24', '2026-10-25'], ['2026-10-25', '2026-10-26'], ['2026-12-31', '2027-01-01']]) {
    assert.equal(core.addDays(date, 1), next);
    assert.equal(core.addDays(next, -1), date);
    assert.equal(core.dateKey(core.parseDate(date)), date);
  }
  assert.equal(core.weekStart('2026-10-25'), '2026-10-19');
  assert.equal(core.weekStart('2026-10-26'), '2026-10-26');
});

test('dateKey uses local day at both sides of UTC midnight', () => {
  assert.equal(core.dateKey(new Date('2026-10-30T00:15:00+02:00')), '2026-10-30');
  assert.equal(core.dateKey(new Date('2026-07-15T23:45:00+03:00')), '2026-07-15');
});

test('phone is optional and punctuation is normalized for Romanian and international numbers', () => {
  assert.equal(core.normalizePhone(''), '');
  assert.equal(core.normalizePhone(undefined), '');
  assert.equal(core.normalizePhone('0722 123 456'), '+40722123456');
  assert.equal(core.normalizePhone('+40 (722) 123-456'), '+40722123456');
  assert.equal(core.normalizePhone('0040 722 123 456'), '+40722123456');
  assert.equal(core.normalizePhone('0722123456'), core.normalizePhone('+40722123456'));
  assert.equal(core.normalizePhone('0722123456'), core.normalizePhone('0040722123456'));
  assert.equal(core.normalizePhone('+44 20 7946 0958'), '+442079460958');
  assert.equal(core.normalizePhone('0044 20 7946 0958'), '+442079460958');
  assert.equal(core.normalizePhone('0722'), '0722');
});

test('adjacent appointments do not overlap at either endpoint', () => {
  const booked = appointment({ id: 'existing' });
  assert.equal(core.findConflicts(appointment({ start: '09:00' }), [booked]).length, 0);
  assert.equal(core.findConflicts(appointment({ start: '11:00' }), [booked]).length, 0);
});

test('partial overlap, containment and identical times are blocked', () => {
  const booked = appointment({ id: 'existing' });
  for (const candidate of [appointment({ start: '09:30' }), appointment({ start: '10:30' }), appointment({ start: '10:15', duration: 15 }), appointment({ start: '09:00', duration: 180 }), appointment()]) {
    assert.equal(core.findConflicts(candidate, [booked]).length, 1, candidate.start);
  }
});

test('editing the same appointment and using another date do not cause self-conflicts', () => {
  const booked = appointment();
  assert.equal(core.findConflicts({ ...booked }, [booked]).length, 0);
  assert.equal(core.findConflicts(appointment({ id: 'other', date: '2026-10-31' }), [booked]).length, 0);
});

test('cancellation releases the interval while retaining its record', () => {
  const state = fixture();
  state.appointments.push(appointment({ id: 'existing', status: 'cancelled' }));
  assert.equal(core.validateAppointment(appointment(), state).valid, true);
  assert.equal(state.appointments.length, 1);
  assert.equal(state.appointments[0].status, 'cancelled');
  state.appointments[0].status = 'confirmed';
  assert.equal(core.validateAppointment(appointment(), state).valid, false);
  assert.equal(core.validateAppointment(appointment({ id: 'existing', status: 'cancelled' }), state).valid, true);
});

test('a restored cancelled appointment must pass conflict checking', () => {
  const state = fixture();
  state.appointments.push(appointment({ id: 'occupied' }));
  const restored = appointment({ id: 'restore', status: 'confirmed' });
  assert.equal(core.validateAppointment(restored, state).valid, false);
  assert.equal(core.validateAppointment(restored, state).conflicts[0].id, 'occupied');
});

test('default schedule opens every day from 10:00 with last start at 18:00', () => {
  const settings = core.defaultSettings();
  assert.deepEqual(plain(core.openIntervals('2026-10-30', settings)), [[600, 1080]]);
  assert.deepEqual(plain(core.openIntervals('2026-10-31', settings)), [[600, 1080]]);
  assert.deepEqual(plain(core.openIntervals('2026-11-01', settings)), [[600, 1080]]);
});

test('legacy break metadata stays readable while active appointments use fixed daily hours', () => {
  const state = fixture();
  Object.assign(state.settings.schedule[5], { breakStart: '12:00', breakEnd: '13:00' });
  assert.deepEqual(plain(core.openIntervals('2026-10-30', state.settings)), [[600, 720], [780, 1080]]);
  assert.equal(core.validateAppointment(appointment({ start: '11:00' }), state).outsideHours, false);
  assert.equal(core.validateAppointment(appointment({ start: '13:00' }), state).outsideHours, false);
  assert.equal(core.validateAppointment(appointment({ start: '11:30' }), state).outsideHours, false);
  assert.equal(core.validateAppointment(appointment({ start: '12:00' }), state).outsideHours, false);
});

test('date overrides replace ordinary schedule including a closed holiday and reopened Sunday', () => {
  const settings = core.defaultSettings();
  settings.overrides.push({ id: 'closed', date: '2026-10-30', closed: true, start: '09:00', end: '18:00' });
  settings.overrides.push({ id: 'special', date: '2026-11-01', closed: false, start: '10:00', end: '14:00' });
  assert.deepEqual(plain(core.openIntervals('2026-10-30', settings)), []);
  assert.deepEqual(plain(core.openIntervals('2026-11-01', settings)), [[600, 840]]);
  assert.deepEqual(plain(core.openIntervals('2026-10-29', settings)), [[600, 1080]]);
});

test('outside the fixed10–18 start window requires a separate explicit decision', () => {
  const state = fixture();
  state.settings.bookingEndIsLastStart = false;
  state.settings.schedule[0].closed = true;
  const early = core.validateAppointment(appointment({ start: '08:00' }), state);
  assert.equal(early.valid, true);
  assert.equal(early.outsideHours, true);
  assert.equal(core.validateAppointment(appointment({ start: '17:00' }), state).outsideHours, false);
  assert.equal(core.validateAppointment(appointment({ start: '17:30' }), state).outsideHours, false);
  assert.equal(core.validateAppointment(appointment({ start: '18:00', duration: 90 }), state).outsideHours, false);
  assert.equal(core.validateAppointment(appointment({ start: '18:01' }), state).outsideHours, true);
  assert.equal(core.validateAppointment(appointment({ date: '2026-11-01' }), state).outsideHours, false);
});

test('client with no telephone may receive an appointment', () => {
  const state = fixture();
  assert.equal(state.clients[0].phone, '');
  assert.equal(core.validateAppointment(appointment(), state).valid, true);
  assert.equal(core.validateState(state).clients[0].phone, '');
});

test('appointment validation rejects invalid date, unknown client, empty services, invalid status and price', () => {
  const state = fixture();
  for (const changes of [{ date: '2026-02-30' }, { clientId: 'missing' }, { services: [] }, { status: 'unknown' }, { price: -1 }, { price: NaN }, { price: 1000001 }, { start: '24:00' }, { duration: 4 }, { duration: 721 }, { duration: 60.5 }, { start: '23:30', duration: 60 }]) {
    const result = core.validateAppointment(appointment(changes), state);
    assert.equal(result.valid, false, JSON.stringify(changes));
    assert.ok(result.errors.length > 0);
  }
});

test('appointment can end exactly at midnight but cannot cross into another day', () => {
  const state = fixture();
  assert.equal(core.validateAppointment(appointment({ start: '23:00' }), state).valid, true);
  assert.equal(core.validateAppointment(appointment({ start: '23:01' }), state).valid, false);
});

test('demo service snapshots retain historical price, duration and name after catalog edits', () => {
  const state = core.createDemo('2026-10-30');
  const recorded = plain(state.appointments[0]);
  Object.assign(state.services[0], { name: 'Denumire nouă', duration: 90, price: 999, active: false });
  assert.deepEqual(plain(state.appointments[0]), recorded);
  const restored = core.validateState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.appointments[0].services[0].name, recorded.services[0].name);
  assert.equal(restored.appointments[0].duration, 60);
  assert.equal(restored.appointments[0].price, 120);
});

test('valid backup round-trips preserving all appointment records including cancellations', () => {
  const state = core.createDemo('2026-10-30');
  state.appointments[0].status = 'cancelled';
  state.clients[0].archived = true;
  const restored = core.validateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(plain(restored), plain(state));
  assert.notEqual(restored, state);
});

test('backup restoration produces independent sanitized copies and ignores unknown metadata', () => {
  const state = fixture();
  state.clients[0].phone = '+40 (722) 123-456';
  state.extra = 'untrusted';
  const restored = core.validateState(state);
  assert.equal(restored.clients[0].phone, '+40722123456');
  assert.equal(restored.extra, undefined);
  restored.clients[0].name = 'Changed';
  assert.equal(state.clients[0].name, 'Ana Popescu');
});

test('backup rejects missing shape and unsupported version', () => {
  for (const raw of [null, [], {}, { version: 2 }, { ...fixture(), appointments: {} }, { ...fixture(), settings: null }]) assert.throws(() => core.validateState(raw));
});

test('backup rejects duplicate client, service and appointment identifiers', () => {
  for (const key of ['clients', 'services', 'appointments']) {
    const state = fixture();
    if (key === 'appointments') state.appointments.push(appointment());
    state[key].push({ ...state[key][0] });
    assert.throws(() => core.validateState(state), key);
  }
});

test('backup rejects duplicate weekday rules and duplicate special dates', () => {
  let state = fixture();
  state.settings.schedule[6].day = 5;
  assert.throws(() => core.validateState(state));
  state = fixture();
  state.settings.overrides = [
    { id: 'one', date: '2026-12-25', closed: true, start: '09:00', end: '18:00' },
    { id: 'two', date: '2026-12-25', closed: false, start: '10:00', end: '12:00' }
  ];
  assert.throws(() => core.validateState(state));
});

test('backup rejects duplicate identifiers for special dates', () => {
  const state = fixture();
  state.settings.overrides = [
    { id: 'same', date: '2026-12-24', closed: true, start: '09:00', end: '18:00' },
    { id: 'same', date: '2026-12-25', closed: true, start: '09:00', end: '18:00' }
  ];
  assert.throws(() => core.validateState(state));
});

test('backup rejects invalid appointment fields and dangling client references', () => {
  for (const changes of [{ date: '2026-02-30' }, { start: '25:00' }, { duration: 60.1 }, { price: -1 }, { clientId: 'missing' }, { status: 'unknown' }, { services: [] }, { start: '23:30' }]) {
    const state = fixture();
    state.appointments.push(appointment(changes));
    assert.throws(() => core.validateState(state), JSON.stringify(changes));
  }
});

test('backup rejects broken schedule, invalid theme and invalid slot sizes', () => {
  for (const changes of [{ start: '18:00', end: '09:00' }, { breakStart: '12:00', breakEnd: '' }, { breakStart: '12:00', breakEnd: '11:00' }, { breakStart: '08:00', breakEnd: '10:00' }, { closed: 'false' }]) {
    const state = fixture();
    Object.assign(state.settings.schedule[5], changes);
    assert.throws(() => core.validateState(state), JSON.stringify(changes));
  }
  const state = fixture();
  state.settings.theme = 'unknown';
  assert.throws(() => core.validateState(state));
  state.settings.theme = 'light';
  state.settings.slotMinutes = 20;
  assert.throws(() => core.validateState(state));
});

test('backup rejects empty names, invalid service duration, price and unsafe calendar colors', () => {
  const emptyName = fixture();
  emptyName.clients[0].name = '  ';
  assert.throws(() => core.validateState(emptyName));
  for (const changes of [{ name: '' }, { duration: 0 }, { duration: 30.5 }, { price: -1 }, { color: 'red;background:url(https://invalid)' }]) {
    const state = fixture();
    Object.assign(state.services[0], changes);
    assert.throws(() => core.validateState(state), JSON.stringify(changes));
  }
});
