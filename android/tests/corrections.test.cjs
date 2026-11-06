'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assets = path.join(__dirname, '../app/src/main/assets');
const source = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');
const boundary = " if(typeof document==='undefined')return;";
assert.ok(source.includes(boundary));
const sandbox = {};
vm.runInNewContext(source.slice(0, source.indexOf(boundary)) + '\n})(globalThis);', sandbox);
vm.runInNewContext(fs.readFileSync(path.join(assets, 'finance.js'), 'utf8'), sandbox);
const core = sandbox.SalonCore;
const plain = value => JSON.parse(JSON.stringify(value));
const stamp = '2026-10-30T15:10:20.123Z';
const stamp2 = '2026-10-30T15:11:20.123Z';

function original() {
  return {
    id: 'a1', clientId: 'c1', date: '2026-10-30', start: '10:00', duration: 60,
    price: 120, status: 'completed', notes: 'Preferă nude', color: '#123AbC',
    services: [{ serviceId: 's1', name: 'Manichiură', duration: 60, price: 120, color: '#bc8a9f' }],
    createdAt: '2026-10-30T07:00:00.000Z', updatedAt: '2026-10-30T08:00:00.000Z'
  };
}
function business() {
  return {
    clientId: 'c1', date: '2026-10-30', start: '10:00', duration: 60, price: 120,
    status: 'completed', notes: 'Preferă nude', color: '#123AbC',
    services: [{ serviceId: 's1', name: 'Manichiură', duration: 60, price: 120, color: '#bc8a9f' }]
  };
}
function validHistory() {
  const before = business(), after = business();
  Object.assign(after, { price: 150, notes: 'Corectat prețul' });
  return [{ at: stamp, before, after, reason: 'Preț introdus greșit' }];
}
function stateWith(history = validHistory()) {
  const state = core.createDemo('2026-10-30');
  state.appointments = [{ ...original(), price: 150, notes: 'Corectat prețul', corrections: history }];
  state.settings.theme = 'dark';
  state.settings.workspace.salonName = 'Salon personalizat';
  state.expenses = [{ id: 'e1', date: '2026-10-30', amount: 25.5, description: 'Consumabile', createdAt: stamp, updatedAt: stamp }];
  return state;
}

test('old completed appointments load unchanged without gaining correction histories', () => {
  const old = stateWith();
  delete old.appointments[0].corrections;
  const before = plain(old);
  assert.deepEqual(plain(core.validateState(old)), before);
  assert.deepEqual(plain(old), before);
  assert.equal(Object.hasOwn(core.validateState(old).appointments[0], 'corrections'), false);
});

test('business snapshots retain exactly the audited values and exclude identity and history metadata', () => {
  const a = original();
  a.corrections = validHistory();
  assert.deepEqual(plain(core.appointmentSnapshot(a)), business());
  const snapshot = core.appointmentSnapshot(a);
  snapshot.services[0].price = 999;
  snapshot.notes = 'Changed';
  assert.equal(a.services[0].price, 120);
  assert.equal(a.notes, 'Preferă nude');
  for (const field of ['id', 'createdAt', 'updatedAt', 'corrections']) assert.equal(Object.hasOwn(snapshot, field), false);
});

test('snapshot preserves absent override and optional legacy service duration', () => {
  const a = original();
  delete a.color;
  delete a.services[0].duration;
  const result = core.appointmentSnapshot(a);
  assert.equal(Object.hasOwn(result, 'color'), false);
  assert.equal(Object.hasOwn(result.services[0], 'duration'), false);
});

test('business change detection ignores timestamps, identity, histories and color letter case', () => {
  const a = original(), b = plain(a);
  Object.assign(b, { id: 'different', createdAt: stamp, updatedAt: stamp2, corrections: validHistory(), color: '#123abc' });
  b.services[0].color = '#BC8A9F';
  assert.equal(core.appointmentChanged(a, b), false);
});

