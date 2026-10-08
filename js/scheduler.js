/* =========================================================================
 * scheduler.js — CPM engine (forward/backward pass), critical path,
 *                dependency validation.
 *
 * Strategy: the real scheduling units are LEAF tasks. Summary (parent)
 * tasks aggregate ES/EF/LS/LF from their leaf descendants. When a task
 * references a summary as a predecessor, that edge is expanded to all of
 * the summary's leaf descendants. This avoids circular dependency between
 * a summary and its children.
 * ========================================================================= */
(function (global) {
  'use strict';

  const U = global.GCAL;
  const {
    parseDate, fmtDate, compare,
    snapToWorkingDay, snapBackToWorkingDay,
    addWorkingDays, removeWorkingDays, diffWorkingDays
  } = U;

  // ---- leaf helpers -----------------------------------------------------
  function isSummary(store, task) { return store.getChildren(task.id).length > 0; }

  // All leaf descendants of a task (if task is itself a leaf -> [task]).
  function leafDescendants(store, taskId) {
    const t = store.getTask(taskId);
    if (!t) return [];
    const kids = store.getChildren(taskId);
    if (!kids.length) return [taskId];
    return kids.reduce((acc, k) => acc.concat(leafDescendants(store, k.id)), []);
  }

  // Leaf-level effective predecessors for a leaf task:
  // own predecessors + predecessors inherited from ancestors,
  // each expanded to leaf descendants.
  function leafPredecessors(store, task) {
    const out = [];
    const seen = new Set();
    const addFrom = (predList) => {
      (predList || []).forEach(p => {
        leafDescendants(store, p.taskId).forEach(leafId => {
          const key = leafId + '|' + (p.type || 'FS');
          if (seen.has(key) || leafId === task.id) return;
          seen.add(key);
          out.push({ taskId: leafId, type: p.type || 'FS', lag: p.lag || 0 });
        });
      });
    };
    addFrom(task.predecessors);
    store.getAncestors(task).forEach(a => addFrom(a.predecessors));
    return out;
  }

  // Topological order over leaf tasks only.
  function topoLeaves(store, leaves) {
    const ids = leaves.map(t => t.id);
    const idset = new Set(ids);
    const indeg = {}, adj = {};
    ids.forEach(id => { indeg[id] = 0; adj[id] = []; });
    const addEdge = (a, b) => { if (a === b || !idset.has(a) || !idset.has(b)) return; adj[a].push(b); indeg[b]++; };
    leaves.forEach(t => { leafPredecessors(store, t).forEach(p => addEdge(p.taskId, t.id)); });
    const queue = ids.filter(id => indeg[id] === 0);
    const order = [];
    while (queue.length) {
      const id = queue.shift();
      order.push(id);
      adj[id].forEach(nb => { if (--indeg[nb] === 0) queue.push(nb); });
    }
    const cyclic = order.length !== ids.length;
    ids.forEach(id => { if (order.indexOf(id) === -1) order.push(id); });
    return { order, cyclic };
  }

  // ---- cycle detection on add ------------------------------------------
  function wouldCreateCycle(store, toId, fromId) {
    const tasks = store.getState().tasks;
    const leaves = tasks.filter(t => !isSummary(store, t));
    const adj = {};
    leaves.forEach(t => { adj[t.id] = leafPredecessors(store, t).map(p => p.taskId); });
    const fromLeaves = leafDescendants(store, fromId);
    const toLeaves = leafDescendants(store, toId);
    if (!fromLeaves.length || !toLeaves.length) return false;
    // A cycle forms iff some toLeaf is already reachable (via predecessor
    // links) from some fromLeaf. We do NOT include the new edge here.
    const seen = new Set();
    const stack = fromLeaves.slice();
    while (stack.length) {
      const cur = stack.pop();
      if (toLeaves.indexOf(cur) !== -1) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      (adj[cur] || []).forEach(n => stack.push(n));
    }
    return false;
  }

  // ---- main CPM ---------------------------------------------------------
  function compute(store) {
    const state = store.getState();
    const cal = state.calendar;
    const tasks = state.tasks;
    const empty = { byId: {}, projectStart: null, projectEnd: null, criticalIds: [], cyclic: false, order: [] };
    if (!tasks.length) return empty;

    const byId = {};
    tasks.forEach(t => {
      byId[t.id] = { task: t, ES: null, EF: null, LS: null, LF: null, slack: null, critical: false, isSummary: isSummary(store, t) };
    });

    const leaves = tasks.filter(t => !byId[t.id].isSummary);
    if (!leaves.length) return empty;
    const leafIds = new Set(leaves.map(t => t.id));

    const { order, cyclic } = topoLeaves(store, leaves);
    const projStartFallback = () => snapToWorkingDay(parseDate(state.project.startDate || fmtDate(new Date())), cal);

    // ---- FORWARD PASS (leaves) ----
    order.forEach(id => {
      const node = byId[id];
      const t = node.task;
      const preds = leafPredecessors(store, t).filter(p => leafIds.has(p.taskId));
      let es;
      if (!preds.length) {
        const manual = t.startDate ? parseDate(t.startDate) : parseDate(state.project.startDate || fmtDate(new Date()));
        es = snapToWorkingDay(manual, cal);
      } else {
        let best = null;
        preds.forEach(p => {
          const pe = byId[p.taskId];
          if (!pe || !pe.ES) return;
          let cand = (p.type === 'SS')
            ? addWorkingDays(pe.ES, p.lag || 0, cal)
            : addWorkingDays(pe.EF, (p.lag || 0) + 1, cal);
          cand = snapToWorkingDay(cand, cal);
          if (!best || compare(cand, best) > 0) best = cand;
        });
        es = best || projStartFallback();
      }
      const dur = Math.max(0, t.duration || 0);
      const ef = dur <= 0 ? es : snapBackToWorkingDay(addWorkingDays(es, dur - 1, cal), cal);
      node.ES = es; node.EF = ef;
    });

    // ---- project span (leaves) ----
    let projectStart = null, projectEnd = null;
    leaves.forEach(t => {
      const n = byId[t.id];
      if (!n.ES) return;
      if (!projectStart || compare(n.ES, projectStart) < 0) projectStart = n.ES;
      if (!projectEnd || compare(n.EF, projectEnd) > 0) projectEnd = n.EF;
    });

    // ---- BACKWARD PASS (leaves) ----
    const succOf = {};
    leaves.forEach(t => { succOf[t.id] = []; });
    leaves.forEach(t => {
      leafPredecessors(store, t).forEach(p => {
        if (succOf[p.taskId]) succOf[p.taskId].push({ id: t.id, type: p.type, lag: p.lag || 0 });
      });
    });

    leaves.forEach(t => { byId[t.id].LF = projectEnd ? projectEnd : byId[t.id].EF; });
    const computeLS = (node) => {
      const dur = Math.max(0, node.task.duration || 0);
      return dur <= 0 ? node.LF : snapToWorkingDay(removeWorkingDays(node.LF, dur - 1, cal), cal);
    };
    leaves.forEach(t => { byId[t.id].LS = computeLS(byId[t.id]); });

    for (let pass = 0; pass < 3; pass++) {
      order.forEach(id => {
        const node = byId[id];
        const succs = succOf[id] || [];
        if (!succs.length) {
          node.LF = projectEnd ? projectEnd : node.EF;
        } else {
          let minLF = null;
          succs.forEach(s => {
            const succ = byId[s.id];
            if (!succ || !succ.LS) return;
            let lf;
            if (s.type === 'FS') {
              lf = snapBackToWorkingDay(removeWorkingDays(succ.LS, (s.lag || 0) + 1, cal), cal);
            } else {
              const ls = snapBackToWorkingDay(removeWorkingDays(succ.LS, s.lag || 0, cal), cal);
              const dur = Math.max(0, node.task.duration || 0);
              lf = dur <= 0 ? ls : snapBackToWorkingDay(addWorkingDays(ls, dur - 1, cal), cal);
            }
            if (!minLF || compare(lf, minLF) < 0) minLF = lf;
          });
          if (minLF) node.LF = minLF;
        }
        if (node.ES && compare(node.LF, node.ES) < 0) node.LF = node.EF;
        node.LS = computeLS(node);
      });
    }

    // ---- SLACK & CRITICAL (leaves) ----
    leaves.forEach(t => {
      const n = byId[t.id];
      n.slack = (n.ES && n.LS) ? diffWorkingDays(n.ES, n.LS, cal) : 0;
      n.critical = n.slack === 0;
    });

    // ---- AGGREGATE SUMMARIES from leaf descendants ----
    tasks.filter(t => byId[t.id].isSummary).forEach(t => {
      const node = byId[t.id];
      const lids = leafDescendants(store, t.id).filter(lid => byId[lid] && byId[lid].ES);
      if (lids.length) {
        const pick = (field, cmp) => lids.map(l => byId[l][field]).reduce((acc, d) => (cmp(d, acc) < 0 ? d : acc), byId[lids[0]][field]);
        node.ES = pick('ES', compare);
        node.EF = lids.map(l => byId[l].EF).reduce((acc, d) => (compare(d, acc) > 0 ? d : acc), byId[lids[0]].EF);
        node.LS = pick('LS', compare);
        node.LF = lids.map(l => byId[l].LF).reduce((acc, d) => (compare(d, acc) > 0 ? d : acc), byId[lids[0]].LF);
        node.slack = (node.ES && node.LS) ? diffWorkingDays(node.ES, node.LS, cal) : 0;
        node.critical = lids.some(l => byId[l].critical);
      } else {
        const s = projStartFallback();
        node.ES = s; node.EF = s; node.LS = s; node.LF = s; node.slack = 0; node.critical = false;
      }
    });

    const criticalIds = Object.keys(byId).filter(id => byId[id].critical);
    return { byId, projectStart, projectEnd, criticalIds, cyclic, order };
  }

  function scheduleList(store) {
    const res = compute(store);
    const tree = store.getTaskTree();
    const rows = tree.map(({ task, depth }) => {
      const n = res.byId[task.id] || {};
      return { task, depth, ES: n.ES, EF: n.EF, LS: n.LS, LF: n.LF, slack: n.slack, critical: n.critical, isSummary: n.isSummary };
    });
    return { res, rows };
  }

  global.Scheduler = { compute, scheduleList, topoLeaves, wouldCreateCycle, leafDescendants, leafPredecessors };
})(window);
