'use strict';

// Exercise the application migration and backup boundaries, where a display
// preference must never remove appointments or alter working-hour rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/app.js'), 'utf8');
const boundary = " if(typeof document==='undefined')return;";
assert.ok(source.includes(boundary), 'the domain startup guard must remain available');
const sandbox = {};
vm.runInNewContext(source.slice(0, source.indexOf(boundary)) + '\n})(globalThis);', sandbox, { filename: 'app-workspace.js' });
const core = sandbox.SalonCore;
const plain = value => JSON.parse(JSON.stringify(value));
const defaults = {
  salonName: 'atelier', accent: '#79536e', defaultView: 'auto',
  density: 'comfortable', textSize: 'normal', showStats: true, showIntro: true,
  visibleStart: '10:00', visibleEnd: '18:00'
};
const fixture = () => core.createDemo('2026-10-30');

test('new installations receive complete independent workspace defaults', () => {
  const one = core.defaultSettings();
  const two = core.defaultSettings();
  assert.deepEqual(plain(one.workspace), defaults);
  assert.deepEqual(plain(fixture().settings.workspace), defaults);
  one.workspace.salonName = 'Changed on one device';
  assert.deepEqual(plain(two.workspace), defaults);
});

test('old version 1 backups gain display defaults while retaining all data and history', () => {
  const old = fixture();
  delete old.settings.workspace;
  old.clients[0].archived = true;
  old.appointments[0].status = 'cancelled';
  old.appointments[1].status = 'completed';
  old.settings.overrides.push({ id: 'holiday', date: '2026-12-25', closed: true, start: '09:00', end: '18:00', breakStart: '', breakEnd: '' });
  const before = plain(old);
  const migrated = core.validateState(old);
  assert.deepEqual(plain(migrated.settings.workspace), defaults);
  for (const key of ['clients', 'services', 'appointments']) assert.deepEqual(plain(migrated[key]), before[key], key);
  assert.deepEqual(plain(migrated.settings.schedule), before.settings.schedule);
  assert.deepEqual(plain(migrated.settings.overrides), before.settings.overrides);
  assert.equal(migrated.version, 1);
  assert.equal(old.settings.workspace, undefined, 'migration does not mutate the backup supplied by the caller');
  assert.deepEqual(plain(old), before);
});

test('all customized workspace preferences survive JSON backup and restoration', () => {
  const state = fixture();
  const customized = {
    salonName: 'Salon Ana & Maria', accent: '#127Fae', defaultView: 'month',
    density: 'large', textSize: 'large', showStats: false, showIntro: false,
    visibleStart: '06:15', visibleEnd: '22:45'
  };
  state.settings.workspace = customized;
  const restored = core.validateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(plain(restored), plain(state));
  assert.notEqual(restored.settings.workspace, state.settings.workspace);
  restored.settings.workspace.salonName = 'Another name';
  assert.equal(state.settings.workspace.salonName, 'Salon Ana & Maria', 'restoration creates an independent preference object');
});

test('saved default views and density options accept every supported selection', () => {
  for (const defaultView of ['auto', 'day', 'week', 'month']) {
    for (const density of ['compact', 'comfortable', 'large']) {
      const state = fixture();
      Object.assign(state.settings.workspace, { defaultView, density });
      const restored = core.validateState(state);
      assert.equal(restored.settings.workspace.defaultView, defaultView);
      assert.equal(restored.settings.workspace.density, density);
    }
  }
});

test('salon name trims outer whitespace and rejects empty, excessive or nontext names', () => {
  const state = fixture();
  state.settings.workspace.salonName = '  Salon Ana  ';
  assert.equal(core.validateState(state).settings.workspace.salonName, 'Salon Ana');
  state.settings.workspace.salonName = 'S'.repeat(60);
  assert.equal(core.validateState(state).settings.workspace.salonName.length, 60);
  for (const salonName of ['', '   ', 'S'.repeat(61), 7, null, {}, []]) {
    state.settings.workspace.salonName = salonName;
    assert.throws(() => core.validateState(state), `salonName=${JSON.stringify(salonName)}`);
  }
});

test('malformed workspace options are rejected rather than silently changing preferences', () => {
  const invalid = [
    ['accent', '#fff'], ['accent', 'red'], ['accent', '#ffffff;background:red'], ['accent', '#gg0000'],
    ['accent', null], ['defaultView', 'agenda'], ['defaultView', null],
    ['density', 'small'], ['density', 1], ['textSize', 'huge'], ['textSize', true],
    ['showStats', 'false'], ['showStats', 0], ['showStats', null],
    ['showIntro', 'true'], ['showIntro', 1], ['showIntro', null],
    ['visibleStart', '8:00'], ['visibleStart', '24:00'], ['visibleStart', '08:60'],
    ['visibleEnd', '24:00'], ['visibleEnd', 1200], ['visibleEnd', null]
  ];
  for (const [key, value] of invalid) {
    const state = fixture();
    state.settings.workspace[key] = value;
    assert.throws(() => core.validateState(state), `${key}=${JSON.stringify(value)}`);
  }
});