test('all meaningful appointment fields trigger business change detection', () => {
  const a = original();
  for (const changes of [{ clientId: 'c2' }, { date: '2026-10-31' }, { start: '11:17' }, { duration: 90 }, { price: 120.01 }, { status: 'confirmed' }, { notes: 'Alte observații' }, { color: '#000000' }]) {
    assert.equal(core.appointmentChanged(a, { ...a, ...changes }), true, JSON.stringify(changes));
  }
  const withoutColor = plain(a);
  delete withoutColor.color;
  assert.equal(core.appointmentChanged(a, withoutColor), true);
  for (const changes of [{ name: 'Alt serviciu' }, { duration: 90 }, { price: 130 }, { color: '#000000' }, { serviceId: 's2' }]) {
    const changed = plain(a);
    Object.assign(changed.services[0], changes);
    assert.equal(core.appointmentChanged(a, changed), true, JSON.stringify(changes));
  }
});

test('a real correction appends one exact before/after snapshot without mutating either argument', () => {
  const before = original(), after = plain(before);
  Object.assign(after, { date: '2026-10-31', start: '11:17', duration: 90, price: 160.25, status: 'confirmed', color: '#17a9Ef', updatedAt: stamp });
  after.services = [{ serviceId: 's2', name: 'Pedichiură', price: 160.25, color: '#91a990' }];
  const beforeCopy = plain(before), afterCopy = plain(after);
  const result = core.recordAppointmentCorrection(before, after, stamp, 'Corecție autorizată');
  assert.equal(result.corrections.length, 1);
  assert.deepEqual(plain(result.corrections[0]), { at: stamp, before: business(), after: plain(core.appointmentSnapshot(after)), reason: 'Corecție autorizată' });
  assert.deepEqual(plain(before), beforeCopy);
  assert.deepEqual(plain(after), afterCopy);
  result.corrections[0].before.services[0].price = 1;
  assert.equal(before.services[0].price, 120);
});

test('no-op corrections do not invent an empty or duplicate history property', () => {
  const before = original(), after = { ...plain(before), updatedAt: stamp };
  const result = core.recordAppointmentCorrection(before, after, stamp);
  assert.equal(Object.hasOwn(result, 'corrections'), false);
  const audited = core.recordAppointmentCorrection(before, { ...after, price: 130 }, stamp);
  const noOp = core.recordAppointmentCorrection(audited, { ...plain(audited), updatedAt: stamp2 }, stamp2);
  assert.deepEqual(plain(noOp.corrections), plain(audited.corrections));
  assert.equal(noOp.corrections.length, 1);
});

test('reopened bookings remain auditable through later edits and re-completion', () => {
  const before = original();
  const reopened = core.recordAppointmentCorrection(before, { ...plain(before), status: 'confirmed' }, stamp, 'Redeschidere');
  const edited = core.recordAppointmentCorrection(reopened, { ...plain(reopened), price: 135 }, stamp2, 'Preț corect');
  const completed = core.recordAppointmentCorrection(edited, { ...plain(edited), status: 'completed' }, '2026-10-30T15:12:20.123Z');
  assert.equal(completed.corrections.length, 3);
  assert.deepEqual(plain(completed.corrections[0]), plain(reopened.corrections[0]));
  assert.equal(completed.corrections[1].before.status, 'confirmed');
  assert.equal(completed.corrections[1].after.price, 135);
  assert.equal(completed.corrections[2].before.price, 135);
  assert.equal(completed.corrections[2].after.status, 'completed');
});

test('after-record history injection cannot replace or duplicate the trusted previous history', () => {
  const audited = core.recordAppointmentCorrection(original(), { ...original(), price: 130 }, stamp);
  const changed = { ...plain(audited), price: 140, corrections: [...validHistory(), ...validHistory()] };
  const result = core.recordAppointmentCorrection(audited, changed, stamp2);
  assert.equal(result.corrections.length, 2);
  assert.deepEqual(plain(result.corrections[0]), plain(audited.corrections[0]));
  assert.equal(result.corrections[1].before.price, 130);
  assert.equal(result.corrections[1].after.price, 140);
});

test('building a failed-save candidate then retrying from original does not duplicate audit entries', () => {
  const before = original(), next = { ...original(), price: 140 };
  const failedCandidate = core.recordAppointmentCorrection(before, next, stamp);
  const retryCandidate = core.recordAppointmentCorrection(before, next, stamp2);
  assert.equal(failedCandidate.corrections.length, 1);
  assert.equal(retryCandidate.corrections.length, 1);
  assert.equal(Object.hasOwn(before, 'corrections'), false);
  assert.equal(Object.hasOwn(next, 'corrections'), false);
  assert.equal(retryCandidate.corrections[0].at, stamp2);
});

