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
const revision = (changes = {}) => ({ id: 'r1', effectiveFrom: '2026-10-30', start: '08:30', lastStart: '17:45', createdAt: '2026-10-30T10:34:56.789Z', ...changes });
const fixture = () => core.createDemo('2026-10-30');
function emptyState(ranges) { const s = fixture(); s.appointments = []; if (ranges !== undefined) s.settings.agendaRanges = ranges; return s; }
function booking(changes = {}) { return { ...plain(fixture().appointments[0]), ...changes }; }
function withRanges(ranges) { const s = fixture(); s.settings.agendaRanges = ranges; return s; }
const available = (day, state, clock) => plain(core.calendarSlots(day, state, 0, 1440, clock)).filter(slot => slot.available).map(slot => slot.start);

test('legacy settings remain exactly unchanged and do not gain agenda revisions on load or calculation', () => {
  const old = fixture(), before = plain(old);
  assert.equal(Object.hasOwn(old.settings, 'agendaRanges'), false);
  assert.deepEqual(plain(core.effectiveAgendaRange('2026-10-30', old.settings)), { start: '10:00', lastStart: '18:00' });
  core.calendarSlots('2026-10-30', old);
  core.calendarBounds(['2026-10-30'], old);
  assert.deepEqual(plain(core.validateState(old)), before);
  assert.deepEqual(plain(old), before);
});

test('explicitly empty revisions survive backup round-trip without altering the legacy range', () => {
  const s = withRanges([]);
  assert.deepEqual(plain(core.validateState(s)), plain(s));
  assert.deepEqual(plain(core.effectiveAgendaRange('2026-10-30', s.settings)), { start: '10:00', lastStart: '18:00' });
});

test('range revisions apply inclusively from their date without changing earlier days', () => {
  const s = withRanges([revision()]);
  assert.deepEqual(plain(core.effectiveAgendaRange('2026-10-29', s.settings)), { start: '10:00', lastStart: '18:00' });
  assert.deepEqual(plain(core.effectiveAgendaRange('2026-10-30', s.settings)), { start: '08:30', lastStart: '17:45' });
  assert.deepEqual(plain(core.effectiveAgendaRange('2027-01-01', s.settings)), { start: '08:30', lastStart: '17:45' });
});

test('the latest effective date wins even when revisions are not sorted in the array', () => {
  const s = withRanges([
    revision({ id: 'future', effectiveFrom: '2026-12-01', start: '11:00', lastStart: '20:00' }),
    revision({ id: 'old', effectiveFrom: '2026-09-01', start: '09:00', lastStart: '16:00' }),
    revision({ id: 'middle', effectiveFrom: '2026-11-01', start: '08:00', lastStart: '17:00' })
  ]);
  assert.deepEqual(plain(core.effectiveAgendaRange('2026-10-30', s.settings)), { start: '09:00', lastStart: '16:00' });
  assert.deepEqual(plain(core.effectiveAgendaRange('2026-11-10', s.settings)), { start: '08:00', lastStart: '17:00' });
  assert.deepEqual(plain(core.effectiveAgendaRange('2026-12-10', s.settings)), { start: '11:00', lastStart: '20:00' });
});

test('same-effective-date revisions use the last array entry rather than timestamp ordering', () => {
  const s = withRanges([
    revision({ id: 'first', start: '09:00', lastStart: '19:00', createdAt: '2026-10-30T12:00:00.000Z' }),
    revision({ id: 'second', start: '11:17', lastStart: '18:30', createdAt: '2026-10-30T10:00:00.000Z' })
  ]);
  assert.deepEqual(plain(core.effectiveAgendaRange('2026-10-30', s.settings)), { start: '11:17', lastStart: '18:30' });
});

test('appending today or future revisions creates an independent copy without changing appointments', () => {
  const s = fixture(), before = plain(s);
  const next = core.appendAgendaRange(s.settings, revision(), now);
  assert.notEqual(next, s.settings);
  assert.deepEqual(plain(next.agendaRanges), [revision()]);
  next.workspace.salonName = 'Changed';
  assert.deepEqual(plain(s), before);
  const future = core.appendAgendaRange(s.settings, revision({ id: 'future', effectiveFrom: '2027-01-01' }), now);
  assert.equal(future.agendaRanges[0].effectiveFrom, '2027-01-01');
});