test('only a missing workspace triggers old-backup migration; malformed and partial objects fail', () => {
  for (const workspace of [null, [], '', false, 0, {}]) {
    const state = fixture();
    state.settings.workspace = workspace;
    assert.throws(() => core.validateState(state), JSON.stringify(workspace));
  }
  for (const key of Object.keys(defaults)) {
    const state = fixture();
    delete state.settings.workspace[key];
    assert.throws(() => core.validateState(state), `missing ${key}`);
  }
});

test('visible calendar range must advance within a day and permits the clock endpoints', () => {
  for (const [visibleStart, visibleEnd] of [['00:00', '23:59'], ['08:00', '08:01'], ['23:58', '23:59']]) {
    const state = fixture();
    Object.assign(state.settings.workspace, { visibleStart, visibleEnd });
    const restored = core.validateState(state);
    assert.equal(restored.settings.workspace.visibleStart, visibleStart);
    assert.equal(restored.settings.workspace.visibleEnd, visibleEnd);
  }
  for (const [visibleStart, visibleEnd] of [['09:00', '09:00'], ['20:00', '08:00']]) {
    const state = fixture();
    Object.assign(state.settings.workspace, { visibleStart, visibleEnd });
    assert.throws(() => core.validateState(state), `${visibleStart}-${visibleEnd}`);
  }
});

test('a narrow display range preserves working hours and appointments outside it', () => {
  const state = fixture();
  state.appointments[0].status = 'completed';
  state.appointments[1].status = 'cancelled';
  const appointmentsBefore = plain(state.appointments);
  const scheduleBefore = plain(state.settings.schedule);
  const openBefore = plain(core.openIntervals('2026-10-30', state.settings));
  Object.assign(state.settings.workspace, {
    salonName: 'Salon Personalizat', accent: '#009988', defaultView: 'day',
    density: 'compact', textSize: 'large', showStats: false, showIntro: false,
    visibleStart: '14:00', visibleEnd: '16:00'
  });
  const restored = core.validateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(plain(restored.appointments), appointmentsBefore);
  assert.deepEqual(plain(restored.settings.schedule), scheduleBefore);
  assert.deepEqual(plain(core.openIntervals('2026-10-30', restored.settings)), openBefore);
  for (const oldAppointment of appointmentsBefore) {
    assert.equal(core.validateAppointment(oldAppointment, restored).outsideHours,
      core.validateAppointment(oldAppointment, state).outsideHours);
  }
});

test('calendar bounds use fixed daily hours while retaining dormant visible-hour preferences', () => {
  const state = fixture();
  state.appointments = [];
  Object.assign(state.settings.workspace, { visibleStart: '10:15', visibleEnd: '16:45' });
  const bounds = core.calendarBounds(['2026-10-30'], state);
  assert.equal(bounds.min, 600);
  assert.equal(bounds.max, 1140);
  assert.equal(state.settings.workspace.visibleStart, '10:15');
  assert.equal(state.settings.workspace.visibleEnd, '16:45');
  assert.deepEqual(plain(core.openIntervals('2026-10-30', state.settings)), [[600, 1080]]);
});

test('active appointments expand visible bounds, while cancellations and other dates do not', () => {
  const state = fixture();
  Object.assign(state.settings.workspace, { visibleStart: '10:00', visibleEnd: '16:00' });
  const base = state.appointments[0];
  state.appointments = [
    { ...base, id: 'early', start: '07:45', duration: 45 },
    { ...base, id: 'late', start: '21:30', duration: 90 },
    { ...base, id: 'cancelled', start: '01:00', duration: 60, status: 'cancelled' },
    { ...base, id: 'different-day', date: '2026-10-31', start: '05:00', duration: 60 }
  ];
  const before = plain(state);
  const bounds = core.calendarBounds(['2026-10-30'], state);
  assert.equal(bounds.min, 420);
  assert.equal(bounds.max, 1380);
  assert.deepEqual(plain(state), before, 'computing display bounds never edits appointment history');
});

test('calendar bounds retain near-midnight appointments at every display density', () => {
  const state = fixture();
  const base = state.appointments[0];
  state.appointments = [
    { ...base, id: 'first-minute', start: '00:05', duration: 5 },
    { ...base, id: 'last-hour', start: '23:00', duration: 60 }
  ];
  const scales = [];
  for (const density of ['compact', 'comfortable', 'large']) {
    state.settings.workspace.density = density;
    const bounds = core.calendarBounds(['2026-10-30'], state);
    assert.equal(bounds.min, 0);
    assert.equal(bounds.max, 1440);
    scales.push(bounds.scale);
  }
  assert.ok(scales[0] > 0 && scales[0] < scales[1] && scales[1] < scales[2]);
});
