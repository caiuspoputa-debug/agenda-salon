'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const Holidays=require('../app/src/main/assets/holidays.js');
const modulePath=require.resolve('../app/src/main/assets/holidays.js');
const names=date=>Holidays.forDate(date).map(holiday=>holiday.name);
const markedDates=year=>Holidays.forYear(year).map(entry=>entry.date);

test('browser and CommonJS expose the same frozen offline API with explicit coverage',()=>{
 assert.strictEqual(global.SalonHolidays,Holidays);
 assert(Object.isFrozen(Holidays));
 assert(Object.isFrozen(Holidays.supportedYears));
 assert.deepEqual(Holidays.supportedYears,[2026,2027]);
 const sandbox={};
 vm.runInNewContext(fs.readFileSync(modulePath,'utf8'),sandbox);
 assert.equal(sandbox.SalonHolidays.forDate('2027-05-02')[0].name,'Învierea Domnului (Sfintele Paști)');
});

test('2026 matches the verified national red-letter dates, excluding ordinary Sundays',()=>{
 const expected=[
  '01-01','01-06','01-07','01-30','02-02','03-25','04-05','04-12','04-13','04-14','04-17','04-23',
  '05-21','05-31','06-01','06-24','06-29','07-20','08-06','08-15','08-29','09-08','09-14','10-01',
  '10-14','10-26','10-27','11-08','11-21','11-30','12-06','12-07','12-25','12-26','12-27'
 ].map(date=>'2026-'+date);
 assert.deepEqual(markedDates(2026),expected);
 assert.equal(expected.length,35);
 assert.equal(Holidays.forYear(2026).reduce((count,entry)=>count+entry.holidays.length,0),36);
});

test('2027 includes all recurring feasts and the verified May Easter and June feasts',()=>{
 const expected=[
  '01-01','01-06','01-07','01-30','02-02','03-25','04-23','04-25','05-02','05-03','05-04','05-07',
  '05-21','06-10','06-20','06-21','06-24','06-29','07-20','08-06','08-15','08-29','09-08','09-14',
  '10-01','10-14','10-26','10-27','11-08','11-21','11-30','12-06','12-07','12-25','12-26','12-27'
 ].map(date=>'2027-'+date);
 assert.deepEqual(markedDates(2027),expected);
 assert.equal(expected.length,36);
 assert.equal(Holidays.forYear(2027).reduce((count,entry)=>count+entry.holidays.length,0),36);
});

test('all eight Pascha-relative dates remain attached to their correct civil days in each year',()=>{
 const expected={
  2026:['04-05','04-12','04-13','04-14','04-17','05-21','05-31','06-01'],
  2027:['04-25','05-02','05-03','05-04','05-07','06-10','06-20','06-21']
 };
 const expectedNames=[
  'Intrarea Domnului în Ierusalim (Floriile)','Învierea Domnului (Sfintele Paști)','A doua zi de Paști',
  'A treia zi de Paști','Izvorul Tămăduirii','Înălțarea Domnului','Pogorârea Sfântului Duh (Rusaliile)','Sfânta Treime'
 ];
 for(const year of [2026,2027]){
  const paschal=Holidays.forYear(year).flatMap(entry=>entry.holidays.filter(holiday=>holiday.kind==='paschal').map(holiday=>({date:entry.date,name:holiday.name})));
  assert.deepEqual(paschal.map(entry=>entry.date),expected[year].map(date=>year+'-'+date));
  assert.deepEqual(paschal.map(entry=>entry.name),expectedNames);
 }
});

test('the 2026 Ascension coincidence retains both names without a duplicate day or lost fixed feast',()=>{
 assert.deepEqual(Holidays.forDate('2026-05-21'),[
  {name:'Sfinții Constantin și Elena',kind:'fixed'},
  {name:'Înălțarea Domnului',kind:'paschal'}
 ]);
 assert.equal(Holidays.forYear(2026).filter(entry=>entry.date==='2026-05-21').length,1);
 assert.deepEqual(names('2027-05-21'),['Sfinții Constantin și Elena']);
 assert.deepEqual(names('2027-06-10'),['Înălțarea Domnului']);
});