test('no-op range changes keep the exact original settings and omit a new revisions array', () => {
  const settings = fixture().settings;
  const next = core.appendAgendaRange(settings, revision({ start: '10:00', lastStart: '18:00' }), now);
  assert.equal(next, settings);
  assert.equal(Object.hasOwn(settings, 'agendaRanges'), false);
  const existing = withRanges([revision()]).settings;
  assert.equal(core.appendAgendaRange(existing, revision({ id: 'r2' }), now), existing);
  assert.equal(existing.agendaRanges.length, 1);
});

test('UI append rejects backdated changes while importing valid historical revisions remains supported', () => {
  const r = revision({ effectiveFrom: '2026-10-29' });
  assert.throws(() => core.appendAgendaRange(fixture().settings, r, now));
  assert.deepEqual(plain(core.validateState(withRanges([r])).settings.agendaRanges), [r]);
  assert.throws(() => core.appendAgendaRange(fixture().settings, revision(), new Date(NaN)));
});

test('revision changes use local dates around UTC midnight and on Romanian DST dates', () => {
  const localMidnight = new Date('2026-07-15T00:15:00+03:00');
  core.appendAgendaRange(fixture().settings, revision({ effectiveFrom: '2026-07-15' }), localMidnight);
  assert.throws(() => core.appendAgendaRange(fixture().settings, revision({ effectiveFrom: '2026-07-14' }), localMidnight));
  for (const [date, instant] of [['2026-03-29', '2026-03-29T10:00:00+03:00'], ['2026-10-25', '2026-10-25T10:00:00+02:00']]) {
    const next = core.appendAgendaRange(fixture().settings, revision({ effectiveFrom: date }), new Date(instant));
    assert.deepEqual(plain(core.effectiveAgendaRange(date, next)), { start: '08:30', lastStart: '17:45' });
  }
});

test('fractional boundaries add exact edges while intermediate starts stay on whole hours', () => {
  const s = emptyState([revision()]);
  assert.deepEqual(available('2026-10-30', s), [510, 540, 600, 660, 720, 780, 840, 900, 960, 1020, 1065]);
  assert.ok(!available('2026-10-30', s).includes(570), '09:30 must not be generated from an 08:30 opening');
  assert.ok(!available('2026-10-30', s).includes(630), '10:30 must not be propagated');
});

test('actual booking ends appear without propagating offsets or permitting starts while busy', () => {
  const s = emptyState([revision()]);
  s.appointments = [booking({ id: 'busy', start: '09:00', duration: 77 })];
  assert.deepEqual(available('2026-10-30', s), [510, 617, 660, 720, 780, 840, 900, 960, 1020, 1065]);
  assert.ok(!available('2026-10-30', s).includes(677), '11:17 must not be propagated');
  s.appointments[0].status = 'cancelled';
  assert.ok(!available('2026-10-30', s).includes(617), 'cancelled bookings must not add artificial end candidates');
  assert.ok(available('2026-10-30', s).includes(540));
});

test('the last allowed start can finish after the range while staying in the same calendar day', () => {
  const s = emptyState([revision()]);
  assert.equal(core.appointmentFitsHours('2026-10-30', 1065, 120, s.settings), true);
  assert.equal(core.appointmentFitsHours('2026-10-30', 1066, 60, s.settings), false);
  assert.equal(core.appointmentFitsHours('2026-10-30', 509, 60, s.settings), false);
  assert.equal(core.appointmentFitsHours('2026-10-30', 1065, 375, s.settings), true);
  assert.equal(core.appointmentFitsHours('2026-10-30', 1065, 376, s.settings), false);
});

test('a range with one allowed start is valid and does not generate unrelated hours', () => {
  const s = emptyState([revision({ start: '11:17', lastStart: '11:17' })]);
  core.validateState(s);
  assert.deepEqual(available('2026-10-30', s), [677]);
});

test('starts with fewer than five same-day minutes remaining are never offered', () => {
  const s = emptyState([revision({ start: '23:00', lastStart: '23:59' })]);
  core.validateState(s);
  assert.deepEqual(available('2026-10-30', s), [1380]);
  s.appointments = [booking({ start: '23:00', duration: 55 })];
  assert.deepEqual(available('2026-10-30', s), [1435]);
  s.appointments[0].duration = 56;
  assert.deepEqual(available('2026-10-30', s), []);
});

test('past-time filtering respects the configured range and exact boundary minute', () => {
  const s = emptyState([revision({ start: '12:34', lastStart: '17:45' })]);
  assert.equal(core.nextAppointmentStart('2026-10-30', s, now), '12:34');
  assert.ok(available('2026-10-30', s, now).includes(754));
  const nextMinute = new Date('2026-10-30T12:35:00+02:00');
  assert.equal(core.nextAppointmentStart('2026-10-30', s, nextMinute), '13:00');
  assert.ok(!available('2026-10-30', s, nextMinute).includes(754));
});

