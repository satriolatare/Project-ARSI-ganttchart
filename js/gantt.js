/* =========================================================================
 * gantt.js — SVG Gantt chart renderer
 * Renders a timeline (right pane) synced with a task table (left pane).
 * Supports zoom, weekend/holiday shading, FS/SS dependency arrows,
 * critical highlighting, summary bars and a today marker.
 * ========================================================================= */
(function (global) {
  'use strict';

  const U = global.GCAL;
  const S = global.Store;
  const {
    parseDate, fmtDate, addDays, compare, sameDay, dayOfWeek,
    isWorkingDay, isWeekend, isHoliday, daysBetween,
    monthName, dayName, escapeHtml
  } = U;

  const ROW_H = 34;
  const HEADER_H = 46;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  let pxPerDay = 16;
  const ZOOMS = { day: 34, week: 16, month: 7, quarter: 3.5 };

  function setZoom(z) { pxPerDay = ZOOMS[z] || 16; }

  function el(tag, attrs) {
    const e = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function marker(color) {
    const m = el('marker', { id: color === '#e0455a' ? 'arrow-crit' : 'arrow-def', markerWidth: 8, markerHeight: 8, refX: 7, refY: 3, orient: 'auto' });
    m.appendChild(el('path', { d: 'M0,0 L0,6 L7,3 z', fill: color }));
    return m;
  }

  // ---------- header ----------
  function renderHeader(start, totalDays, width) {
    const g = el('g', { class: 'gantt-header' });
    g.appendChild(el('rect', { x: 0, y: 0, width, height: HEADER_H, class: 'gantt-header-bg' }));

    // group days by month
    const months = [];
    for (let i = 0; i < totalDays; i++) {
      const d = addDays(start, i);
      const key = d.getUTCFullYear() + '-' + d.getUTCMonth();
      if (!months.length || months[months.length - 1].key !== key) {
        months.push({ key, y: d.getUTCFullYear(), m: d.getUTCMonth(), startIdx: i, days: 0 });
      }
      months[months.length - 1].days++;
    }

    const dense = pxPerDay >= 12; // show day numbers only when wide enough

    months.forEach(mo => {
      const x = mo.startIdx * pxPerDay;
      const w = mo.days * pxPerDay;
      const t = el('text', { x: x + 5, y: 15, class: 'gantt-month' });
      t.textContent = monthName(mo.m) + ' ' + mo.y;
      g.appendChild(t);
      g.appendChild(el('line', { x1: x, y1: 0, x2: x, y2: HEADER_H, class: 'gantt-month-sep' }));
    });

    if (dense) {
      for (let i = 0; i < totalDays; i++) {
        const d = addDays(start, i);
        const x = i * pxPerDay;
        const t = el('text', { x: x + pxPerDay / 2, y: 34, class: 'gantt-day-num' + (isWeekend(d, { weekendDays: [0, 6] }) ? ' wknd' : '') });
        t.textContent = d.getUTCDate();
        g.appendChild(t);
      }
    }
    g.appendChild(el('line', { x1: 0, y1: HEADER_H, x2: width, y2: HEADER_H, class: 'gantt-header-line' }));
    return g;
  }

  // ---------- grid ----------
  function renderGrid(start, totalDays, bodyH, calendar, width) {
    const g = el('g', { class: 'gantt-grid' });
    const top = HEADER_H;

    // weekend / holiday column shading
    if (S.getState().settings.showWeekendShade) {
      for (let i = 0; i < totalDays; i++) {
        const d = addDays(start, i);
        const x = i * pxPerDay;
        if (isHoliday(d, calendar)) {
          g.appendChild(el('rect', { x, y: top, width: pxPerDay, height: bodyH, class: 'gantt-holiday-col' }));
        } else if (isWeekend(d, calendar)) {
          g.appendChild(el('rect', { x, y: top, width: pxPerDay, height: bodyH, class: 'gantt-weekend-col' }));
        }
      }
    }

    // vertical day separators
    for (let i = 0; i <= totalDays; i++) {
      const x = i * pxPerDay;
      const d = addDays(start, i);
      const major = d.getUTCDate() === 1 || i === 0;
      g.appendChild(el('line', { x1: x, y1: top, x2: x, y2: top + bodyH, class: major ? 'gantt-grid-major' : 'gantt-grid-minor' }));
    }

    // horizontal row separators
    const nRows = Math.ceil(bodyH / ROW_H);
    for (let r = 0; r <= nRows; r++) {
      const y = top + r * ROW_H;
      g.appendChild(el('line', { x1: 0, y1: y, x2: width, y2: y, class: 'gantt-grid-row' }));
    }
    return g;
  }

  // ---------- bar ----------
  function buildBarReal(r, rowIndex, padStart, calendar) {
    const g = el('g', { class: 'gantt-bar-row' + (r.critical ? ' crit' : ''), 'data-task-id': r.task.id });
    const yTop = HEADER_H + rowIndex * ROW_H;
    const startY = yTop + 6;
    const barH = ROW_H - 12;

    const x = daysBetween(padStart, r.ES) * pxPerDay + pxPerDay / 2;
    const xEnd = daysBetween(padStart, r.EF) * pxPerDay + pxPerDay / 2 + pxPerDay;
    const w = Math.max(6, xEnd - x);

    const color = r.task.color || '#4ea1f3';

    if (r.isSummary) {
      // summary: diamond endpoints + thick line
      const midY = yTop + ROW_H / 2;
      g.appendChild(el('line', { x1: x + 3, y1: midY, x2: xEnd - 3, y2: midY, class: 'gantt-summary-line', stroke: color }));
      const dm = 5;
      g.appendChild(el('path', { d: `M${x},${midY} l${dm},${-dm} l${dm},${dm} l${-dm},${dm} z`, fill: color }));
      g.appendChild(el('path', { d: `M${xEnd},${midY} l${-dm},${-dm} l${-dm},${dm} l${dm},${dm} z`, fill: color }));
    } else {
      // progress track
      const rect = el('rect', { x, y: startY, width: w, height: barH, rx: 5, class: 'gantt-bar' + (r.critical ? ' crit' : ''), fill: color, 'data-task-id': r.task.id });
      g.appendChild(rect);
      // progress fill
      if (r.task.progress > 0) {
        const pw = w * Math.min(100, r.task.progress) / 100;
        g.appendChild(el('rect', { x, y: startY, width: pw, height: barH, rx: 5, class: 'gantt-bar-progress', 'pointer-events': 'none' }));
      }
      if (r.critical) {
        g.appendChild(el('rect', { x, y: startY, width: w, height: barH, rx: 5, class: 'gantt-bar-crit-outline', 'pointer-events': 'none' }));
      }
      // label
      const lbl = el('text', { x: xEnd + 6, y: startY + barH - 6, class: 'gantt-bar-label' });
      lbl.textContent = `${r.task.duration} hr`;
      g.appendChild(lbl);
    }
    return g;
  }

  // ---------- arrow ----------
  function buildArrow(pred, succRow, yOf, byResourceId, padStart, calendar) {
    const predRow = modelRowById(pred.taskId);
    if (!predRow || !predRow.ES || !succRow.ES) return null;

    const pi = yOf[pred.taskId], si = yOf[succRow.task.id];
    if (pi == null || si == null) return null;

    const pStartX = daysBetween(padStart, predRow.ES) * pxPerDay + pxPerDay / 2;
    const pEndX = daysBetween(padStart, predRow.EF) * pxPerDay + pxPerDay / 2 + pxPerDay;
    const sStartX = daysBetween(padStart, succRow.ES) * pxPerDay + pxPerDay / 2;

    const pY = HEADER_H + pi * ROW_H + ROW_H / 2;
    const sY = HEADER_H + si * ROW_H + ROW_H / 2;

    const crit = predRow.critical && succRow.critical;
    const stroke = crit ? '#e0455a' : '#8a94a6';
    const markerRef = crit ? 'url(#arrow-crit)' : 'url(#arrow-def)';

    let d;
    if (pred.type === 'SS') {
      // start -> start
      const x0 = pStartX, y0 = HEADER_H + pi * ROW_H + 6;
      const x1 = sStartX, y1 = HEADER_H + si * ROW_H + 6;
      const midX = Math.min(x0, x1) - 8;
      d = `M${x0},${y0} H${midX} V${y1} H${x1 - 1}`;
    } else {
      // finish -> start
      const x0 = pEndX, y0 = pY;
      const x1 = sStartX, y1 = sY;
      if (x1 >= x0 + 6) {
        const midX = x0 + Math.max(6, (x1 - x0) / 2);
        d = `M${x0},${y0} H${midX} V${y1} H${x1 - 1}`;
      } else {
        const detour = x0 + 8;
        d = `M${x0},${y0} H${detour} V${(y0 + y1) / 2} H${x1 - 10} V${y1} H${x1 - 1}`;
      }
    }

    const path = el('path', { d, class: 'gantt-arrow' + (crit ? ' crit' : ''), stroke, fill: 'none', 'marker-end': markerRef });
    return path;
  }

  // ---------- left table ----------
  function buildLeftHeader() {
    return `<div class="gantt-left-header">
      <div class="glh glh-name">Tugas</div>
      <div class="glh glh-dur">Dur</div>
      <div class="glh glh-start">Mulai</div>
      <div class="glh glh-finish">Selesai</div>
      <div class="glh glh-slack">Slack</div>
    </div>`;
  }

  function buildLeftRow(r) {
    const t = r.task;
    const indent = r.depth * 16;
    const crit = r.critical ? ' crit' : '';
    const summary = r.isSummary ? ' summary' : '';
    const dow = r.ES ? dayName(dayOfWeek(r.ES)) : '';
    const dowEnd = r.EF ? dayName(dayOfWeek(r.EF)) : '';
    const resourceDots = (t.resources || []).map(id => {
      const res = S.getResource(id);
      return res ? `<span class="res-dot" title="${escapeHtml(res.name)}">${escapeHtml((res.name || '?')[0])}</span>` : '';
    }).join('');
    return `<div class="gantt-left-row${crit}${summary}" data-task-id="${t.id}" style="height:${ROW_H}px">
      <div class="glc glc-name" style="padding-left:${8 + indent}px">
        <span class="pri-dot" style="background:${t.color}"></span>
        <span class="task-name">${escapeHtml(t.name)}</span>
        ${resourceDots}
      </div>
      <div class="glc glc-dur">${r.isSummary ? '—' : t.duration + ' hr'}</div>
      <div class="glc glc-start">${r.ES ? dow + ' ' + r.ES.getUTCDate() : '—'}</div>
      <div class="glc glc-finish">${r.EF ? dowEnd + ' ' + r.EF.getUTCDate() : '—'}</div>
      <div class="glc glc-slack${r.critical ? ' crit' : ''}">${r.slack != null ? r.slack : '—'}</div>
    </div>`;
  }

  // ---- helper closure filled at draw time ----
  let modelRowById;

  // -------------------------------------------------------------------------
  // Public render entry
  // -------------------------------------------------------------------------
  function draw(container, model) {
    const { rows, res, calendar, today } = model;
    container.innerHTML = '';
    if (!rows.length) {
      container.innerHTML = '<div class="gantt-empty">Belum ada tugas. Tambahkan tugas pertama di tab <b>Tugas</b>.</div>';
      return;
    }

    let minD = null, maxD = null;
    rows.forEach(r => {
      if (!r.ES) return;
      if (!minD || compare(r.ES, minD) < 0) minD = r.ES;
      if (!maxD || compare(r.EF, maxD) > 0) maxD = r.EF;
    });
    if (!minD) minD = parseDate(S.getState().project.startDate || fmtDate(new Date()));
    if (!maxD || compare(maxD, minD) <= 0) maxD = addDays(minD, 30);
    const padStart = addDays(minD, -3);
    const padEnd = addDays(maxD, 7);
    const totalDays = daysBetween(padStart, padEnd) + 1;
    const timelineW = Math.max(600, Math.round(totalDays * pxPerDay));
    const bodyH = rows.length * ROW_H;

    // expose for helpers
    const rowById = {}; rows.forEach(r => { rowById[r.task.id] = r; });
    modelRowById = (id) => rowById[id];

    const wrap = document.createElement('div');
    wrap.className = 'gantt-wrap';

    const left = document.createElement('div');
    left.className = 'gantt-left';
    left.innerHTML = buildLeftHeader() + '<div class="gantt-left-body">' + rows.map(r => buildLeftRow(r)).join('') + '</div>';

    const right = document.createElement('div');
    right.className = 'gantt-right';

    const svg = el('svg', { width: timelineW, height: HEADER_H + bodyH, class: 'gantt-svg' });
    const defs = el('defs');
    defs.appendChild(marker('#8a94a6'));
    defs.appendChild(marker('#e0455a'));
    svg.appendChild(defs);

    svg.appendChild(renderHeader(padStart, totalDays, timelineW));
    svg.appendChild(renderGrid(padStart, totalDays, bodyH, calendar, timelineW));

    const yOf = {}; rows.forEach((r, i) => { yOf[r.task.id] = i; });

    const linkLayer = el('g', { class: 'gantt-links' });
    const barLayer = el('g', { class: 'gantt-bars' });

    rows.forEach((r, i) => {
      if (!r.ES) return;
      barLayer.appendChild(buildBarReal(r, i, padStart, calendar));
    });
    rows.forEach((r) => {
      S.getEffectivePredecessors(r.task).forEach(p => {
        const a = buildArrow(p, r, yOf, res.byId, padStart, calendar);
        if (a) linkLayer.appendChild(a);
      });
    });

    svg.appendChild(linkLayer);
    svg.appendChild(barLayer);

    if (today && compare(today, padStart) >= 0 && compare(today, padEnd) <= 0) {
      const x = daysBetween(padStart, today) * pxPerDay + pxPerDay / 2;
      svg.appendChild(el('line', { x1: x, y1: 0, x2: x, y2: HEADER_H + bodyH, class: 'gantt-today' }));
    }

    right.appendChild(svg);

    const leftBody = left.querySelector('.gantt-left-body');
    leftBody.addEventListener('scroll', () => { right.scrollTop = leftBody.scrollTop; });
    right.addEventListener('scroll', () => { leftBody.scrollTop = right.scrollTop; });

    wrap.appendChild(left);
    wrap.appendChild(right);
    container.appendChild(wrap);

    container.querySelectorAll('[data-task-id]').forEach(node => {
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        if (global.App && global.App.selectTask) global.App.selectTask(node.getAttribute('data-task-id'));
      });
    });
  }

  global.Gantt = { draw, setZoom, ZOOMS, ROW_H };
})(window);
