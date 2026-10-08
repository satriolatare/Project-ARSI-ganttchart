/* =========================================================================
 * store.js — application state, CRUD operations, persistence
 * ========================================================================= */
(function (global) {
  'use strict';

  const U = global.GCAL;
  const { uid, deepClone, fmtDate, addDays } = U;

  const STORAGE_KEY = 'gantt_pm_app_v1';

  const PRIORITIES = {
    low:      { id: 'low',      label: 'Rendah',  color: '#4ea1f3' },
    medium:   { id: 'medium',   label: 'Sedang',   color: '#f4b740' },
    high:     { id: 'high',     label: 'Tinggi',   color: '#f37748' },
    critical: { id: 'critical', label: 'Kritis',   color: '#e0455a' }
  };

  const LINK_TYPES = {
    FS: { id: 'FS', label: 'Finish-to-Start (FS)', desc: 'Suksesor mulai setelah pendahulu selesai' },
    SS: { id: 'SS', label: 'Start-to-Start (SS)',  desc: 'Suksesor mulai bersamaan dengan pendahulu' }
  };

  // ---- state ------------------------------------------------------------
  let state = null;
  const listeners = [];

  function defaultState() {
    return {
      project: {
        name: 'Proyek Contoh',
        startDate: fmtDate(new Date()),
        description: ''
      },
      calendar: {
        weekendDays: [0, 6],       // 0=Minggu .. 6=Sabtu
        holidays: []               // 'YYYY-MM-DD'
      },
      resources: [],
      tasks: [],
      settings: { zoom: 'week', showWeekendShade: true }
    };
  }

  // ---- persistence ------------------------------------------------------
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Gagal menyimpan ke localStorage', e);
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        state = migrate(parsed);
        return true;
      }
    } catch (e) {
      console.warn('Gagal memuat dari localStorage', e);
    }
    return false;
  }

  function migrate(s) {
    const base = defaultState();
    s = Object.assign(base, s || {});
    s.project = Object.assign(defaultState().project, s.project || {});
    s.calendar = Object.assign(defaultState().calendar, s.calendar || {});
    s.settings = Object.assign(defaultState().settings, s.settings || {});
    s.resources = s.resources || [];
    s.tasks = s.tasks || [];
    // normalise tasks
    s.tasks.forEach(t => {
      t.predecessors = t.predecessors || [];
      t.resources = t.resources || [];
      t.progress = typeof t.progress === 'number' ? t.progress : 0;
      t.collapsed = !!t.collapsed;
    });
    return s;
  }

  function reset() { state = defaultState(); }
  function replaceState(s) { state = migrate(s); }

  function getState() { return state; }

  function onChange(fn) { listeners.push(fn); }
  function emit(evt) {
    save();
    listeners.forEach(fn => fn(evt || {}));
  }

  // ---- task helpers -----------------------------------------------------
  function getTask(id) { return state.tasks.find(t => t.id === id) || null; }
  function getParent(task) { return task && task.parentId ? getTask(task.parentId) : null; }
  function getChildren(id) { return state.tasks.filter(t => t.parentId === id); }
  function isSummary(task) { return state.tasks.some(t => t.parentId === task.id); }

  function getDepth(task) {
    let d = 0, cur = task;
    while (cur && cur.parentId) { d++; cur = getTask(cur.parentId); if (d > 50) break; }
    return d;
  }

  // Ordered list of tasks (hierarchical, depth-first) — used for tables & Gantt rows.
  function getTaskTree() {
    const roots = state.tasks.filter(t => !t.parentId || !getTask(t.parentId));
    const out = [];
    function walk(list, depth) {
      list.forEach(t => {
        out.push({ task: t, depth });
        const kids = getChildren(t.id).sort((a, b) => (a.order || 0) - (b.order || 0));
        walk(kids, depth + 1);
      });
    }
    walk(roots.sort((a, b) => (a.order || 0) - (b.order || 0)), 0);
    return out;
  }

  // ancestors from root -> parent
  function getAncestors(task) {
    const chain = [];
    let cur = getTask(task.parentId);
    let guard = 0;
    while (cur && guard++ < 50) { chain.unshift(cur); cur = getTask(cur.parentId); }
    return chain;
  }

  // Effective predecessors: own + inherited from all ancestors.
  function getEffectivePredecessors(task) {
    const seen = new Set();
    const list = [];
    const push = (pred) => {
      if (pred && !seen.has(pred.taskId)) { seen.add(pred.taskId); list.push(pred); }
    };
    getAncestors(task).forEach(a => a.predecessors.forEach(push));
    task.predecessors.forEach(push);
    return list;
  }

  // ---- task CRUD --------------------------------------------------------
  function createTask(data) {
    data = data || {};
    const t = {
      id: uid('task'),
      name: data.name || 'Tugas Baru',
      description: data.description || '',
      startDate: data.startDate || fmtDate(new Date()),
      duration: typeof data.duration === 'number' ? data.duration : 1,
      priority: data.priority || 'medium',
      color: data.color || PRIORITIES[data.priority || 'medium'].color,
      progress: data.progress || 0,
      parentId: data.parentId || null,
      predecessors: data.predecessors || [],
      resources: data.resources || [],
      collapsed: false,
      order: data.order != null ? data.order : state.tasks.length
    };
    state.tasks.push(t);
    emit({ type: 'task:create', id: t.id });
    return t;
  }

  function updateTask(id, patch) {
    const t = getTask(id);
    if (!t) return null;
    Object.assign(t, patch);
    // if priority changed and color still matches old default, follow priority color
    emit({ type: 'task:update', id });
    return t;
  }

  function deleteTask(id, recursive) {
    const t = getTask(id);
    if (!t) return;
    const children = getChildren(id);
    if (children.length) {
      if (recursive !== false) {
        children.forEach(c => deleteTask(c.id, true));
      } else {
        // re-parent children to this task's parent
        children.forEach(c => { c.parentId = t.parentId; });
      }
    }
    // remove predecessor references to this task
    state.tasks.forEach(o => {
      o.predecessors = o.predecessors.filter(p => p.taskId !== id);
    });
    state.tasks = state.tasks.filter(o => o.id !== id);
    emit({ type: 'task:delete', id });
  }

  function moveTask(id, newParentId) {
    const t = getTask(id);
    if (!t) return;
    // prevent moving into own descendant
    let cur = getTask(newParentId);
    let guard = 0;
    while (cur && guard++ < 50) {
      if (cur.id === id) return;
      cur = getTask(cur.parentId);
    }
    t.parentId = newParentId || null;
    emit({ type: 'task:update', id });
  }

  function addPredecessor(taskId, pred) {
    const t = getTask(taskId);
    if (!t) return;
    const exists = t.predecessors.find(p => p.taskId === pred.taskId && p.type === pred.type);
    if (exists) { exists.lag = pred.lag || 0; }
    else t.predecessors.push({ taskId: pred.taskId, type: pred.type || 'FS', lag: pred.lag || 0 });
    emit({ type: 'task:update', id: taskId });
  }

  function removePredecessor(taskId, predTaskId) {
    const t = getTask(taskId);
    if (!t) return;
    t.predecessors = t.predecessors.filter(p => p.taskId !== predTaskId);
    emit({ type: 'task:update', id: taskId });
  }

  // ---- resource CRUD ----------------------------------------------------
  function getResource(id) { return state.resources.find(r => r.id === id) || null; }

  function createResource(data) {
    data = data || {};
    const r = {
      id: uid('res'),
      name: data.name || 'Anggota Baru',
      email: data.email || '',
      role: data.role || '',
      salary: typeof data.salary === 'number' ? data.salary : 0, // gaji per bulan (IDR)
      capacity: typeof data.capacity === 'number' ? data.capacity : 100 // % kapasitas
    };
    state.resources.push(r);
    emit({ type: 'resource:create', id: r.id });
    return r;
  }

  function updateResource(id, patch) {
    const r = getResource(id);
    if (!r) return null;
    Object.assign(r, patch);
    emit({ type: 'resource:update', id });
    return r;
  }

  function deleteResource(id) {
    state.resources = state.resources.filter(r => r.id !== id);
    state.tasks.forEach(t => { t.resources = t.resources.filter(x => x !== id); });
    emit({ type: 'resource:delete', id });
  }

  function assignResource(taskId, resourceId) {
    const t = getTask(taskId);
    if (!t) return;
    if (t.resources.indexOf(resourceId) === -1) t.resources.push(resourceId);
    emit({ type: 'task:update', id: taskId });
  }

  function unassignResource(taskId, resourceId) {
    const t = getTask(taskId);
    if (!t) return;
    t.resources = t.resources.filter(x => x !== resourceId);
    emit({ type: 'task:update', id: taskId });
  }

  // ---- calendar ---------------------------------------------------------
  function toggleWeekendDay(dow) {
    const i = state.calendar.weekendDays.indexOf(dow);
    if (i === -1) state.calendar.weekendDays.push(dow);
    else state.calendar.weekendDays.splice(i, 1);
    state.calendar.weekendDays.sort();
    emit({ type: 'calendar:update' });
  }

  function addHoliday(dateStr) {
    const s = fmtDate(dateStr);
    if (state.calendar.holidays.indexOf(s) === -1) {
      state.calendar.holidays.push(s);
      state.calendar.holidays.sort();
      emit({ type: 'calendar:update' });
    }
  }

  function removeHoliday(dateStr) {
    state.calendar.holidays = state.calendar.holidays.filter(h => h !== dateStr);
    emit({ type: 'calendar:update' });
  }

  // ---- import / export --------------------------------------------------
  function exportJSON() { return JSON.stringify(state, null, 2); }

  function importJSON(str) {
    const s = JSON.parse(str);
    replaceState(s);
    emit({ type: 'import' });
  }

  // ---- demo seed --------------------------------------------------------
  function seedDemo() {
    state = defaultState();
    state.project.name = 'Pengembangan Sistem Informasi ARSI';
    state.calendar.holidays = ['2026-06-01', '2026-08-17', '2026-12-25'];

    const R = [
      { name: 'Andi Pratama',  email: 'andi@arsi.id',   role: 'Project Manager',   salary: 18000000 },
      { name: 'Budi Santoso',  email: 'budi@arsi.id',   role: 'Backend Engineer',  salary: 15000000 },
      { name: 'Citra Dewi',    email: 'citra@arsi.id',  role: 'Frontend Engineer', salary: 14000000 },
      { name: 'Dodi Kurniawan',email: 'dodi@arsi.id',   role: 'UI/UX Designer',    salary: 12000000 },
      { name: 'Eka Wulandari', email: 'eka@arsi.id',    role: 'QA Engineer',       salary: 11000000 }
    ].map(createResource);

    const start = '2026-05-04'; // Senin

    // "Analisis Kebutuhan" is a SUMMARY with two leaf children.
    // Children start at project start; downstream tasks reference the summary.
    const t1 = createTask({ name: 'Analisis Kebutuhan',   duration: 0, startDate: start, priority: 'high',    parentId: null, resources: [] });
    const t1a = createTask({ name: 'Analisis Stakeholder', duration: 3, startDate: start, priority: 'high',    parentId: t1.id, resources: [R[0].id, R[3].id] });
    const t1b = createTask({ name: 'Kaji Sistem Berjalan', duration: 3, startDate: '',    priority: 'medium', parentId: t1.id, resources: [R[3].id] });

    const t2 = createTask({ name: 'Desain UI/UX',         duration: 5, startDate: '',   priority: 'medium',  resources: [R[3].id] });
    const t3 = createTask({ name: 'Desain Basis Data',    duration: 4, startDate: '',   priority: 'high',    resources: [R[1].id] });
    const t4 = createTask({ name: 'Pengembangan Backend', duration: 10, startDate: '',  priority: 'critical',resources: [R[1].id] });
    const t5 = createTask({ name: 'Pengembangan Frontend',duration: 8, startDate: '',  priority: 'medium',  resources: [R[2].id] });
    const t6 = createTask({ name: 'Integrasi API',        duration: 4, startDate: '',  priority: 'high',    resources: [R[1].id, R[2].id] });
    const t7 = createTask({ name: 'Pengujian & QA',       duration: 5, startDate: '',  priority: 'high',    resources: [R[4].id] });
    const t8 = createTask({ name: 'Deployment & Pelatihan', duration: 3, startDate: '', priority: 'critical', resources: [R[0].id, R[4].id] });

    // within the summary
    addPredecessor(t1b.id, { taskId: t1a.id, type: 'FS', lag: 0 });
    // downstream (t1 is a summary -> expanded to its leaf children)
    addPredecessor(t2.id, { taskId: t1.id, type: 'FS', lag: 0 });
    addPredecessor(t3.id, { taskId: t1.id, type: 'FS', lag: 0 });
    addPredecessor(t4.id, { taskId: t3.id, type: 'FS', lag: 0 });
    addPredecessor(t5.id, { taskId: t2.id, type: 'SS', lag: 2 });
    addPredecessor(t6.id, { taskId: t4.id, type: 'FS', lag: 0 });
    addPredecessor(t6.id, { taskId: t5.id, type: 'FS', lag: 0 });
    addPredecessor(t7.id, { taskId: t6.id, type: 'FS', lag: 0 });
    addPredecessor(t8.id, { taskId: t7.id, type: 'FS', lag: 0 });

    save();
    emit({ type: 'seed' });
  }

  function ensureSeed() {
    if (!load() || !state.tasks.length) seedDemo();
  }

  // ---- public API -------------------------------------------------------
  global.Store = {
    PRIORITIES, LINK_TYPES,
    ensureSeed, seedDemo, reset, getState, replaceState, save, onChange, emit,
    getTask, getParent, getChildren, isSummary, getDepth, getTaskTree,
    getAncestors, getEffectivePredecessors,
    createTask, updateTask, deleteTask, moveTask, addPredecessor, removePredecessor,
    getResource, createResource, updateResource, deleteResource, assignResource, unassignResource,
    toggleWeekendDay, addHoliday, removeHoliday,
    exportJSON, importJSON
  };
})(window);