test('calendar bounds combine different effective dates within the same week', () => {
  const s = emptyState([revision({ effectiveFrom: '2026-10-29', start: '08:30', lastStart: '20:45' })]);
  const bounds = core.calendarBounds(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'], s);
  assert.equal(bounds.min, 480);
  assert.equal(bounds.max, 1320);
  assert.equal(bounds.scale, 1.15);
});

test('fractional range bounds round outwards and still show saved out-of-range appointments', () => {
  const s = emptyState([revision()]);
  assert.equal(core.calendarBounds(['2026-10-30'], s).min, 480);
  assert.equal(core.calendarBounds(['2026-10-30'], s).max, 1140);
  s.appointments = [booking({ id: 'early', start: '06:17', duration: 30 }), booking({ id: 'late', start: '21:30', duration: 120 })];
  const bounds = core.calendarBounds(['2026-10-30'], s);
  assert.equal(bounds.min, 360);
  assert.equal(bounds.max, 1440);
});

test('new ranges preserve all bookings, historical snapshots, reports-related data and preferences exactly', () => {
  const s = fixture();
  s.settings.theme = 'dark';
  s.settings.workspace.salonName = 'Salon personalizat';
  s.settings.workspace.visibleStart = '07:22';
  s.appointments[0].status = 'completed';
  s.appointments[0].color = '#17a9Ef';
  s.expenses = [{ id: 'e1', date: '2026-10-30', amount: 12.34, description: '', createdAt: '', updatedAt: '' }];
  const before = plain(s);
  const settings = core.appendAgendaRange(s.settings, revision(), now);
  const restored = core.validateState({ ...s, settings });
  const { agendaRanges, ...unchangedSettings } = plain(restored.settings);
  assert.deepEqual(unchangedSettings, before.settings);
  assert.deepEqual(plain(restored.appointments), before.appointments);
  assert.deepEqual(plain(restored.clients), before.clients);
  assert.deepEqual(plain(restored.services), before.services);
  assert.deepEqual(plain(restored.expenses), before.expenses);
  assert.deepEqual(plain(s), before);
  assert.deepEqual(agendaRanges, [revision()]);
});

test('backup validation rejects malformed agenda arrays, records and duplicate IDs', () => {
  for (const ranges of [null, {}, 'ranges', undefined, [null], [{}], [false], [revision(), revision({ effectiveFrom: '2026-11-01' })]]) {
    assert.throws(() => core.validateState(withRanges(ranges)), String(ranges));
  }
  const valid = core.validateState(withRanges([revision(), revision({ id: 'r2' })]));
  assert.equal(valid.settings.agendaRanges.length, 2, 'same dates are valid when IDs differ');
});

test('range IDs, dates, clock strings and ordering are validated without numeric coercion', () => {
  for (const changes of [{ id: '' }, { id: 1 }, { id: 'x'.repeat(101) }, { effectiveFrom: '2026-02-30' }, { effectiveFrom: null }, { start: '24:00' }, { start: '8:30' }, { start: 510 }, { lastStart: '17:60' }, { lastStart: 1065 }, { start: '18:00', lastStart: '17:00' }]) {
    assert.throws(() => core.validateState(withRanges([revision(changes)])), JSON.stringify(changes));
  }
});

test('revision timestamps are required canonical ISO values with genuine dates', () => {
  for (const createdAt of ['', 'now', '2026-02-30T12:00:00.000Z', '2026-10-30T10:34:56Z', null, undefined, 123]) {
    assert.throws(() => core.validateState(withRanges([revision({ createdAt })])), String(createdAt));
  }
});

test('the revision cap rejects further changes without mutating settings', () => {
  const settings = fixture().settings;
  settings.agendaRanges = Array.from({ length: 1000 }, (_, i) => revision({ id: 'r' + i }));
  const before = plain(settings);
  core.validateState({ ...fixture(), settings });
  assert.throws(() => core.appendAgendaRange(settings, revision({ id: 'extra', start: '07:00' }), now));
  assert.deepEqual(plain(settings), before);
  assert.throws(() => core.validateState({ ...fixture(), settings: { ...settings, agendaRanges: [...settings.agendaRanges, revision({ id: 'extra' })] } }));
});

test('restored revision records and settings are independent from their source objects', () => {
  const s = withRanges([revision()]), before = plain(s);
  const restored = core.validateState(s);
  restored.settings.agendaRanges[0].start = '06:00';
  restored.settings.workspace.salonName = 'Changed';
  assert.deepEqual(plain(s), before);
});
