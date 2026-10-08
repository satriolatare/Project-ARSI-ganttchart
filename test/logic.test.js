/* Node harness: loads utils.js, store.js, scheduler.js with a window/localStorage shim
   and validates calendar arithmetic + CPM critical path. Run: node test/logic.test.js */
'use strict';
const fs = require('fs');
const vm = require('vm');

const sandbox = {};
sandbox.window = sandbox;
sandbox.console = console;
sandbox.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] || null; },
  setItem(k, v) { this._d[k] = v; },
  removeItem(k) { delete this._d[k]; }
};
sandbox.global = sandbox;
vm.createContext(sandbox);

function load(f) { vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: f }); }
load('js/utils.js');
load('js/store.js');
load('js/scheduler.js');

const U = sandbox.GCAL;
const S = sandbox.Store;
const SCH = sandbox.Scheduler;

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ FAIL: ' + msg); } }
function eq(a, b, msg) { ok(String(a) === String(b), `${msg} (got ${a}, want ${b})`); }

const CAL = { weekendDays: [0, 6], holidays: [] };

console.log('\n== Calendar arithmetic ==');
eq(U.dayOfWeek('2026-05-04'), 1, '2026-05-04 is Monday');
eq(U.fmtDate(U.addWorkingDays('2026-05-04', 4, CAL)), '2026-05-08', 'addWorkingDays Mon+4 = Fri');
eq(U.fmtDate(U.addWorkingDays('2026-05-04', 5, CAL)), '2026-05-11', 'addWorkingDays Mon+5 = next Mon');
eq(U.fmtDate(U.addWorkingDays('2026-05-08', 1, CAL)), '2026-05-11', 'Fri+1 = Mon');
eq(U.diffWorkingDays('2026-05-04', '2026-05-08', CAL), 4, 'diffWorkingDays Mon..Fri = 4');
eq(U.diffWorkingDays('2026-05-04', '2026-05-04', CAL), 0, 'diff same day = 0');
eq(U.countWorkingDaysInclusive('2026-05-04', '2026-05-08', CAL), 5, 'inclusive working days Mon..Fri = 5');
const CAL2 = { weekendDays: [0, 6], holidays: ['2026-05-06'] };
eq(U.fmtDate(U.addWorkingDays('2026-05-04', 2, CAL2)), '2026-05-07', 'holiday excluded (Mon+2 skips Wed holiday)');
ok(!U.isWorkingDay('2026-05-06', CAL2), 'holiday is non-working');
ok(U.isWorkingDay('2026-05-06', CAL), 'same day working without holiday list');

console.log('\n== Store seed + CPM (leaf expansion, holidays) ==');
S.seedDemo();
const model = SCH.scheduleList(S);
const rows = model.rows;
const byName = {}; rows.forEach(r => { byName[r.task.name] = r; });
console.log('  project:', U.fmtDate(model.res.projectStart), '->', U.fmtDate(model.res.projectEnd));
rows.forEach(r => {
  console.log(`   ${r.isSummary ? '[S]' : '   '} ${r.task.name.padEnd(24)} ES=${U.fmtDate(r.ES)} EF=${U.fmtDate(r.EF)} LS=${U.fmtDate(r.LS)} LF=${U.fmtDate(r.LF)} slack=${r.slack}${r.critical ? ' *CRIT*' : ''}`);
});

ok(!model.res.cyclic, 'no dependency cycle');

// leaves of summary
const sa = byName['Analisis Stakeholder'];
const sb = byName['Kaji Sistem Berjalan'];
const summary = byName['Analisis Kebutuhan'];
eq(U.fmtDate(sa.ES), '2026-05-04', 'Analisis Stakeholder ES = Mon 2026-05-04');
eq(U.fmtDate(sa.EF), '2026-05-06', 'Analisis Stakeholder dur3 EF = Wed');
eq(U.fmtDate(sb.ES), '2026-05-07', 'Kaji FS after Stakeholder -> Thu');
eq(U.fmtDate(sb.EF), '2026-05-11', 'Kaji dur3 EF = Mon');
eq(U.fmtDate(summary.ES), '2026-05-04', 'Summary ES = min child ES');
eq(U.fmtDate(summary.EF), '2026-05-11', 'Summary EF = max child EF');
ok(summary.isSummary, 'Analisis Kebutuhan recognized as summary');