test('ordinary Sundays, blue or black saint observances and the BRU-specific June feast are not added',()=>{
 for(const date of ['2026-01-04','2026-01-11','2026-01-18','2026-01-25','2026-07-05','2026-10-18','2026-06-02','2027-06-02','2026-10-15','2027-04-18','2027-05-09']){
  assert.deepEqual(Holidays.forDate(date),[],date);
 }
 assert.match(names('2026-12-07')[0],/Filofteia/);
 assert.match(names('2027-12-07')[0],/Filofteia/);
});

test('annual entries are sorted and unique with consistent frozen day lookups and nonempty labels',()=>{
 for(const year of [2026,2027]){
  const entries=Holidays.forYear(year);
  assert(Object.isFrozen(entries));
  assert.deepEqual(markedDates(year),[...new Set(markedDates(year))].sort());
  for(const entry of entries){
   assert(Object.isFrozen(entry));
   assert(Object.isFrozen(entry.holidays));
   assert.strictEqual(Holidays.forDate(entry.date),entry.holidays);
   assert(entry.holidays.length>0);
   for(const holiday of entry.holidays){assert(Object.isFrozen(holiday));assert(holiday.name.trim().length>0);assert(['fixed','paschal'].includes(holiday.kind));}
  }
 }
});

test('callers cannot mutate a holiday, annual entry, coverage or the shared empty result',()=>{
 const before=JSON.stringify(Holidays.forYear(2026));
 assert.throws(()=>Holidays.forDate('2026-10-14').push({name:'altered'}),TypeError);
 assert.throws(()=>{Holidays.forDate('2026-10-14')[0].name='altered';},TypeError);
 assert.throws(()=>{Holidays.forYear(2026)[0].date='2026-10-15';},TypeError);
 assert.throws(()=>Holidays.forYear(2026).pop(),TypeError);
 assert.throws(()=>Holidays.supportedYears.push(2028),TypeError);
 assert.throws(()=>Holidays.forDate('2026-10-15').push({name:'altered'}),TypeError);
 assert.equal(JSON.stringify(Holidays.forYear(2026)),before);
});

test('strict civil dates reject malformed values, rollover dates, leap days and unsupported years',()=>{
 for(const value of [null,undefined,20261014,{},[],new Date(),'', '2026-1-01','2026-01-1','2026-01-01T00:00:00Z',' 2026-01-01',
  '2026-00-01','2026-13-01','2026-01-00','2026-01-32','2026-02-29','2027-02-29','2026-04-31','2027-06-31',
  '2028-02-29','2025-12-25','2028-01-01','0000-01-01','__proto__'])assert.deepEqual(Holidays.forDate(value),[],String(value));
 for(const year of [undefined,null,'2026',2026.5,NaN,Infinity,2025,2028,0])assert.deepEqual(Holidays.forYear(year),[]);
});

test('December/January and leap validation cannot leak a feast into the previous or next day',()=>{
 assert.deepEqual(names('2026-12-31'),[]);
 assert.match(names('2027-01-01')[0],/Vasile/);
 assert.deepEqual(names('2027-01-02'),[]);
 assert.deepEqual(names('2026-02-28'),[]);
 assert.deepEqual(names('2026-03-01'),[]);
 assert.deepEqual(names('2027-12-31'),[]);
 assert.deepEqual(names('2028-01-01'),[]);
});

test('the same immutable civil-date calendar is produced across time zones including DST',()=>{
 const script='const h=require(process.argv[1]);process.stdout.write(JSON.stringify([h.forYear(2026),h.forYear(2027)]));';
 const expected=JSON.stringify([Holidays.forYear(2026),Holidays.forYear(2027)]);
 for(const timezone of ['UTC','Europe/Bucharest','America/Los_Angeles','Pacific/Kiritimati']){
  const result=spawnSync(process.execPath,['-e',script,modulePath],{encoding:'utf8',env:{...process.env,TZ:timezone}});
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout,expected,timezone);
 }
});
