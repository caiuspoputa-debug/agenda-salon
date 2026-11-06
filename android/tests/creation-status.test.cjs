'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
require('../app/src/main/assets/app.js');
const core = global.SalonCore;
const clone = value => JSON.parse(JSON.stringify(value));
const statuses = ['pending', 'confirmed', 'completed', 'cancelled', 'no-show'];
function fixture() {
  const state = core.createDemo('2026-11-05');
  state.demo = false;
  state.appointments = [];
  state.settings.workspace.salonName = 'Salon personalizat păstrat';
  state.services[0].name = 'Serviciu editat păstrat';
  state.services[0].price = 137.5;
  return state;
}
function booking(status = 'confirmed') {
  return {id: 'creation-test', clientId: 'c1', date: '2026-11-05', start: '10:00',
    duration: 45, price: 137.5, status, notes: 'Observație păstrată',
    services: [{serviceId: 's1', name: 'Serviciu editat păstrat', price: 137.5, color: '#79536e'}],
    createdAt: '2026-11-05T08:00:00.000Z', updatedAt: '2026-11-05T08:00:00.000Z'};
}

for (const status of statuses) {
  test('new booking ' + status + ' is ' + (['pending', 'confirmed'].includes(status) ? 'allowed' : 'rejected before persistence'), () => {
    const state = fixture(), before = clone(state), candidate = booking(status), original = clone(candidate);
    const result = core.validateAppointment(candidate, state);
    assert.equal(result.valid, ['pending', 'confirmed'].includes(status));
    if (!result.valid) assert(result.errors.some(message => message.includes('O programare nouă')));
    assert.deepEqual(state, before);
    assert.deepEqual(candidate, original);
  });
}

test('existing booking may transition from every historical state to every supported status', () => {
  for (const oldStatus of statuses) for (const nextStatus of statuses) {
    const state = fixture(), original = booking(oldStatus);
    state.appointments = [original];
    const before = clone(state), result = core.validateAppointment({...clone(original), status: nextStatus}, state);
    assert.equal(result.valid, true, oldStatus + ' -> ' + nextStatus);
    assert.deepEqual(state, before, 'Validation must preserve historical records');
  }
});

test('backup import and reload preserve all five statuses and custom settings exactly', () => {
  const state = fixture();
  state.appointments = statuses.map((status, index) => ({...booking(status), id: 'old-' + status,
    date: core.addDays('2026-11-05', index)}));
  const before = clone(state);
  assert.deepEqual(core.validateState(JSON.parse(JSON.stringify(state))), before);
  assert.deepEqual(state, before);
});

test('invalid and prototype statuses stay rejected for both new and existing records', () => {
  for (const status of ['unknown', '', 'constructor', '__proto__', null]) {
    const state = fixture();
    assert.equal(core.validateAppointment(booking(status), state).valid, false, String(status));
    state.appointments = [booking('confirmed')];
    assert.equal(core.validateAppointment(booking(status), state).valid, false, String(status));
  }
});