// leaf depending on SUMMARY sees summary finish (the bug that was fixed)
const uiux = byName['Desain UI/UX'];
eq(U.fmtDate(uiux.ES), '2026-05-12', 'Desain UI/UX FS after summary EF (5/11) = Tue 5/12');

// Backend FS after DBD
const dbd = byName['Desain Basis Data'];
const backend = byName['Pengembangan Backend'];
eq(U.fmtDate(dbd.ES), '2026-05-12', 'DBD FS after summary');
eq(U.fmtDate(dbd.EF), '2026-05-15', 'DBD dur4 EF = Fri');
eq(U.fmtDate(backend.ES), '2026-05-18', 'Backend FS after DBD -> Mon');
eq(U.fmtDate(backend.EF), '2026-05-29', 'Backend dur10 EF = Fri 5/29');

// SS lag
const frontend = byName['Pengembangan Frontend'];
eq(U.fmtDate(frontend.ES), U.fmtDate(U.addWorkingDays(uiux.ES, 2, CAL)), 'Frontend SS+2 = UI/UX start + 2 wd');
eq(U.fmtDate(frontend.ES), '2026-05-14', 'Frontend SS+2 ES = Thu 5/14');

// holiday awareness: 2026-06-01 is a seeded holiday (Monday)
const api = byName['Integrasi API'];
eq(U.fmtDate(api.ES), '2026-06-02', 'Integrasi FS after Backend skips Mon 6/1 holiday -> Tue 6/2');
const qa = byName['Pengujian & QA'];
const deploy = byName['Deployment & Pelatihan'];
eq(U.fmtDate(deploy.EF), U.fmtDate(model.res.projectEnd), 'Deployment finish = project end');
eq(U.fmtDate(model.res.projectEnd), '2026-06-17', 'project end = 2026-06-17');

// critical path invariants
rows.filter(r => r.critical).forEach(r => ok(r.slack === 0, `critical ${r.task.name} slack==0`));
rows.filter(r => !r.critical).forEach(r => ok(r.slack > 0, `non-critical ${r.task.name} slack>0`));
ok(byName['Pengembangan Backend'].critical, 'Backend on critical path');
ok(byName['Deployment & Pelatihan'].critical, 'Deployment on critical path');
ok(!uiux.critical, 'UI/UX not critical (has slack)');

// structural invariants
rows.filter(r => !r.isSummary).forEach(r => ok(U.compare(r.EF, r.ES) >= 0, `${r.task.name} EF>=ES`));
rows.forEach(r => ok(U.compare(model.res.projectEnd, r.EF) >= 0, `projectEnd>=${r.task.name}`));
rows.forEach(r => ok(U.compare(r.LS, r.ES) >= 0 || r.slack === 0, `${r.task.name} LS>=ES when slack 0`));

console.log('\n== Cycle detection (summary-aware) ==');
const t1a = sa.task, t8 = deploy.task;
ok(SCH.wouldCreateCycle(S, t1a.id, t8.id) === true, 't8 -> stakeholder creates cycle');
ok(SCH.wouldCreateCycle(S, t8.id, t1a.id) === false, 'stakeholder -> t8 is not a cycle');
ok(SCH.wouldCreateCycle(S, summary.task.id, t8.id) === true, 't8 -> summary creates cycle (via leaves)');
ok(SCH.wouldCreateCycle(S, backend.task.id, deploy.task.id) === true, 'deploy -> backend creates cycle');
ok(SCH.wouldCreateCycle(S, deploy.task.id, backend.task.id) === false, 'backend -> deploy is not a cycle');

console.log('\n== Calendar change recomputes schedule ==');
S.toggleWeekendDay(1); // make Monday a weekend too
const m2 = SCH.scheduleList(S);
ok(U.compare(m2.res.projectEnd, model.res.projectEnd) > 0, 'project end pushed later when Mondays off');
S.toggleWeekendDay(1); // restore

console.log('\n== Holiday add shifts schedule ==');
S.addHoliday('2026-05-18'); // the day backend starts
const m3 = SCH.scheduleList(S);
ok(U.compare(byNameLookup(m3.rows, 'Pengembangan Backend').ES, backend.ES) > 0, 'backend start shifts after adding 5/18 holiday');
S.removeHoliday('2026-05-18');

function byNameLookup(rowsArr, name) { return rowsArr.find(r => r.task.name === name); }

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
