/* Headless smoke test: boots index.html in jsdom, visits every tab, opens modals,
   and asserts the app renders without runtime errors. Run: node test/ui.smoke.js */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const errors = [];

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  resources: undefined,
  url: 'http://localhost/',
  pretendToBeVisual: true,
  beforeParse(window) {
    // URL.createObjectURL used only on export; stub it
    window.URL.createObjectURL = () => 'blob:stub';
    window.onerror = (msg, src, line, col, err) => { errors.push((err && err.stack) || msg); };
    window.addEventListener('error', e => { errors.push(e.error ? e.error.stack : e.message); });
  }
});

const { window } = dom;
const { document } = window;

// Manually execute the scripts in order (jsdom won't fetch external src without resources loader)
function runScript(rel) {
  const code = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const s = document.createElement('script');
  s.textContent = code;
  document.body.appendChild(s);
}

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ FAIL: ' + msg); } }

try {
  ['js/utils.js', 'js/store.js', 'js/scheduler.js', 'js/gantt.js', 'js/pert.js', 'js/app.js'].forEach(runScript);
  // fire DOMContentLoaded
  const ev = window.document.createEvent('Event');
  ev.initEvent('DOMContentLoaded', true, true);
  window.document.dispatchEvent(ev);
} catch (e) {
  errors.push(e.stack || String(e));
}

console.log('\n== Boot ==');
ok(errors.length === 0, 'app booted with no uncaught errors');
if (errors.length) { console.log('  Errors:'); errors.forEach(e => console.log('   ' + e)); }

const tabs = document.querySelectorAll('#tabs .tab');
ok(tabs.length === 5, 'has 5 tabs (got ' + tabs.length + ')');
ok(!!document.querySelector('.project-name-input'), 'project name input rendered');
ok(document.querySelector('.project-name-input').value.length > 0, 'project name populated from seed');

console.log('\n== Visit each tab ==');
['gantt', 'tasks', 'resources', 'calendar', 'analysis'].forEach(tab => {
  const before = errors.length;
  const btn = document.querySelector(`[data-tab="${tab}"]`);
  btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const main = document.querySelector('#main');
  ok(errors.length === before, `tab "${tab}" rendered without error`);
  ok(main.innerHTML.trim().length > 50, `tab "${tab}" produced content`);
});

console.log('\n== Gantt rendered ==');
document.querySelector('[data-tab="gantt"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok(!!document.querySelector('.gantt-wrap'), 'gantt wrap present');
ok(document.querySelectorAll('.gantt-bar').length > 0, 'gantt bars drawn (' + document.querySelectorAll('.gantt-bar').length + ')');
ok(document.querySelectorAll('.gantt-arrow').length > 0, 'dependency arrows drawn (' + document.querySelectorAll('.gantt-arrow').length + ')');
ok(document.querySelectorAll('.gantt-left-row').length > 0, 'left task table rows present');

console.log('\n== Tasks table + open modal ==');
document.querySelector('[data-tab="tasks"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const taskRows = document.querySelectorAll('#task-table tbody tr[data-id]');
ok(taskRows.length >= 8, 'tasks table lists seeded tasks (' + taskRows.length + ')');
// open first task modal
taskRows[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok(!!document.querySelector('.modal'), 'task modal opened');
ok(!!document.querySelector('#f-name'), 'modal has name field');
// close modal
document.querySelector('.modal-close').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok(!document.querySelector('.modal'), 'task modal closed');

console.log('\n== Add task modal -> save new task ==');
const S = window.Store;
const countBefore = S.getState().tasks.length;
document.querySelector('[data-tab="tasks"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
document.querySelector('#btn-add').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
document.querySelector('#f-name').value = 'Tugas Uji Baru';
document.querySelector('#f-duration').value = '4';
document.querySelector('#btn-save-task').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok(S.getState().tasks.length === countBefore + 1, 'new task added to store');
const added = S.getState().tasks.find(t => t.name === 'Tugas Uji Baru');
ok(!!added && added.duration === 4, 'new task persisted with duration 4');

console.log('\n== Resources tab ==');
document.querySelector('[data-tab="resources"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok(document.querySelectorAll('#res-table tbody tr').length >= 5, 'resources listed');
ok(document.querySelectorAll('.alloc-row').length > 0, 'allocation rows present');
// add a resource
const resBefore = S.getState().resources.length;
document.querySelector('#btn-add-res').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
document.querySelector('#r-name').value = 'Uji Resource';
document.querySelector('#btn-save-res').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok(S.getState().resources.length === resBefore + 1, 'resource added');

console.log('\n== Calendar tab ==');
document.querySelector('[data-tab="calendar"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok(document.querySelectorAll('[data-dow]').length === 7, 'weekend has 7 day toggles');
ok(document.querySelectorAll('.mini-cal-cell').length >= 28, 'month preview calendar rendered');
// toggle a weekend day
const monToggle = document.querySelector('[data-dow="1"]');
const wasChecked = monToggle.checked;
monToggle.checked = !wasChecked;
monToggle.dispatchEvent(new window.Event('change', { bubbles: true }));
ok(S.getState().calendar.weekendDays.indexOf(1) !== -1 === !wasChecked, 'Monday weekend toggled in state');
monToggle.checked = wasChecked;
monToggle.dispatchEvent(new window.Event('change', { bubbles: true }));
// add holiday
const holBefore = S.getState().calendar.holidays.length;
document.querySelector('#holiday-date').value = '2026-07-17';
document.querySelector('#btn-add-holiday').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok(S.getState().calendar.holidays.length === holBefore + 1, 'holiday added');

console.log('\n== Analysis tab ==');
document.querySelector('[data-tab="analysis"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok(document.querySelectorAll('.stat-card').length === 5, '5 stat cards rendered');
ok(!!document.querySelector('#pert-container .pert-svg'), 'PERT diagram rendered');
ok(document.querySelectorAll('.pert-node').length > 0, 'PERT nodes present (' + document.querySelectorAll('.pert-node').length + ')');
ok(document.querySelectorAll('.pert-edge').length > 0, 'PERT edges present (' + document.querySelectorAll('.pert-edge').length + ')');

console.log('\n== Summary ==');
ok(errors.length === 0, 'no runtime errors after full walkthrough');
if (errors.length) { console.log('  Late errors:'); errors.forEach(e => console.log('   ' + e)); }

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
