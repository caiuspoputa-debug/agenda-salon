'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/app.js'), 'utf8');
const boundary = " if(typeof document==='undefined')return;";
assert.ok(source.includes(boundary), 'the shipped domain entry point must be available');
const sandbox = {};
vm.runInNewContext(source.slice(0, source.indexOf(boundary)) + '\n})(globalThis);', sandbox, { filename: 'app-domain.js' });
const core = sandbox.SalonCore;
const plain = value => JSON.parse(JSON.stringify(value));
const copy = value => structuredClone(value);
const expense = (changes = {}) => ({
  id: 'e1', date: '2026-10-30', amount: 125.75, description: 'Consumabile manichiură',
  createdAt: '2026-10-30T09:00:00.000Z', updatedAt: '2026-10-30T09:00:00.000Z', ...changes
});
function fixture() { return core.createDemo('2026-10-30'); }
function restoredWith(value) { return core.validateState({ ...fixture(), expenses: [value] }); }

test('legacy backup without expenses remains exactly unchanged and does not gain the property', () => {
  const old = fixture();
  const restored = core.validateState(copy(old));
  assert.equal(Object.hasOwn(restored, 'expenses'), false);
  assert.deepEqual(plain(restored), plain(old));
});

test('an explicitly empty expense list survives backup restoration', () => {
  const old = { ...fixture(), expenses: [] };
  const restored = core.validateState(copy(old));
  assert.equal(Object.hasOwn(restored, 'expenses'), true);
  assert.deepEqual(plain(restored.expenses), []);
  assert.deepEqual(plain(restored), plain(old));
});

test('valid dated expenses round-trip including cents, dates and audit fields', () => {
  const state = { ...fixture(), expenses: [expense(), expense({ id: 'e2', date: '2024-02-29', amount: 0.01, description: '' })] };
  assert.deepEqual(plain(core.validateState(JSON.parse(JSON.stringify(state)))), plain(state));
});

test('minimum and maximum expense amounts and ordinary decimal cents are accepted', () => {
  for (const amount of [0.01, 0.1, 0.29, 12, 12.34, 999999.99, 1000000]) {
    assert.equal(restoredWith(expense({ amount })).expenses[0].amount, amount);
  }
});

test('expense notes and timestamps can be omitted and accepted at their exact length limits', () => {
  const minimal = { id: 'e1', date: '2026-10-30', amount: 12.34 };
  const restored = restoredWith(minimal);
  assert.equal(restored.expenses[0].id, 'e1');
  assert.equal(restored.expenses[0].amount, 12.34);
  restoredWith(expense({ description: 'x'.repeat(500), createdAt: 't'.repeat(50), updatedAt: 'u'.repeat(50) }));
});

test('expense arrays cannot be replaced with null, objects, strings or scalar values', () => {
  for (const expenses of [null, {}, '[]', 0, false, undefined]) {
    assert.throws(() => core.validateState({ ...fixture(), expenses }), String(expenses));
  }
});

test('malformed expense entries and missing required fields are rejected', () => {
  for (const value of [null, [], {}, false, 'expense', { date: '2026-10-30', amount: 12 }, { id: 'e1', amount: 12 }, { id: 'e1', date: '2026-10-30' }]) {
    assert.throws(() => restoredWith(value), JSON.stringify(value));
  }
});

test('expense identifiers must be nonempty bounded strings and unique within the list', () => {
  for (const id of ['', 12, null, 'x'.repeat(101)]) assert.throws(() => restoredWith(expense({ id })), String(id));
  assert.throws(() => core.validateState({ ...fixture(), expenses: [expense(), expense({ date: '2026-10-31' })] }));
  const distinct = core.validateState({ ...fixture(), expenses: [expense(), expense({ id: 'e2' })] });
  assert.equal(distinct.expenses.length, 2);
});

test('expense dates reject rollover, invalid leap days and malformed values', () => {
  for (const date of ['2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '30.10.2026', '', null, 20261030]) {
    assert.throws(() => restoredWith(expense({ date })), String(date));
  }
});

test('nonfinite, nonnumeric, nonpositive and excessive expense amounts are rejected', () => {
  for (const amount of [NaN, Infinity, -Infinity, '12.34', null, undefined, true, 0, -0.01, -100, 0.009, 1000000.01]) {
    assert.throws(() => restoredWith(expense({ amount })), String(amount));
  }
});

test('three or more genuine decimal places are rejected rather than silently rounded', () => {
  for (const amount of [0.011, 1.005, 12.345, 100.999, 999999.999]) {
    assert.throws(() => restoredWith(expense({ amount })), String(amount));
  }
});

test('present optional expense fields must be strings', () => {
  for (const field of ['description', 'createdAt', 'updatedAt']) {
    for (const value of [0, false, null, {}, []]) {
      assert.throws(() => restoredWith(expense({ [field]: value })), field + '=' + String(value));
    }
  }
});

test('expense text and timestamp length limits are enforced', () => {
  assert.throws(() => restoredWith(expense({ description: 'x'.repeat(501) })));
  assert.throws(() => restoredWith(expense({ createdAt: 'x'.repeat(51) })));
  assert.throws(() => restoredWith(expense({ updatedAt: 'x'.repeat(51) })));
});

test('expense restoration returns independent copies without mutating source data', () => {
  const original = { ...fixture(), expenses: [expense()] }, before = plain(original);
  const restored = core.validateState(original);
  assert.deepEqual(plain(original), before);
  restored.expenses[0].amount = 99;
  restored.expenses[0].description = 'Changed';
  restored.expenses.push(expense({ id: 'new' }));
  restored.clients[0].notes = 'Changed';
  restored.settings.workspace.salonName = 'Changed';
  assert.deepEqual(plain(original), before);
});

test('adding expenses preserves historical appointments, legacy services and all preferences exactly', () => {
  const old = fixture();
  old.demo = false;
  old.settings.theme = 'dark';
  old.settings.slotMinutes = 15;
  old.settings.bookingEndIsLastStart = false;
  delete old.settings.schedulePolicy;
  Object.assign(old.settings.workspace, { salonName: 'Salonul meu', accent: '#356c68', defaultView: 'month', density: 'compact', textSize: 'large', showStats: false, showIntro: false, visibleStart: '07:22', visibleEnd: '22:20' });
  old.settings.schedule[0] = { day: 0, closed: true, start: '09:00', end: '16:00', breakStart: '12:00', breakEnd: '12:30' };
  old.settings.overrides = [{ id: 'o1', date: '2026-12-25', closed: true, start: '10:00', end: '18:00', breakStart: '', breakEnd: '' }];
  old.services[0].duration = 90;
  old.clients[0].phone = '+40722123456';
  old.clients[0].archived = true;
  old.appointments[0].color = '#5da9ca';
  old.appointments[0].status = 'completed';
  old.appointments[1].status = 'cancelled';
  const before = plain(old);
  const restored = core.validateState({ ...old, expenses: [expense()] });
  const { expenses, ...unchanged } = plain(restored);
  assert.deepEqual(unchanged, before);
  assert.equal(expenses.length, 1);
  assert.deepEqual(plain(old), before);
});
