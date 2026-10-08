/* =========================================================================
 * pert.js — PERT network diagram renderer (SVG)
 * Nodes = tasks (with ES/EF/LS/LF/duration), edges = dependencies.
 * Critical path highlighted in red. Layered left-to-right by topological depth.
 * ========================================================================= */
(function (global) {
  'use strict';

  const U = global.GCAL;
  const S = global.Store;
  const { escapeHtml } = U;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const NODE_W = 168;
  const NODE_H = 74;
  const H_GAP = 70;   // horizontal gap between layers
  const V_GAP = 24;   // vertical gap between nodes in a layer

  function el(tag, attrs, text) {
    const e = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  function fmt(d) { return d ? (d.getUTCMonth() + 1) + '/' + d.getUTCDate() : '-'; }

  function draw(container, model) {
    const { rows, res } = model;
    container.innerHTML = '';
    if (!rows.length) {
      container.innerHTML = '<div class="gantt-empty">Belum ada tugas untuk dianalisis.</div>';
      return;
    }

    // Build node map
    const rowById = {}; rows.forEach(r => { rowById[r.task.id] = r; });

    // Compute layer (depth) via longest path from sources using effective predecessors
    const layer = {};
    const memo = {};
    function computeLayer(id, seen) {
      if (memo[id] != null) return memo[id];
      if (seen.has(id)) return 0; // cycle guard
      seen.add(id);
      const r = rowById[id];
      const preds = S.getEffectivePredecessors(r.task).filter(p => rowById[p.taskId]);
      let l = 0;
      preds.forEach(p => { l = Math.max(l, computeLayer(p.taskId, seen) + 1); });
      memo[id] = l;
      return l;
    }
    rows.forEach(r => computeLayer(r.task.id, new Set()));

    // Group by layer
    const layers = {};
    rows.forEach(r => {
      const l = memo[r.task.id] || 0;
      (layers[l] = layers[l] || []).push(r);
    });
    // sort within layer by ES
    Object.keys(layers).forEach(l => {
      layers[l].sort((a, b) => U.compare(a.ES || 0, b.ES || 0) || a.task.name.localeCompare(b.task.name));
    });

    const maxLayer = Math.max.apply(null, Object.keys(layers).map(Number).concat([0]));

    // Position nodes
    const pos = {};
    let maxH = 0;
    for (let l = 0; l <= maxLayer; l++) {
      const list = layers[l] || [];
      const colH = list.length * (NODE_H + V_GAP) - V_GAP;
      maxH = Math.max(maxH, colH);
    }
    for (let l = 0; l <= maxLayer; l++) {
      const list = layers[l] || [];
      const colH = list.length * (NODE_H + V_GAP) - V_GAP;
      const offsetY = (maxH - colH) / 2;
      const x = 30 + l * (NODE_W + H_GAP);
      list.forEach((r, i) => {
        const y = 30 + offsetY + i * (NODE_H + V_GAP);
        pos[r.task.id] = { x, y, r };
      });
    }

    const width = 30 + (maxLayer + 1) * (NODE_W + H_GAP) + 30;
    const height = 60 + maxH + 40;

    const svg = el('svg', { width, height, class: 'pert-svg' });

    const defs = el('defs');
    defs.appendChild(mkMarker('pert-arrow', '#8a94a6'));
    defs.appendChild(mkMarker('pert-arrow-crit', '#e0455a'));
    svg.appendChild(defs);

    // Edges
    const edgeLayer = el('g', { class: 'pert-edges' });
    rows.forEach(r => {
      const to = pos[r.task.id];
      if (!to) return;
      S.getEffectivePredecessors(r.task).forEach(p => {
        const from = pos[p.taskId];
        if (!from) return;
        const crit = from.r.critical && to.r.critical;
        const x0 = from.x + NODE_W, y0 = from.y + NODE_H / 2;
        const x1 = to.x, y1 = to.y + NODE_H / 2;
        const midX = x0 + (x1 - x0) / 2;
        let d;
        if (p.type === 'SS') {
          // start -> start: from left side of from-node top to left of to-node
          const a0x = from.x, a0y = from.y + 12;
          const a1x = to.x, a1y = to.y + 12;
          const m = Math.min(a0x, a1x) - 24;
          d = `M${a0x},${a0y} H${m} V${a1y} H${a1x - 1}`;
        } else {
          const dx = Math.max(20, (x1 - x0) / 2);
          d = `M${x0},${y0} H${x0 + dx} V${y1} H${x1 - 1}`;
        }
        edgeLayer.appendChild(el('path', {
          d, class: 'pert-edge' + (crit ? ' crit' : ''),
          stroke: crit ? '#e0455a' : '#8a94a6', fill: 'none',
          'marker-end': crit ? 'url(#pert-arrow-crit)' : 'url(#pert-arrow)'
        }));
        // link type label
        const lx = (x0 + x1) / 2, ly = (y0 + y1) / 2 - 6;
        edgeLayer.appendChild(el('text', { x: lx, y: ly, class: 'pert-edge-label' }, p.type + (p.lag ? `+${p.lag}` : '')));
      });
    });
    svg.appendChild(edgeLayer);

    // Nodes
    const nodeLayer = el('g', { class: 'pert-nodes' });
    rows.forEach(r => {
      const p = pos[r.task.id];
      if (!p) return;
      const g = el('g', { class: 'pert-node' + (r.critical ? ' crit' : ''), 'data-task-id': r.task.id, transform: `translate(${p.x},${p.y})` });
      g.appendChild(el('rect', { width: NODE_W, height: NODE_H, rx: 8, class: 'pert-node-box' + (r.critical ? ' crit' : '') }));
      // header strip
      g.appendChild(el('rect', { width: NODE_W, height: 22, rx: 8, class: 'pert-node-head' + (r.critical ? ' crit' : ''), fill: r.task.color || '#4ea1f3' }));
      g.appendChild(el('rect', { y: 14, width: NODE_W, height: 8, fill: r.task.color || '#4ea1f3' }));
      const name = r.task.name.length > 20 ? r.task.name.slice(0, 19) + '…' : r.task.name;
      g.appendChild(el('text', { x: 6, y: 15, class: 'pert-node-name' }, name));

      // 2x2 grid: ES / EF / LS / LF
      const rows4 = [
        ['ES', fmt(r.ES)], ['EF', fmt(r.EF)],
        ['LS', fmt(r.LS)], ['LF', fmt(r.LF)]
      ];
      rows4.forEach((pair, idx) => {
        const col = idx % 2, row = Math.floor(idx / 2);
        const tx = 6 + col * (NODE_W / 2);
        const ty = 36 + row * 17;
        g.appendChild(el('text', { x: tx, y: ty, class: 'pert-node-lbl' }, pair[0] + ':'));
        g.appendChild(el('text', { x: tx + 20, y: ty, class: 'pert-node-val' }, pair[1]));
      });

      // duration + slack badge bottom
      g.appendChild(el('text', { x: 6, y: NODE_H - 4, class: 'pert-node-meta' }, `Dur: ${r.task.duration} hr`));
      const slackTxt = 'Slack: ' + (r.slack != null ? r.slack : '-');
      g.appendChild(el('text', { x: NODE_W - 6, y: NODE_H - 4, class: 'pert-node-meta' + (r.critical ? ' crit' : ''), 'text-anchor': 'end' }, slackTxt));

      nodeLayer.appendChild(g);
    });
    svg.appendChild(nodeLayer);

    const scroll = document.createElement('div');
    scroll.className = 'pert-scroll';
    scroll.appendChild(svg);
    container.appendChild(scroll);

    container.querySelectorAll('[data-task-id]').forEach(node => {
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        if (global.App && global.App.selectTask) global.App.selectTask(node.getAttribute('data-task-id'));
      });
    });
  }

  function mkMarker(id, color) {
    const m = el('marker', { id, markerWidth: 8, markerHeight: 8, refX: 7, refY: 3, orient: 'auto' });
    m.appendChild(el('path', { d: 'M0,0 L0,6 L7,3 z', fill: color }));
    return m;
  }

  global.PERT = { draw };
})(window);
