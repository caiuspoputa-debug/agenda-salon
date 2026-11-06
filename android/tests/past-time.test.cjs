'use strict';

process.env.TZ = 'Europe/Bucharest';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/app.js'), 'utf8');
const boundary = " if(typeof document==='undefined')return;";
assert.ok(source.includes(boundary));
const sandbox = { Date };
vm.runInNewContext(source.slice(0, source.indexOf(boundary)) + '\n})(globalThis);', sandbox);
const core = sandbox.SalonCore;
const plain = value => JSON.parse(JSON.stringify(value));
const now = new Date('2026-10-30T12:34:56.789+02:00');

function state() { const s = core.createDemo('2026-10-30'); s.appointments = []; return s; }
function booking(changes = {}) {
  return {
    id: 'new', clientId: 'c1', date: '2026-10-30', start: '13:00', duration: 60,
    price: 120, status: 'confirmed', notes: '',
    services: [{ serviceId: 's1', name: 'Manichiură', price: 120, color: '#bc8a9f' }],
    createdAt: '2026-10-30T07:00:00.000Z', updatedAt: '2026-10-30T07:00:00.000Z', ...changes
  };
}

test('new starts before the current local day or minute are blocked', () => {
  for (const [date, start] of [['2026-10-29', '23:59'], ['2025-12-31', '18:00'], ['2026-10-30', '00:00'], ['2026-10-30', '12:33']]) {
    assert.equal(core.isPastStart(date, start, now), true, date + ' ' + start);
    assert.equal(core.canUseAppointmentStart(booking({ date, start }), state(), now), false);
  }
});

test('the current minute is accepted even when seconds and milliseconds have elapsed', () => {
  assert.equal(core.isPastStart('2026-10-30', '12:34', now), false);
  assert.equal(core.canUseAppointmentStart(booking({ start: '12:34' }), state(), now), true);
  assert.equal(core.isPastStart('2026-10-30', '12:34', new Date('2026-10-30T12:34:59.999+02:00')), false);
  assert.equal(core.isPastStart('2026-10-30', '12:34', new Date('2026-10-30T12:35:00.000+02:00')), true);
});

test('later starts today and all valid future days remain available to the time guard', () => {
  for (const [date, start] of [['2026-10-30', '12:35'], ['2026-10-30', '18:00'], ['2026-10-31', '00:00'], ['2027-01-01', '10:00']]) {
    assert.equal(core.isPastStart(date, start, now), false);
    assert.equal(core.canUseAppointmentStart(booking({ date, start }), state(), now), true);
  }
});

test('the device local date is used around UTC midnight', () => {
  const localAfterMidnight = new Date('2026-07-15T00:15:00+03:00');
  assert.equal(localAfterMidnight.toISOString().slice(0, 10), '2026-07-14');
  assert.equal(core.isPastStart('2026-07-14', '23:59', localAfterMidnight), true);
  assert.equal(core.isPastStart('2026-07-15', '00:14', localAfterMidnight), true);
  assert.equal(core.isPastStart('2026-07-15', '00:15', localAfterMidnight), false);
  const localBeforeMidnight = new Date('2026-07-15T23:59:59+03:00');
  assert.equal(core.isPastStart('2026-07-16', '00:00', localBeforeMidnight), false);
});

test('crossing local midnight and New Year invalidates the previous day without losing the next minute', () => {
  const before = new Date('2026-12-31T23:59:59.999+02:00'), after = new Date('2027-01-01T00:00:00+02:00');
  assert.equal(core.isPastStart('2026-12-31', '23:59', before), false);
  assert.equal(core.isPastStart('2026-12-31', '23:59', after), true);
  assert.equal(core.isPastStart('2027-01-01', '00:00', after), false);
});

test('Romanian summer-time and winter-time dates follow the local clock', () => {
  for (const instant of ['2026-03-29T10:15:59+03:00', '2026-10-25T10:15:59+02:00']) {
    const clock = new Date(instant), date = instant.slice(0, 10);
    assert.equal(core.isPastStart(date, '10:14', clock), true);
    assert.equal(core.isPastStart(date, '10:15', clock), false);
    assert.equal(core.isPastStart(date, '10:16', clock), false);
  }
});

