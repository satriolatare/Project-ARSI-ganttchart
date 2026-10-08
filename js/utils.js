/* =========================================================================
 * utils.js — Date helpers & working-day calendar
 * All dates are handled as UTC to avoid DST pitfalls.
 * Canonical date format: "YYYY-MM-DD"
 * ========================================================================= */
(function (global) {
  'use strict';

  const MS_DAY = 86400000;

  // ---- core date parse/format -------------------------------------------
  function parseDate(str) {
    if (str instanceof Date) return new Date(str.getTime());
    if (typeof str === 'number') return new Date(str);
    const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) throw new Error('Invalid date: ' + str);
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0));
  }

  function fmtDate(d) {
    const dt = (d instanceof Date) ? d : parseDate(d);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function addDays(d, n) {
    const dt = parseDate(d);
    return new Date(dt.getTime() + n * MS_DAY);
  }

  function startOfDay(d) { const dt = parseDate(d); dt.setUTCHours(0,0,0,0); return dt; }
  function sameDay(a, b) { return fmtDate(a) === fmtDate(b); }
  function dayOfWeek(d) { return parseDate(d).getUTCDay(); } // 0=Sun..6=Sat
  function compare(a, b) { return parseDate(a).getTime() - parseDate(b).getTime(); }
  function minDate(a, b) { return compare(a, b) <= 0 ? a : b; }
  function maxDate(a, b) { return compare(a, b) >= 0 ? a : b; }
  function daysBetween(a, b) { // calendar days from a -> b
    return Math.round((startOfDay(b) - startOfDay(a)) / MS_DAY);
  }

  const MONTHS_ID = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const DAYS_ID = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
  const DAYS_ID_FULL = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  const MONTHS_ID_FULL = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

  function monthName(m) { return MONTHS_ID[m]; }
  function monthNameFull(m) { return MONTHS_ID_FULL[m]; }
  function dayName(dow) { return DAYS_ID[dow]; }
  function dayNameFull(dow) { return DAYS_ID_FULL[dow]; }

  function formatDatePretty(d) {
    const dt = parseDate(d);
    return `${dt.getUTCDate()} ${MONTHS_ID[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
  }

  // ---- working-day calendar ---------------------------------------------
  // calendar = { weekendDays: [0,6], holidays: ['YYYY-MM-DD', ...] }
  function isWeekend(d, calendar) {
    return calendar.weekendDays.indexOf(dayOfWeek(d)) !== -1;
  }
  function isHoliday(d, calendar) {
    const s = fmtDate(d);
    return calendar.holidays.indexOf(s) !== -1;
  }
  function isWorkingDay(d, calendar) {
    return !isWeekend(d, calendar) && !isHoliday(d, calendar);
  }
  function snapToWorkingDay(d, calendar) {
    let dt = parseDate(d);
    let guard = 0;
    while (!isWorkingDay(dt, calendar) && guard++ < 10000) dt = addDays(dt, 1);
    return dt;
  }
  function snapBackToWorkingDay(d, calendar) {
    let dt = parseDate(d);
    let guard = 0;
    while (!isWorkingDay(dt, calendar) && guard++ < 10000) dt = addDays(dt, -1);
    return dt;
  }

  // add n working days (n may be negative). n=0 returns nearest working day forward.
  function addWorkingDays(d, n, calendar) {
    let dt = parseDate(d);
    let remaining = n;
    let guard = 0;
    if (remaining >= 0) {
      // step forward until we've counted `remaining` working days
      while (remaining > 0 && guard++ < 100000) {
        dt = addDays(dt, 1);
        if (isWorkingDay(dt, calendar)) remaining--;
      }
    } else {
      while (remaining < 0 && guard++ < 100000) {
        dt = addDays(dt, -1);
        if (isWorkingDay(dt, calendar)) remaining++;
      }
    }
    return dt;
  }

  function removeWorkingDays(d, n, calendar) { return addWorkingDays(d, -n, calendar); }

  // number of working days strictly after `a`, up to and including `b` (signed)
  function diffWorkingDays(a, b, calendar) {
    if (sameDay(a, b)) return 0;
    const sign = compare(b, a) > 0 ? 1 : -1;
    let count = 0;
    let dt = parseDate(a);
    let guard = 0;
    while (!sameDay(dt, b) && guard++ < 200000) {
      dt = addDays(dt, sign);
      if (isWorkingDay(dt, calendar)) count++;
    }
    return sign * count;
  }

  function countWorkingDaysInclusive(a, b, calendar) {
    const diff = diffWorkingDays(a, b, calendar);
    if (diff < 0) return 0;
    return diff + 1;
  }

  function eachDay(a, b) {
    const out = [];
    let dt = parseDate(a);
    const end = parseDate(b);
    let guard = 0;
    while (compare(dt, end) <= 0 && guard++ < 20000) {
      out.push(dt);
      dt = addDays(dt, 1);
    }
    return out;
  }

  function eachWorkingDay(a, b, calendar) {
    return eachDay(a, b).filter(d => isWorkingDay(d, calendar));
  }

  // ---- misc -------------------------------------------------------------
  function uid(prefix) {
    return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  }

  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function formatNumber(n) {
    return Number(n || 0).toLocaleString('id-ID');
  }

  function formatCurrency(n) {
    return 'Rp ' + Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 });
  }

  global.GCAL = {
    MS_DAY, parseDate, fmtDate, addDays, startOfDay, sameDay, dayOfWeek,
    compare, minDate, maxDate, daysBetween,
    monthName, monthNameFull, dayName, dayNameFull, formatDatePretty,
    isWeekend, isHoliday, isWorkingDay, snapToWorkingDay, snapBackToWorkingDay,
    addWorkingDays, removeWorkingDays, diffWorkingDays, countWorkingDaysInclusive,
    eachDay, eachWorkingDay,
    uid, deepClone, escapeHtml, formatNumber, formatCurrency
  };
})(window);
