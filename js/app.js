/* =========================================================================
 * app.js — main application: tabs, panels, modals, event wiring
 * ========================================================================= */
(function (global) {
  'use strict';

  const U = global.GCAL;
  const S = global.Store;
  const SCH = global.Scheduler;
  const Gantt = global.Gantt;
  const PERT = global.PERT;
  const {
    fmtDate, parseDate, escapeHtml, formatCurrency, formatNumber,
    dayNameFull, monthNameFull, isWorkingDay, isHoliday, addDays
  } = U;

  let currentTab = 'gantt';
  let selectedTaskId = null;

  // =========================================================================
  // BOOTSTRAP
  // =========================================================================
  function init() {
    S.ensureSeed();
    buildShell();
    S.onChange(() => render());
    render();
    window.addEventListener('resize', debounce(() => render(), 200));
  }

  function debounce(fn, ms) {
    let t; return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  function buildShell() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <header class="topbar">
        <div class="brand">
          <span class="logo">◧</span>
          <div class="brand-text">
            <input id="project-name" class="project-name-input" spellcheck="false" />
            <span class="project-sub" id="project-sub"></span>
          </div>
        </div>
        <nav class="tabs" id="tabs">
          <button data-tab="gantt" class="tab active">Gantt Chart</button>
          <button data-tab="tasks" class="tab">Tugas</button>
          <button data-tab="resources" class="tab">Tim &amp; Sumber Daya</button>
          <button data-tab="calendar" class="tab">Kalender</button>
          <button data-tab="analysis" class="tab">Analisis</button>
        </nav>
        <div class="topbar-actions">
          <button id="btn-add-task" class="btn btn-primary">+ Tugas</button>
          <div class="dropdown">
            <button id="btn-more" class="btn btn-ghost">⚙ ▾</button>
            <div class="dropdown-menu" id="more-menu">
              <button data-act="export">Ekspor JSON</button>
              <button data-act="import">Impor JSON</button>
              <button data-act="reset-demo">Muat Ulang Contoh</button>
              <button data-act="reset-blank">Kosongkan Proyek</button>
            </div>
          </div>
        </div>
      </header>
      <main id="main"></main>
      <div id="modal-root"></div>
      <input type="file" id="import-file" accept="application/json" style="display:none" />
    `;

    // tabs
    app.querySelector('#tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]'); if (!b) return;
      currentTab = b.dataset.tab;
      app.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === b));
      render();
    });

    // project name
    const pname = app.querySelector('#project-name');
    pname.addEventListener('change', () => {
      S.getState().project.name = pname.value || 'Proyek Tanpa Nama';
      S.emit({ type: 'project' });
    });

    // add task
    app.querySelector('#btn-add-task').addEventListener('click', () => openTaskModal(null));

    // more menu
    const menu = app.querySelector('#more-menu');
    app.querySelector('#btn-more').addEventListener('click', (e) => {
      e.stopPropagation(); menu.classList.toggle('open');
    });
    document.addEventListener('click', () => menu.classList.remove('open'));
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      menu.classList.remove('open');
      handleMenu(b.dataset.act);
    });

    app.querySelector('#import-file').addEventListener('change', onImportFile);
  }

  function handleMenu(act) {
    if (act === 'export') {
      const blob = new Blob([S.exportJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (S.getState().project.name || 'proyek').replace(/\s+/g, '_') + '.json';
      a.click();
    } else if (act === 'import') {
      document.getElementById('import-file').click();
    } else if (act === 'reset-demo') {
      if (confirm('Muat ulang data contoh? Perubahan saat ini akan hilang.')) { S.seedDemo(); }
    } else if (act === 'reset-blank') {
      if (confirm('Kosongkan seluruh proyek?')) { S.reset(); S.emit({ type: 'reset' }); }
    }
  }

  function onImportFile(e) {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { try { S.importJSON(rd.result); } catch (err) { alert('Gagal impor: ' + err.message); } };
    rd.readAsText(f);
    e.target.value = '';
  }

  // =========================================================================
  // RENDER DISPATCH
  // =========================================================================
  function computeModel() {
    const { res, rows } = SCH.scheduleList(S);
    const byId = res.byId;
    const resById = {};
    S.getState().resources.forEach(r => { resById[r.id] = r; });
    return { rows, res, byId, resById, calendar: S.getState().calendar, today: parseDate(fmtDate(new Date())) };
  }

  function render() {
    const st = S.getState();
    document.getElementById('project-name').value = st.project.name;
    const model = computeModel();
    const dur = model.res.projectEnd && model.res.projectStart
      ? U.diffWorkingDays(model.res.projectStart, model.res.projectEnd, st.calendar) + 1 : 0;
    document.getElementById('project-sub').textContent =
      model.res.projectStart ? `Durasi ${dur} hari kerja · ${st.tasks.length} tugas · ${st.resources.length} anggota` : '';

    const main = document.getElementById('main');
    if (currentTab === 'gantt') renderGantt(main, model);
    else if (currentTab === 'tasks') renderTasks(main, model);
    else if (currentTab === 'resources') renderResources(main, model);
    else if (currentTab === 'calendar') renderCalendar(main, model);
    else if (currentTab === 'analysis') renderAnalysis(main, model);
  }

  // =========================================================================
  // TAB: GANTT
  // =========================================================================
  function renderGantt(main, model) {
    const st = S.getState();
    main.innerHTML = `
      <div class="toolbar">
        <div class="toolbar-group">
          <label>Zoom</label>
          <select id="zoom-select">
            <option value="day">Harian</option>
            <option value="week">Mingguan</option>
            <option value="month">Bulanan</option>
            <option value="quarter">Kuartalan</option>
          </select>
        </div>
        <div class="toolbar-group">
          <label class="chk"><input type="checkbox" id="chk-shade" ${st.settings.showWeekendShade ? 'checked' : ''}/> Tampilkan akhir pekan/libur</label>
        </div>
        <div class="toolbar-group legend">
          ${Object.values(S.PRIORITIES).map(p => `<span class="legend-item"><span class="pri-dot" style="background:${p.color}"></span>${p.label}</span>`).join('')}
          <span class="legend-item"><span class="pri-dot" style="background:#e0455a;outline:2px solid #e0455a"></span>Jalur kritis</span>
        </div>
        <div class="toolbar-group spacer"></div>
        <button id="btn-open-sel" class="btn btn-ghost" ${selectedTaskId ? '' : 'disabled'}>Detail Tugas Terpilih</button>
      </div>
      <div id="gantt-container" class="gantt-container"></div>
    `;

    main.querySelector('#zoom-select').value = st.settings.zoom || 'week';
    Gantt.setZoom(st.settings.zoom || 'week');
    Gantt.draw(main.querySelector('#gantt-container'), model);

    main.querySelector('#zoom-select').addEventListener('change', (e) => {
      st.settings.zoom = e.target.value; Gantt.setZoom(e.target.value); S.save(); render();
    });
    main.querySelector('#chk-shade').addEventListener('change', (e) => {
      st.settings.showWeekendShade = e.target.checked; S.save(); render();
    });
    main.querySelector('#btn-open-sel').addEventListener('click', () => { if (selectedTaskId) openTaskModal(selectedTaskId); });
  }

  // =========================================================================
  // TAB: TASKS
  // =========================================================================
  function renderTasks(main, model) {
    main.innerHTML = `
      <div class="toolbar">
        <div class="toolbar-group">
          <button id="btn-add" class="btn btn-primary">+ Tambah Tugas</button>
        </div>
        <div class="toolbar-group spacer"></div>
        <div class="toolbar-hint">Klik baris untuk membuka detail. Tugas anak mewarisi predecessor induknya.</div>
      </div>
      <div class="panel">
        <table class="data-table" id="task-table">
          <thead>
            <tr>
              <th class="col-name">Nama Tugas</th>
              <th>Prioritas</th>
              <th>Durasi</th>
              <th>Mulai</th>
              <th>Selesai</th>
              <th>Slack</th>
              <th>Predecessor</th>
              <th>Tim</th>
              <th class="col-actions"></th>
            </tr>
          </thead>
          <tbody>${model.rows.map(r => taskRowHTML(r, model)).join('') || emptyRow(9)}</tbody>
        </table>
      </div>
    `;
    main.querySelector('#btn-add').addEventListener('click', () => openTaskModal(null));
    main.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openTaskModal(b.dataset.edit); }));
    main.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); confirmDelete(b.dataset.del); }));
    main.querySelectorAll('[data-addsub]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openTaskModal(null, b.dataset.addsub); }));
    main.querySelectorAll('#task-table tbody tr[data-id]').forEach(tr => tr.addEventListener('click', () => openTaskModal(tr.dataset.id)));
  }

  function taskRowHTML(r, model) {
    const t = r.task;
    const indent = r.depth * 18;
    const preds = S.getEffectivePredecessors(t);
    const predTxt = preds.map(p => {
      const pt = S.getTask(p.taskId);
      return pt ? `${pt.name} [${p.type}${p.lag ? '+' + p.lag : ''}]` : '';
    }).filter(Boolean).join(', ') || '—';
    const team = (t.resources || []).map(id => { const rr = S.getResource(id); return rr ? rr.name.split(' ')[0] : ''; }).filter(Boolean).join(', ') || '—';
    return `<tr data-id="${t.id}" class="${r.critical ? 'row-critical' : ''} ${r.isSummary ? 'row-summary' : ''}">
      <td class="col-name">
        <div style="padding-left:${indent}px" class="task-cell">
          <span class="pri-dot" style="background:${t.color}"></span>
          <span class="task-name">${escapeHtml(t.name)}</span>
          ${r.isSummary ? '<span class="badge badge-sum">Ringkasan</span>' : ''}
          ${r.critical ? '<span class="badge badge-crit">Kritis</span>' : ''}
        </div>
      </td>
      <td><span class="pill" style="background:${t.color}22;color:${t.color}">${(S.PRIORITIES[t.priority] || {}).label || t.priority}</span></td>
      <td>${r.isSummary ? '—' : t.duration + ' hr'}</td>
      <td>${r.ES ? r.ES.toISOString().slice(0, 10) : '—'}</td>
      <td>${r.EF ? r.EF.toISOString().slice(0, 10) : '—'}</td>
      <td class="${r.critical ? 'text-crit' : ''}">${r.slack != null ? r.slack : '—'}</td>
      <td class="cell-small">${predTxt}</td>
      <td class="cell-small">${team}</td>
      <td class="col-actions">
        <button class="icon-btn" data-addsub="${t.id}" title="Tambah sub-tugas">＋</button>
        <button class="icon-btn" data-edit="${t.id}" title="Edit">✎</button>
        <button class="icon-btn icon-del" data-del="${t.id}" title="Hapus">🗑</button>
      </td>
    </tr>`;
  }

  function confirmDelete(id) {
    const t = S.getTask(id); if (!t) return;
    const kids = S.getChildren(id).length;
    const msg = `Hapus tugas "${t.name}"?` + (kids ? ` (${kids} sub-tugas akan ikut terhapus)` : '') ;
    if (confirm(msg)) { S.deleteTask(id, true); if (selectedTaskId === id) selectedTaskId = null; }
  }

  // =========================================================================
  // TAB: RESOURCES
  // =========================================================================
  function renderResources(main, model) {
    const st = S.getState();
    const totalCost = computeProjectCost(model);
    main.innerHTML = `
      <div class="toolbar">
        <div class="toolbar-group"><button id="btn-add-res" class="btn btn-primary">+ Anggota Tim</button></div>
        <div class="toolbar-group spacer"></div>
        <div class="toolbar-group">Total beban gaji proyek: <b class="text-money">${formatCurrency(totalCost)}</b></div>
      </div>
      <div class="two-col">
        <div class="panel">
          <h3 class="panel-title">Anggota Tim</h3>
          <table class="data-table" id="res-table">
            <thead><tr><th>Nama</th><th>Email</th><th>Peran</th><th>Gaji/bulan</th><th>Kapasitas</th><th>Tugas</th><th></th></tr></thead>
            <tbody>${st.resources.map(r => resRowHTML(r, model)).join('') || emptyRow(7)}</tbody>
          </table>
        </div>
        <div class="panel">
          <h3 class="panel-title">Alokasi per Tugas</h3>
          <div id="alloc-list" class="alloc-list">${allocListHTML(model)}</div>
        </div>
      </div>
    `;
    main.querySelector('#btn-add-res').addEventListener('click', () => openResourceModal(null));
    main.querySelectorAll('[data-editres]').forEach(b => b.addEventListener('click', () => openResourceModal(b.dataset.editres)));
    main.querySelectorAll('[data-delres]').forEach(b => b.addEventListener('click', () => {
      const r = S.getResource(b.dataset.delres);
      if (confirm(`Hapus anggota "${r.name}"? Alokasinya akan dihapus dari semua tugas.`)) S.deleteResource(b.dataset.delres);
    }));
  }

  function resRowHTML(r, model) {
    const load = model.rows.filter(x => !x.isSummary && (x.task.resources || []).indexOf(r.id) !== -1);
    const cost = load.reduce((sum, x) => sum + dailyRate(r) * (x.task.duration || 0), 0);
    return `<tr>
      <td><span class="res-dot" style="background:${avatarColor(r.name)}">${escapeHtml((r.name || '?')[0])}</span> ${escapeHtml(r.name)}</td>
      <td class="cell-small">${escapeHtml(r.email)}</td>
      <td>${escapeHtml(r.role)}</td>
      <td>${formatCurrency(r.salary)}</td>
      <td>${r.capacity}%</td>
      <td>${load.length} <span class="cell-small">(${formatCurrency(cost)})</span></td>
      <td class="col-actions">
        <button class="icon-btn" data-editres="${r.id}">✎</button>
        <button class="icon-btn icon-del" data-delres="${r.id}">🗑</button>
      </td>
    </tr>`;
  }

  function allocListHTML(model) {
    const leaves = model.rows.filter(r => !r.isSummary);
    if (!leaves.length) return '<div class="muted">Belum ada tugas.</div>';
    return leaves.map(r => {
      const chips = (r.task.resources || []).map(id => {
        const rr = S.getResource(id);
        return rr ? `<span class="chip"><span class="res-dot sm" style="background:${avatarColor(rr.name)}">${escapeHtml(rr.name[0])}</span>${escapeHtml(rr.name.split(' ')[0])}</span>` : '';
      }).join('');
      const opts = S.getState().resources.map(x => `<option value="${x.id}">${escapeHtml(x.name)} — ${escapeHtml(x.role)}</option>`).join('');
      return `<div class="alloc-row" data-task="${r.task.id}">
        <div class="alloc-name"><span class="pri-dot" style="background:${r.task.color}"></span>${escapeHtml(r.task.name)}</div>
        <div class="alloc-chips">${chips || '<span class="muted">Belum ada alokasi</span>'}</div>
        <select class="alloc-add"><option value="">+ Alokasikan…</option>${opts}</select>
      </div>`;
    }).join('');
  }

  function wireAlloc(main, model) {
    main.querySelectorAll('.alloc-add').forEach(sel => {
      sel.addEventListener('change', () => {
        const taskId = sel.closest('.alloc-row').dataset.task;
        if (sel.value) { S.assignResource(taskId, sel.value); }
      });
    });
    main.querySelectorAll('.alloc-chips .chip').forEach(chip => {
      chip.title = 'Klik untuk menghapus alokasi';
      chip.addEventListener('click', () => {
        const taskId = chip.closest('.alloc-row').dataset.task;
        const rid = chip.dataset.rid;
        if (rid) S.unassignResource(taskId, rid);
      });
    });
  }

  function computeProjectCost(model) {
    return model.rows.filter(r => !r.isSummary).reduce((sum, r) => {
      return sum + (r.task.resources || []).reduce((s, id) => {
        const rr = S.getResource(id); return s + (rr ? dailyRate(rr) * (r.task.duration || 0) : 0);
      }, 0);
    }, 0);
  }

  function dailyRate(res) { return (res.salary || 0) / 22; } // 22 hari kerja/bulan

  // =========================================================================
  // TAB: CALENDAR
  // =========================================================================
  function renderCalendar(main, model) {
    const st = S.getState();
    const cal = st.calendar;
    main.innerHTML = `
      <div class="two-col">
        <div class="panel">
          <h3 class="panel-title">Akhir Pekan</h3>
          <p class="muted">Pilih hari yang dianggap tidak bekerja. Durasi &amp; penjadwalan dihitung dalam hari kerja.</p>
          <div class="weekend-grid">
            ${[0,1,2,3,4,5,6].map(d => `
              <label class="chk-card ${cal.weekendDays.indexOf(d) !== -1 ? 'on' : ''}">
                <input type="checkbox" data-dow="${d}" ${cal.weekendDays.indexOf(d) !== -1 ? 'checked' : ''}/>
                <span>${dayNameFull(d)}</span>
              </label>`).join('')}
          </div>
        </div>
        <div class="panel">
          <h3 class="panel-title">Hari Libur Khusus</h3>
          <div class="holiday-add">
            <input type="date" id="holiday-date" />
            <input type="text" id="holiday-name" placeholder="Nama libur (opsional)" />
            <button id="btn-add-holiday" class="btn btn-primary">Tambah</button>
          </div>
          <ul class="holiday-list" id="holiday-list">${holidayListHTML(cal)}</ul>
        </div>
      </div>
      <div class="panel">
        <h3 class="panel-title">Pratinjau Kalender — ${monthNameFull(new Date().getUTCMonth())} ${new Date().getUTCFullYear()}</h3>
        <div id="cal-preview"></div>
      </div>
    `;
    main.querySelectorAll('[data-dow]').forEach(cb => cb.addEventListener('change', () => S.toggleWeekendDay(+cb.dataset.dow)));
    main.querySelector('#btn-add-holiday').addEventListener('click', () => {
      const d = main.querySelector('#holiday-date').value;
      if (!d) { alert('Pilih tanggal terlebih dahulu.'); return; }
      const name = main.querySelector('#holiday-name').value;
      S.addHoliday(d);
      // store name alongside by reusing holiday entries as objects is complex; keep simple list of dates
      main.querySelector('#holiday-name').value = '';
      render();
    });
    main.querySelectorAll('[data-delholiday]').forEach(b => b.addEventListener('click', () => S.removeHoliday(b.dataset.delholiday)));
    renderCalPreview(main.querySelector('#cal-preview'));
  }

  function holidayListHTML(cal) {
    if (!cal.holidays.length) return '<li class="muted">Belum ada hari libur.</li>';
    return cal.holidays.map(h => `<li>
      <span>📅 ${h}</span><span class="muted">(${dayNameFull(U.dayOfWeek(h))})</span>
      <button class="icon-btn icon-del" data-delholiday="${h}">✕</button>
    </li>`).join('');
  }

  function renderCalPreview(container) {
    const cal = S.getState().calendar;
    const now = new Date();
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12));
    const startDow = first.getUTCDay();
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 12)).getUTCDate();
    let html = '<div class="mini-cal">';
    ['Min','Sen','Sel','Rab','Kam','Jum','Sab'].forEach(d => { html += `<div class="mini-cal-h">${d}</div>`; });
    for (let i = 0; i < startDow; i++) html += '<div class="mini-cal-cell empty"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), d, 12));
      const wd = isWorkingDay(date, cal);
      const hol = isHoliday(date, cal);
      const today = fmtDate(date) === fmtDate(new Date());
      html += `<div class="mini-cal-cell ${wd ? 'work' : 'off'} ${hol ? 'holiday' : ''} ${today ? 'today' : ''}" title="${hol ? 'Libur khusus' : (wd ? 'Hari kerja' : 'Akhir pekan')}">${d}</div>`;
    }
    html += '</div>';
    container.innerHTML = html;
  }

  // =========================================================================
  // TAB: ANALYSIS
  // =========================================================================
  function renderAnalysis(main, model) {
    const st = S.getState();
    const crit = model.rows.filter(r => r.critical);
    const critDur = crit.filter(r => !r.isSummary).reduce((s, r) => s + (r.task.duration || 0), 0);
    const projDur = model.res.projectEnd && model.res.projectStart ? U.diffWorkingDays(model.res.projectStart, model.res.projectEnd, st.calendar) + 1 : 0;
    const leafCount = model.rows.filter(r => !r.isSummary).length;
    const cost = computeProjectCost(model);

    main.innerHTML = `
      <div class="stat-row">
        <div class="stat-card"><div class="stat-label">Durasi Proyek</div><div class="stat-value">${projDur} <span>hari kerja</span></div></div>
        <div class="stat-card crit"><div class="stat-label">Jalur Kritis</div><div class="stat-value">${crit.filter(r=>!r.isSummary).length} <span>tugas</span></div></div>
        <div class="stat-card"><div class="stat-label">Durasi Jalur Kritis</div><div class="stat-value">${critDur} <span>hari</span></div></div>
        <div class="stat-card"><div class="stat-label">Total Tugas</div><div class="stat-value">${leafCount}</div></div>
        <div class="stat-card"><div class="stat-label">Estimasi Biaya</div><div class="stat-value money">${formatCurrency(cost)}</div></div>
      </div>
      ${model.res.cyclic ? '<div class="alert">⚠ Ditemukan siklus dependensi. Periksa predecessor tugas Anda.</div>' : ''}
      <div class="two-col">
        <div class="panel">
          <h3 class="panel-title">Jalur Kritis <span class="muted">(slack = 0)</span></h3>
          <table class="data-table">
            <thead><tr><th>Tugas</th><th>Mulai</th><th>Selesai</th><th>Durasi</th><th>Slack</th></tr></thead>
            <tbody>${crit.length ? crit.map(r => `<tr class="row-critical">
              <td><span class="pri-dot" style="background:${r.task.color}"></span>${escapeHtml(r.task.name)}</td>
              <td>${r.ES ? r.ES.toISOString().slice(0,10) : '—'}</td>
              <td>${r.EF ? r.EF.toISOString().slice(0,10) : '—'}</td>
              <td>${r.isSummary ? '—' : r.task.duration + ' hr'}</td>
              <td class="text-crit">${r.slack}</td></tr>`).join('') : emptyRow(5, 'Tidak ada tugas kritis — semua memiliki slack.')}
            </tbody>
          </table>
        </div>
        <div class="panel">
          <h3 class="panel-title">Ringkasan Beban Sumber Daya</h3>
          ${resourceLoadHTML(model)}
        </div>
      </div>
      <div class="panel">
        <h3 class="panel-title">Diagram PERT <span class="muted">(ES=awal, EF=akhir, LS=mulai terlambat, LF=selesai terlambat)</span></h3>
        <div id="pert-container"></div>
      </div>
    `;
    PERT.draw(main.querySelector('#pert-container'), model);
  }

  function resourceLoadHTML(model) {
    const st = S.getState();
    if (!st.resources.length) return '<div class="muted">Belum ada anggota tim.</div>';
    const maxLoad = Math.max(1, ...st.resources.map(r => loadOf(model, r.id).days));
    return '<div class="load-list">' + st.resources.map(r => {
      const l = loadOf(model, r.id);
      const pct = Math.round(l.days / Math.max(1, projWorkDays(model)) * 100);
      const w = Math.round(l.days / maxLoad * 100);
      return `<div class="load-row">
        <div class="load-name"><span class="res-dot sm" style="background:${avatarColor(r.name)}">${escapeHtml(r.name[0])}</span>${escapeHtml(r.name.split(' ')[0])}</div>
        <div class="load-bar"><div class="load-fill" style="width:${w}%;background:${avatarColor(r.name)}"></div></div>
        <div class="load-meta">${l.tasks} tugas · ${l.days} hr · ${formatCurrency(l.cost)}</div>
      </div>`;
    }).join('') + '</div>';
  }

  function loadOf(model, resId) {
    let days = 0, tasks = 0, cost = 0;
    model.rows.filter(r => !r.isSummary).forEach(r => {
      if ((r.task.resources || []).indexOf(resId) !== -1) {
        tasks++; days += r.task.duration || 0;
        const rr = S.getResource(resId); cost += dailyRate(rr) * (r.task.duration || 0);
      }
    });
    return { days, tasks, cost };
  }

  function projWorkDays(model) {
    if (!model.res.projectStart || !model.res.projectEnd) return 1;
    return U.diffWorkingDays(model.res.projectStart, model.res.projectEnd, S.getState().calendar) + 1;
  }

  // =========================================================================
  // MODAL: TASK
  // =========================================================================
  function openTaskModal(id, presetParentId) {
    const isNew = !id;
    const t = isNew ? {
      id: null, name: '', description: '', startDate: fmtDate(new Date()),
      duration: 1, priority: 'medium', color: S.PRIORITIES.medium.color,
      progress: 0, parentId: presetParentId || null, predecessors: [], resources: []
    } : U.deepClone(S.getTask(id));
    if (!t) return;

    const st = S.getState();
    const otherTasks = st.tasks.filter(x => x.id !== t.id);
    const parentOpts = otherTasks.map(x => `<option value="${x.id}" ${t.parentId === x.id ? 'selected' : ''}>${escapeHtml(indentName(x))}</option>`).join('');
    const priOpts = Object.values(S.PRIORITIES).map(p => `<option value="${p.id}" ${t.priority === p.id ? 'selected' : ''}>${p.label}</option>`).join('');
    const resOpts = st.resources.map(r => `<option value="${r.id}" ${(t.resources||[]).indexOf(r.id) !== -1 ? 'selected' : ''}>${escapeHtml(r.name)} — ${escapeHtml(r.role)}</option>`).join('');
    const predOpts = otherTasks.map(x => `<option value="${x.id}">${escapeHtml(indentName(x))}</option>`).join('');

    openModal(`
      <div class="modal modal-lg">
        <div class="modal-head">
          <h2>${isNew ? 'Tambah Tugas' : 'Edit Tugas'}</h2>
          <button class="modal-close" data-close>✕</button>
        </div>
        <div class="modal-body">
          <div class="form-grid">
            <div class="field span2">
              <label>Nama Tugas *</label>
              <input id="f-name" value="${escapeHtml(t.name)}" placeholder="Nama tugas" />
            </div>
            <div class="field span2">
              <label>Deskripsi</label>
              <textarea id="f-desc" rows="2" placeholder="Deskripsi singkat">${escapeHtml(t.description)}</textarea>
            </div>
            <div class="field">
              <label>Induk Tugas (sub-tugas dari)</label>
              <select id="f-parent"><option value="">— Tugas induk / root —</option>${parentOpts}</select>
            </div>
            <div class="field">
              <label>Prioritas</label>
              <select id="f-priority">${priOpts}</select>
            </div>
            <div class="field">
              <label>Tanggal Mulai</label>
              <input type="date" id="f-start" value="${t.startDate || ''}" />
              <small class="hint">Berlaku untuk tugas tanpa predecessor (atau sebagai batas awal).</small>
            </div>
            <div class="field">
              <label>Durasi (hari kerja)</label>
              <input type="number" id="f-duration" min="0" value="${t.duration}" />
            </div>
            <div class="field">
              <label>Warna Indikator</label>
              <div class="color-row">
                <input type="color" id="f-color" value="${t.color || '#4ea1f3'}" />
                <div class="color-presets">${Object.values(S.PRIORITIES).map(p => `<span class="swatch" data-color="${p.color}" style="background:${p.color}" title="${p.label}"></span>`).join('')}</div>
              </div>
            </div>
            <div class="field">
              <label>Progres (%)</label>
              <input type="range" id="f-progress" min="0" max="100" value="${t.progress || 0}" />
              <span id="f-progress-val">${t.progress || 0}%</span>
            </div>

            <div class="field span2">
              <label>Predecessor (hubungan antar tugas)</label>
              <div id="pred-list" class="pred-list">${predListHTML(t, otherTasks)}</div>
              <div class="pred-add">
                <select id="f-pred-task"><option value="">— Pilih tugas pendahulu —</option>${predOpts}</select>
                <select id="f-pred-type">${Object.values(S.LINK_TYPES).map(l => `<option value="${l.id}">${l.label}</option>`).join('')}</select>
                <input type="number" id="f-pred-lag" min="0" value="0" title="Jeda (hari kerja)" placeholder="Jeda" style="width:70px" />
                <button id="btn-add-pred" class="btn btn-ghost">+ Tambah</button>
              </div>
              <small class="hint">FS = mulai setelah selesai · SS = mulai bersamaan · Jeda = hari kerja tunggu.</small>
            </div>

            <div class="field span2">
              <label>Alokasikan Tim</label>
              <div class="res-checks">${resOpts ? st.resources.map(r => `
                <label class="chk-card sm ${(t.resources||[]).indexOf(r.id) !== -1 ? 'on' : ''}">
                  <input type="checkbox" data-res="${r.id}" ${(t.resources||[]).indexOf(r.id) !== -1 ? 'checked' : ''}/>
                  <span class="res-dot sm" style="background:${avatarColor(r.name)}">${escapeHtml(r.name[0])}</span>
                  <span>${escapeHtml(r.name)} <small class="muted">${escapeHtml(r.role)}</small></span>
                </label>`).join('') : '<div class="muted">Belum ada anggota tim. Tambahkan di tab Tim.</div>'}
              </div>
            </div>
          </div>
        </div>
        <div class="modal-foot">
          ${isNew ? '' : `<button id="btn-del-task" class="btn btn-danger">Hapus</button>`}
          <div class="spacer"></div>
          <button class="btn btn-ghost" data-close>Batal</button>
          <button id="btn-save-task" class="btn btn-primary">${isNew ? 'Simpan Tugas' : 'Simpan Perubahan'}</button>
        </div>
      </div>
    `);

    const root = document.getElementById('modal-root');
    const progressEl = root.querySelector('#f-progress');
    progressEl.addEventListener('input', () => { root.querySelector('#f-progress-val').textContent = progressEl.value + '%'; });

    // color presets
    root.querySelectorAll('.swatch').forEach(sw => sw.addEventListener('click', () => {
      root.querySelector('#f-color').value = sw.dataset.color;
    }));

    // dynamic predecessors list
    const predList = root.querySelector('#pred-list');
    predList.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rmpred]'); if (!b) return;
      b.closest('.pred-item').remove();
    });
    root.querySelector('#btn-add-pred').addEventListener('click', () => {
      const sel = root.querySelector('#f-pred-task');
      if (!sel.value) { alert('Pilih tugas pendahulu.'); return; }
      const type = root.querySelector('#f-pred-type').value;
      const lag = parseInt(root.querySelector('#f-pred-lag').value, 10) || 0;
      const div = document.createElement('div');
      div.className = 'pred-item';
      div.innerHTML = `<span class="pred-txt">${escapeHtml(taskName(sel.value))} <b>[${type}${lag ? '+' + lag : ''}]</b></span>
        <input type="hidden" data-pred-id="${sel.value}" data-type="${type}" data-lag="${lag}" />
        <button type="button" class="icon-btn icon-del" data-rmpred>✕</button>`;
      predList.appendChild(div);
      sel.value = '';
      root.querySelector('#f-pred-lag').value = '0';
    });

    // parent color sync (child inherits priority color when priority changes)
    root.querySelector('#f-priority').addEventListener('change', () => {
      const p = S.PRIORITIES[root.querySelector('#f-priority').value];
      root.querySelector('#f-color').value = p.color;
    });

    root.querySelector('#btn-save-task').addEventListener('click', () => saveTaskFromModal(isNew, t.id));
    if (!isNew) {
      root.querySelector('#btn-del-task').addEventListener('click', () => { closeModal(); confirmDelete(t.id); });
    }
  }

  function predListHTML(t, otherTasks) {
    if (!t.predecessors || !t.predecessors.length) return '<div class="muted">Belum ada predecessor.</div>';
    return t.predecessors.map(p => `
      <div class="pred-item">
        <span class="pred-txt">${escapeHtml(taskName(p.taskId))} <b>[${p.type}${p.lag ? '+' + p.lag : ''}]</b></span>
        <input type="hidden" data-pred-id="${p.taskId}" data-type="${p.type}" data-lag="${p.lag || 0}" />
        <button type="button" class="icon-btn icon-del" data-rmpred>✕</button>
      </div>`).join('');
  }

  function saveTaskFromModal(isNew, id) {
    const root = document.getElementById('modal-root');
    const name = root.querySelector('#f-name').value.trim();
    if (!name) { alert('Nama tugas wajib diisi.'); return; }
    const parentId = root.querySelector('#f-parent').value || null;

    // gather predecessors
    const preds = [];
    root.querySelectorAll('#pred-list input[data-pred-id]').forEach(inp => {
      preds.push({ taskId: inp.dataset.predId, type: inp.dataset.type, lag: parseInt(inp.dataset.lag, 10) || 0 });
    });

    // validate predecessor cycles
    for (const p of preds) {
      if (SCH.wouldCreateCycle(S, id || '__new__', p.taskId) && id) {
        alert('Predecessor "' + taskName(p.taskId) + '" akan membuat siklus. Dibatalkan.'); return;
      }
    }

    const resources = [];
    root.querySelectorAll('[data-res]').forEach(cb => { if (cb.checked) resources.push(cb.dataset.res); });

    const data = {
      name,
      description: root.querySelector('#f-desc').value,
      parentId,
      priority: root.querySelector('#f-priority').value,
      startDate: root.querySelector('#f-start').value,
      duration: Math.max(0, parseInt(root.querySelector('#f-duration').value, 10) || 0),
      color: root.querySelector('#f-color').value,
      progress: parseInt(root.querySelector('#f-progress').value, 10) || 0,
      predecessors: preds,
      resources
    };

    if (isNew) {
      const nt = S.createTask(data);
      selectedTaskId = nt.id;
    } else {
      const t = S.getTask(id);
      // guard: can't set parent to own descendant
      let cur = S.getTask(parentId), guard = 0, bad = false;
      while (cur && guard++ < 50) { if (cur.id === id) { bad = true; break; } cur = S.getTask(cur.parentId); }
      if (bad) { alert('Tidak bisa menjadikan sub-tugas sebagai induknya sendiri.'); return; }
      S.updateTask(id, data);
    }
    closeModal();
  }

  // =========================================================================
  // MODAL: RESOURCE
  // =========================================================================
  function openResourceModal(id) {
    const isNew = !id;
    const r = isNew ? { name: '', email: '', role: '', salary: 0, capacity: 100 } : U.deepClone(S.getResource(id));
    if (!r) return;
    openModal(`
      <div class="modal">
        <div class="modal-head">
          <h2>${isNew ? 'Tambah Anggota Tim' : 'Edit Anggota Tim'}</h2>
          <button class="modal-close" data-close>✕</button>
        </div>
        <div class="modal-body">
          <div class="form-grid">
            <div class="field span2"><label>Nama *</label><input id="r-name" value="${escapeHtml(r.name)}" placeholder="Nama lengkap" /></div>
            <div class="field span2"><label>Email</label><input id="r-email" type="email" value="${escapeHtml(r.email)}" placeholder="nama@perusahaan.com" /></div>
            <div class="field"><label>Peran</label><input id="r-role" value="${escapeHtml(r.role)}" placeholder="mis. Backend Engineer" /></div>
            <div class="field"><label>Gaji / bulan (IDR)</label><input id="r-salary" type="number" min="0" value="${r.salary || 0}" /></div>
            <div class="field span2"><label>Kapasitas (%)</label><input id="r-capacity" type="number" min="0" max="200" value="${r.capacity || 100}" /></div>
          </div>
        </div>
        <div class="modal-foot">
          <div class="spacer"></div>
          <button class="btn btn-ghost" data-close>Batal</button>
          <button id="btn-save-res" class="btn btn-primary">Simpan</button>
        </div>
      </div>
    `);
    document.getElementById('modal-root').querySelector('#btn-save-res').addEventListener('click', () => {
      const root = document.getElementById('modal-root');
      const name = root.querySelector('#r-name').value.trim();
      if (!name) { alert('Nama wajib diisi.'); return; }
      const data = {
        name,
        email: root.querySelector('#r-email').value.trim(),
        role: root.querySelector('#r-role').value.trim(),
        salary: parseInt(root.querySelector('#r-salary').value, 10) || 0,
        capacity: parseInt(root.querySelector('#r-capacity').value, 10) || 100
      };
      if (isNew) S.createResource(data); else S.updateResource(id, data);
      closeModal();
    });
  }

  // =========================================================================
  // MODAL PLUMBING
  // =========================================================================
  function openModal(html) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-backdrop"></div>${html}`;
    root.classList.add('open');
    root.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModal));
    root.querySelector('.modal-backdrop').addEventListener('click', closeModal);
    document.addEventListener('keydown', escClose);
  }
  function escClose(e) { if (e.key === 'Escape') closeModal(); }
  function closeModal() {
    const root = document.getElementById('modal-root');
    root.classList.remove('open'); root.innerHTML = '';
    document.removeEventListener('keydown', escClose);
  }

  // =========================================================================
  // HELPERS
  // =========================================================================
  function selectTask(id) { selectedTaskId = id; if (currentTab === 'gantt') render(); }

  function taskName(id) { const t = S.getTask(id); return t ? t.name : '(dihapus)'; }
  function indentName(x) {
    const d = S.getDepth(x);
    return '　'.repeat(d) + (d ? '└ ' : '') + x.name;
  }
  function emptyRow(cols, msg) {
    return `<tr><td colspan="${cols}" class="empty-cell">${msg || 'Belum ada data.'}</td></tr>`;
  }
  const AVATAR_COLORS = ['#4ea1f3','#6c5ce7','#00b894','#e17055','#0984e3','#e84393','#fdcb6e','#00cec9','#a29bfe','#ff7675'];
  function avatarColor(name) {
    let h = 0; for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }

  // wire allocation after resources render
  const _origRender = render;
  render = function () {
    _origRender();
    if (currentTab === 'resources') wireAlloc(document.getElementById('main'), computeModel());
  };

  global.App = { init, selectTask, render };

  document.addEventListener('DOMContentLoaded', init);
})(window);