test('malformed dates, times, and invalid clocks fail closed', () => {
  for (const date of ['2026-02-30', '2026-13-01', '', null, 20261030]) {
    assert.equal(core.isPastStart(date, '13:00', now), true, String(date));
    assert.equal(core.canUseAppointmentStart(booking({ date }), state(), now), false);
  }
  for (const start of ['24:00', '12:60', '9:00', '', null, 1300]) {
    assert.equal(core.isPastStart('2026-10-30', start, now), true, String(start));
    assert.equal(core.canUseAppointmentStart(booking({ start }), state(), now), false);
  }
  const invalid = new Date(NaN);
  assert.equal(core.isPastStart('2026-10-31', '13:00', invalid), true);
  assert.equal(core.canUseAppointmentStart(booking({ date: '2026-10-31' }), state(), invalid), false);
});

test('editing other fields or status on an unchanged historical start remains possible', () => {
  const s = state(), old = booking({ id: 'old', date: '2026-10-29', start: '10:00' });
  s.appointments = [old];
  for (const changes of [{ notes: 'Actualizat' }, { price: 140 }, { duration: 90 }, { status: 'completed' }, { status: 'cancelled' }]) {
    assert.equal(core.canUseAppointmentStart({ ...old, ...changes }, s, now), true, JSON.stringify(changes));
  }
});

test('ordinary rescheduling to a different past day or earlier past minute is blocked', () => {
  const s = state(), old = booking({ id: 'old', date: '2026-10-29', start: '10:00' });
  s.appointments = [old];
  for (const changes of [{ start: '11:00' }, { date: '2026-10-28' }, { date: '2026-10-30', start: '12:33' }]) {
    assert.equal(core.canUseAppointmentStart({ ...old, ...changes }, s, now), false);
  }
  assert.equal(core.canUseAppointmentStart({ ...old, date: '2026-10-30', start: '12:34' }, s, now), true);
  assert.equal(core.canUseAppointmentStart({ ...old, date: '2026-10-31' }, s, now), true);
});

test('a new record cannot borrow another booking historical-start exemption', () => {
  const s = state(), old = booking({ id: 'old', date: '2026-10-29', start: '10:00' });
  s.appointments = [old];
  assert.equal(core.canUseAppointmentStart({ ...old, id: 'new' }, s, now), false);
  assert.equal(core.canUseAppointmentStart({ ...old, id: 'new', status: 'cancelled' }, s, now), false);
  assert.equal(core.canUseAppointmentStart({ ...old, id: 'new', status: 'completed' }, s, now, { allowHistoricalCorrection: true }), false);
});

test('only an existing completed booking gets the explicit historical-correction exemption', () => {
  const s = state(), old = booking({ id: 'old', date: '2026-10-29', start: '10:00', status: 'completed' });
  s.appointments = [old];
  const changed = { ...old, start: '11:17', price: 140 };
  assert.equal(core.canUseAppointmentStart(changed, s, now), false);
  assert.equal(core.canUseAppointmentStart(changed, s, now, { allowHistoricalCorrection: true }), true);
  assert.equal(core.canUseAppointmentStart(changed, s, now, { allowHistoricalCorrection: 'true' }), false);
  s.appointments[0].status = 'confirmed';
  assert.equal(core.canUseAppointmentStart(changed, s, now, { allowHistoricalCorrection: true }), false);
});

test('historical-correction exemption cannot make invalid inputs or invalid clocks acceptable', () => {
  const s = state(), old = booking({ id: 'old', date: '2026-10-29', start: '10:00', status: 'completed' });
  s.appointments = [old];
  for (const changes of [{ date: '2026-02-30' }, { start: '24:00' }]) {
    assert.equal(core.canUseAppointmentStart({ ...old, ...changes }, s, now, { allowHistoricalCorrection: true }), false);
  }
  assert.equal(core.canUseAppointmentStart(old, s, new Date(NaN), { allowHistoricalCorrection: true }), false);
});