test('backup histories round-trip alongside expenses, preferences, and financial results', () => {
  const state = stateWith(), before = plain(state);
  const restored = core.validateState(state);
  assert.deepEqual(plain(restored), before);
  assert.deepEqual(plain(state), before);
  const report = sandbox.SalonFinance.report(restored, 'day', '2026-10-30');
  assert.equal(report.revenueCents, 15000);
  assert.equal(report.expenseCents, 2550);
  assert.equal(report.netCents, 12450);
  restored.appointments[0].corrections[0].before.services[0].name = 'Changed';
  assert.equal(state.appointments[0].corrections[0].before.services[0].name, 'Manichiură');
});

test('malformed correction arrays and events reject backup import', () => {
  for (const history of [null, {}, 'history', [null], [{}], [false], ['event'], Array(1001).fill(validHistory()[0])]) {
    assert.throws(() => core.validateState(stateWith(history)), String(history));
  }
  const presentUndefined = stateWith(); presentUndefined.appointments[0].corrections = undefined;
  assert.throws(() => core.validateState(presentUndefined));
});

test('event timestamps must be genuine canonical ISO timestamps and reason must be a bounded string', () => {
  for (const at of ['', 'recent', '2026-10-30', '2026-02-30T12:00:00.000Z', '2026-13-01T12:00:00.000Z', '2026-10-30T25:00:00.000Z', '2026-10-30T15:10:20Z', null, 123]) {
    const history = validHistory(); history[0].at = at;
    assert.throws(() => core.validateState(stateWith(history)), String(at));
  }
  for (const reason of [null, 0, false, {}, [], 'x'.repeat(1001)]) {
    const history = validHistory(); history[0].reason = reason;
    assert.throws(() => core.validateState(stateWith(history)), String(reason));
  }
  const history = validHistory(); history[0].reason = 'x'.repeat(1000);
  core.validateState(stateWith(history));
});

test('missing snapshots, malformed snapshot data and invalid legacy service durations reject import', () => {
  for (const side of ['before', 'after']) {
    for (const invalid of [null, {}, [], 'snapshot']) {
      const history = validHistory(); history[0][side] = invalid;
      assert.throws(() => core.validateState(stateWith(history)), side + '=' + String(invalid));
    }
    for (const changes of [{ date: '2026-02-30' }, { start: '24:00' }, { duration: 0 }, { duration: 60.5 }, { price: -1 }, { price: Infinity }, { status: 'unknown' }, { clientId: '' }, { notes: 123 }, { notes: 0 }, { notes: false }, { notes: null }, { services: [] }, { color: '#fff' }]) {
      const history = validHistory(); Object.assign(history[0][side], changes);
      assert.throws(() => core.validateState(stateWith(history)), side + JSON.stringify(changes));
    }
    const history = validHistory(); history[0][side].services[0].duration = 5.5;
    assert.throws(() => core.validateState(stateWith(history)));
  }
});

test('snapshots cannot contain recursive audit history', () => {
  for (const side of ['before', 'after']) {
    for (const extra of [{ corrections: [] }, { corrections: validHistory() }]) {
      const history = validHistory(); Object.assign(history[0][side], extra);
      assert.throws(() => core.validateState(stateWith(history)), side + JSON.stringify(extra));
    }
  }
});

test('imported snapshots strip unrelated persistence metadata from the restored audit records', () => {
  const history = validHistory();
  for (const side of ['before', 'after']) Object.assign(history[0][side], { id: 'nested', createdAt: stamp, updatedAt: stamp });
  const restored = core.validateState(stateWith(history));
  for (const side of ['before', 'after']) {
    const snapshot = restored.appointments[0].corrections[0][side];
    for (const key of ['id', 'createdAt', 'updatedAt', 'corrections']) assert.equal(Object.hasOwn(snapshot, key), false);
  }
});

test('backup validation rejects no-op audit events rather than presenting fabricated changes', () => {
  const history = validHistory();
  history[0].after = plain(history[0].before);
  assert.throws(() => core.validateState(stateWith(history)));
});

test('correction helper enforces the audit cap without changing the original record', () => {
  const full = { ...original(), corrections: Array.from({ length: 1000 }, () => plain(validHistory()[0])) };
  const before = plain(full);
  assert.throws(() => core.recordAppointmentCorrection(full, { ...plain(full), price: 200 }, stamp));
  assert.deepEqual(plain(full), before);
});
