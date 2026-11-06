'use strict';

// Color overrides cross the same persistent format and backup boundary as the
// existing calendar, including backups created before overrides were available.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/app.js'), 'utf8');
const boundary = " if(typeof document==='undefined')return;";
const sandbox = {};
vm.runInNewContext(source.slice(0, source.indexOf(boundary)) + '\n})(globalThis);', sandbox, { filename: 'app-colors.js' });
const core = sandbox.SalonCore;
const plain = value => JSON.parse(JSON.stringify(value));
const fixture = () => core.createDemo('2026-10-30');

test('older agendas retain their original colors without gaining override properties', () => {
  const old = fixture();
  const before = plain(old);
  const restored = core.validateState(plain(old));
  assert.deepEqual(plain(restored), before);
  for (const appointment of restored.appointments) {
    assert.equal(Object.hasOwn(appointment, 'color'), false);
    assert.equal(core.appointmentColor(appointment), appointment.services[0].color);
  }
});

test('custom appointment colors round-trip with workspace and all history intact', () => {
  const state = fixture();
  state.appointments[0].color = '#123AbC';
  state.appointments[1].color = '#e0c557';
  state.appointments[1].status = 'completed';
  state.settings.workspace.accent = '#356c68';
  state.settings.workspace.visibleStart = '07:00';
  state.settings.workspace.showIntro = false;
  const restored = core.validateState(plain(state));
  assert.deepEqual(plain(restored), plain(state));
  assert.equal(core.appointmentColor(restored.appointments[0]), '#123AbC');
  assert.equal(core.appointmentColor(restored.appointments[1]), '#e0c557');
  assert.equal(Object.hasOwn(restored.appointments[2], 'color'), false);
});

test('custom colors affect only one appointment, retaining catalog and service snapshots', () => {
  const state = fixture();
  const services = plain(state.services);
  const snapshots = plain(state.appointments.map(a => a.services));
  const other = plain(state.appointments.slice(1));
  state.appointments[0].color = '#5da9ca';
  const restored = core.validateState(plain(state));
  assert.deepEqual(plain(restored.services), services);
  assert.deepEqual(plain(restored.appointments.map(a => a.services)), snapshots);
  assert.deepEqual(plain(restored.appointments.slice(1)), other);
});

test('new catalog colors cannot change inherited historical appointment colors', () => {
  const state = fixture();
  const recordedColor = core.appointmentColor(state.appointments[0]);
  state.services[0].color = '#d75b62';
  const restored = core.validateState(plain(state));
  assert.equal(restored.services[0].color, '#d75b62');
  assert.equal(core.appointmentColor(restored.appointments[0]), recordedColor);
});

test('inheritance uses the first selected service while explicit color takes priority', () => {
  const state = fixture();
  const appointment = state.appointments[0];
  appointment.services.push(plain(state.appointments[1].services[0]));
  assert.equal(core.appointmentColor(appointment), appointment.services[0].color);
  appointment.color = '#6da97c';
  assert.equal(core.appointmentColor(appointment), '#6da97c');
  delete appointment.color;
  appointment.services.reverse();
  assert.equal(core.appointmentColor(appointment), appointment.services[0].color);
  assert.equal(Object.hasOwn(core.validateState(plain(state)).appointments[0], 'color'), false);
});

test('malformed override colors reject the backup instead of silently discarding it', () => {
  for (const color of ['', '#fff', '#12345678', 'red', '#gg0000', 'red;background:url(https://invalid)', null, undefined, 123, {}, []]) {
    const state = fixture();
    state.appointments[0].color = color;
    assert.throws(() => core.validateState(state), `color=${String(color)}`);
  }
});

test('black, white and arbitrary native-picker colors remain valid overrides', () => {
  for (const color of ['#000000', '#ffffff', '#FFFFFF', '#17a9Ef']) {
    const state = fixture();
    state.appointments[0].color = color;
    const before = plain(state);
    const restored = core.validateState(state);
    assert.equal(restored.appointments[0].color, color);
    assert.deepEqual(plain(state), before, 'validation does not mutate stored data');
  }
});