test('clock-aware slot generation drops past candidates but never invents offsets', () => {
  const s = state();
  assert.deepEqual(plain(core.calendarSlots('2026-10-29', s, 600, 1140, now)), []);
  assert.deepEqual(plain(core.calendarSlots('2026-10-30', s, 600, 1140, now)).filter(x => x.available).map(x => x.start), [780, 840, 900, 960, 1020, 1080]);
  assert.deepEqual(plain(core.calendarSlots('2026-10-31', s, 600, 1140, now)).filter(x => x.available).map(x => x.start), [600, 660, 720, 780, 840, 900, 960, 1020, 1080]);
});

test('a real appointment end remains a candidate at the current minute but disappears on the next minute', () => {
  const s = state();
  s.appointments = [booking({ id: 'busy', start: '12:00', duration: 34 })];
  const current = plain(core.calendarSlots('2026-10-30', s, 600, 1140, now)).filter(x => x.available).map(x => x.start);
  assert.ok(current.includes(754));
  const later = plain(core.calendarSlots('2026-10-30', s, 600, 1140, new Date('2026-10-30T12:35:00+02:00'))).filter(x => x.available).map(x => x.start);
  assert.ok(!later.includes(754));
  assert.ok(!later.includes(814), 'a 13:34 offset must not be propagated');
});

test('18:00 remains a valid last start during its minute and is unavailable afterward', () => {
  const s = state(), at = new Date('2026-10-30T18:00:59+02:00'), after = new Date('2026-10-30T18:01:00+02:00');
  assert.equal(core.canUseAppointmentStart(booking({ start: '18:00' }), s, at), true);
  assert.ok(core.calendarSlots('2026-10-30', s, 600, 1140, at).some(x => x.available && x.start === 1080));
  assert.equal(core.canUseAppointmentStart(booking({ start: '18:00' }), s, after), false);
  assert.equal(core.calendarSlots('2026-10-30', s, 600, 1140, after).filter(x => x.available).length, 0);
  assert.equal(core.nextAppointmentStart('2026-10-30', s, after), '');
});

test('next-start suggestions use clock-aware candidates while the no-clock API stays deterministic', () => {
  const s = state();
  assert.equal(core.nextAppointmentStart('2026-10-30', s, now), '13:00');
  assert.equal(core.nextAppointmentStart('2026-10-29', s, now), '');
  assert.equal(core.nextAppointmentStart('2026-10-31', s, now), '10:00');
  assert.equal(core.nextAppointmentStart('2026-10-29', s), '10:00');
});

test('time guards leave all stored historical records and preferences untouched', () => {
  const s = state();
  s.appointments = [booking({ id: 'past', date: '2025-12-31', start: '10:00', status: 'completed' })];
  s.settings.workspace.salonName = 'Salon vechi';
  s.expenses = [{ id: 'e1', date: '2025-12-31', amount: 10.5, description: '', createdAt: '', updatedAt: '' }];
  const before = plain(s);
  core.isPastStart(s.appointments[0].date, s.appointments[0].start, now);
  core.canUseAppointmentStart(s.appointments[0], s, now);
  core.calendarSlots('2025-12-31', s, 600, 1140, now);
  core.nextAppointmentStart('2025-12-31', s, now);
  assert.deepEqual(plain(s), before);
  assert.deepEqual(plain(core.validateState(s)), before, 'loading and backup validation must not impose the current clock');
});

test('a historical explicit correction retains exact audited before and after values', () => {
  const s = state(), old = booking({ id: 'old', date: '2025-12-31', start: '10:00', status: 'completed' });
  s.appointments = [old];
  const changed = { ...old, start: '11:17', price: 150 };
  assert.equal(core.canUseAppointmentStart(changed, s, now, { allowHistoricalCorrection: true }), true);
  const audited = core.recordAppointmentCorrection(old, changed, '2026-10-30T10:34:56.789Z', 'Corecție istorică explicită');
  assert.equal(audited.corrections.length, 1);
  assert.equal(audited.corrections[0].before.start, '10:00');
  assert.equal(audited.corrections[0].after.start, '11:17');
  s.appointments = [audited];
  assert.deepEqual(plain(core.validateState(s)), plain(s));
});
