/* Inkling — app.js
   No framework, no build step. Everything lives in localStorage. */
(() => {
  'use strict';

  const STORE_KEY = 'inkling.v2';
  const OLD_KEY = 'inkling.v1';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const DAY = 86400000;
  const DAY_END = 21; // the hour the day is considered over, for the daylight meter
  const todayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const escape = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ── state ──────────────────────────────────── */
  function blank() {
    return { todos: [], deleted: [], history: {}, focus: {}, journal: {}, sound: true, theme: 'auto', doneOpen: true, somedayOpen: false, seeded: false, lastDay: null };
  }
  function migrate(t) {
    const base = { note: '', when: 'next', est: null, repeat: null, carried: 0, tags: [], prio: 0, due: null, touched: t.created || Date.now(), ...t };
    base.updated = base.updated || base.touched;
    return base;
  }
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || localStorage.getItem(OLD_KEY) || 'null');
      if (raw && Array.isArray(raw.todos)) {
        const s = { ...blank(), ...raw };
        s.todos = s.todos.map(migrate);
        return s;
      }
    } catch (_) { /* fall through to a blank page */ }
    return blank();
  }
  const state = load();
  /* every change lands in localStorage; the user's own changes also go to the sync server, when there is one */
  function save(fromSync = false) {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    if (!fromSync) sync.changed();
  }
  function forget(id) { state.deleted = (state.deleted || []).filter(d => d.id !== id); state.deleted.push({ id, at: Date.now() }); }
  function unforget(id) { state.deleted = (state.deleted || []).filter(d => d.id !== id); }

  /* ── sync: the same page on every device ────── */
  const SYNC_KEYS = ['todos', 'deleted', 'history', 'focus', 'journal'];
  const syncable = s => Object.fromEntries(SYNC_KEYS.map(k => [k, s[k] || (k === 'todos' || k === 'deleted' ? [] : {})]));
  const stampOf = t => Math.max(t.updated || 0, t.touched || 0, t.completed || 0, t.created || 0);

  /* fold the server's copy into ours: newest version of each task wins, deletions travel as tombstones */
  function mergeInto(local, remote) {
    const before = JSON.stringify(syncable(local));
    if (remote.todos.length && local.todos.length && local.todos.every(t => t.seed)) local.todos = []; // a fresh device keeps the real list, not the demo
    const tomb = new Map();
    for (const d of [...(local.deleted || []), ...(remote.deleted || [])]) if (!tomb.has(d.id) || tomb.get(d.id) < d.at) tomb.set(d.id, d.at);
    const byId = new Map();
    for (const t of [...remote.todos.map(migrate), ...local.todos]) { // local last, so ties keep what is on screen
      const cur = byId.get(t.id);
      if (!cur || stampOf(t) > stampOf(cur)) byId.set(t.id, t);
    }
    const order = local.todos.map(t => t.id);
    remote.todos.forEach((t, i) => {
      if (order.includes(t.id)) return;
      let at = 0;
      for (let j = i - 1; j >= 0; j--) { const k = order.indexOf(remote.todos[j].id); if (k >= 0) { at = k + 1; break; } }
      order.splice(at, 0, t.id);
    });
    local.todos = order.map(id => byId.get(id)).filter(t => t && !(tomb.has(t.id) && tomb.get(t.id) > stampOf(t)));
    local.deleted = [...tomb].filter(([, at]) => Date.now() - at < 30 * DAY).map(([id, at]) => ({ id, at }));
    for (const k of ['history', 'focus']) { local[k] = local[k] || {}; for (const [d, n] of Object.entries(remote[k] || {})) local[k][d] = Math.max(local[k][d] || 0, n); }
    local.journal = local.journal || {};
    for (const [d, j] of Object.entries(remote.journal || {})) if (!local.journal[d] || (j.closed || 0) > (local.journal[d].closed || 0)) local.journal[d] = j;
    return JSON.stringify(syncable(local)) !== before;
  }

  const sync = (() => {
    let base = null, rev = null, dirty = false, pushTimer = null, pulling = false;
    const setStatus = (s, title) => { el.syncDot.dataset.state = s; el.syncDot.title = title || ''; el.syncDot.hidden = s === 'off'; };
    const req = (method, body) => fetch(base + '/sync', { method, credentials: 'include', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body && JSON.stringify(body) });
    const offline = () => setStatus('offline', 'Offline. Changes stay here and sync when you are back.');
    const locked = () => setStatus('locked', 'Sync is locked out. Log in to ShellTeam on this device, then reload.');
    async function init() {
      let cfg = null;
      try { const r = await fetch('sync.json', { cache: 'no-store' }); if (r.ok) cfg = await r.json(); } catch (_) { /* no server, no sync */ }
      if (!cfg || cfg.url == null) return setStatus('off');
      base = cfg.url.replace(/\/$/, '');
      setStatus('syncing', 'Syncing');
      await pull();
      setInterval(pull, 20000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
      addEventListener('online', pull);
      el.syncDot.addEventListener('click', pull);
    }
    function adopt(doc) {
      rev = doc.rev;
      if (!doc.state) { dirty = true; return; }
      if (mergeInto(state, doc.state)) { save(true); staleId = chooseStale(); render(); }
    }
    async function pull() {
      if (base == null || pulling) return;
      pulling = true;
      try {
        const r = await req('GET');
        if (r.status === 401 || r.status === 403) return locked();
        if (!r.ok) throw new Error(r.status);
        const doc = await r.json();
        if (doc.rev !== rev) adopt(doc);
        if (dirty) await push(); else setStatus('ok', 'Synced');
      } catch (_) { offline(); }
      finally { pulling = false; }
    }
    async function push(tries = 0) {
      if (base == null) return;
      const r = await req('PUT', { baseRev: rev ?? 0, state: syncable(state) });
      if (r.status === 409 && tries < 5) { adopt(await r.json()); return push(tries + 1); }
      if (r.status === 401 || r.status === 403) return locked();
      if (!r.ok) throw new Error(r.status);
      rev = (await r.json()).rev; dirty = false; setStatus('ok', 'Synced');
    }
    function changed() {
      dirty = true;
      if (base == null) return;
      setStatus('syncing', 'Saving');
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => push().catch(offline), 700);
    }
    return { init, changed, pull };
  })();
  window.inkling = { pull: sync.pull }; // a handle for tests and the curious

  /* first visit: a gentle demo so the page isn't a blank stare */
  if (!state.seeded && state.todos.length === 0) {
    const t = Date.now(), base = startOfDay();
    const mk = (text, extra = {}) => migrate({ id: uid(), text, done: false, seed: true, created: t - (state.todos.length + 1), ...extra });
    state.todos = [
      mk('Type a task above and press enter', { when: 'today' }),
      mk('Tick this one, listen closely', { when: 'today', est: 5 }),
      mk('Press n and the page picks one thing for you', { when: 'today', est: 25 }),
      mk('Read something on paper', { when: 'evening', est: 20 }),
      mk('Drag me up into today', { prio: 2, due: base + DAY }),
      mk('Water the ferns', { repeat: { every: 1, unit: 'week', weekday: 0 }, due: nextWeekday(base, 0, true), tags: ['home'] }),
      mk('Press ? for the little tricks', { tags: ['hint'] }),
      mk('Learn to whistle properly', { when: 'someday' }),
    ];
    state.seeded = true;
    save(true);
  }

  /* ── dom ────────────────────────────────────── */
  const el = {
    html: document.documentElement,
    greeting: $('#greeting'), date: $('#date'), headline: $('#headline'), summary: $('#summary'),
    composer: $('#composer'), input: $('#input'), hints: $('#hints'),
    filterBar: $('#filterBar'), filterText: $('#filterText'), filterClear: $('#filterClear'),
    todaySection: $('#todaySection'), today: $('#today'), evening: $('#evening'), eveningHead: $('#eveningHead'),
    emptyToday: $('#emptyToday'), emptyTodayText: $('#emptyTodayText'),
    capText: $('#capText'), capFill: $('#capFill'), capacity: $('#capacity'), startBtn: $('#startBtn'),
    nextSection: $('#nextSection'), next: $('#next'), nextCount: $('#nextCount'),
    somedaySection: $('#somedaySection'), someday: $('#someday'), somedayToggle: $('#somedayToggle'), somedayCount: $('#somedayCount'),
    empty: $('#empty'), emptyText: $('#emptyText'),
    doneSection: $('#doneSection'), done: $('#done'), doneToggle: $('#doneToggle'), doneCount: $('#doneCount'), clearDone: $('#clearDone'),
    week: $('#week'), syncDot: $('#syncDot'), closeDayBtn: $('#closeDayBtn'), soundBtn: $('#soundBtn'), themeBtn: $('#themeBtn'), helpBtn: $('#helpBtn'),
    help: $('#help'), helpClose: $('#helpClose'), exportBtn: $('#exportBtn'), importBtn: $('#importBtn'), importFile: $('#importFile'), copyBtn: $('#copyBtn'),
    closeDay: $('#closeDay'), closeDayInner: $('#closeDayInner'), ledger: $('#ledger'), ledgerInner: $('#ledgerInner'),
    focus: $('#focus'), focusText: $('#focusText'), focusNote: $('#focusNote'), focusTime: $('#focusTime'), focusHint: $('#focusHint'),
    hgTop: $('#hgTop'), hgBottom: $('#hgBottom'), hgStream: $('#hgStream'),
    focusDone: $('#focusDone'), focusMore: $('#focusMore'), focusNext: $('#focusNext'), focusStop: $('#focusStop'),
    toast: $('#toast'), toastText: $('#toastText'), toastUndo: $('#toastUndo'),
    confetti: $('#confetti'), template: $('#todoTemplate'),
  };
  const lists = { today: el.today, evening: el.evening, next: el.next, someday: el.someday };
  const nodes = new Map(); // id -> li

  /* ── natural language ───────────────────────── */
  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
  const weekdayIndex = s => WEEKDAYS.findIndex(w => w.startsWith(s.toLowerCase().slice(0, 3)));

  function nextWeekday(from, idx, allowToday) {
    const d = new Date(from).getDay();
    let delta = (idx - d + 7) % 7;
    if (delta === 0 && !allowToday) delta = 7;
    return from + delta * DAY;
  }

  function parse(input) {
    let text = ' ' + input.trim() + ' ';
    let due = null, prio = 0, est = null, repeat = null, when = null, note = '';
    const tags = [];
    const base = startOfDay();

    const noteAt = text.indexOf('//');
    if (noteAt >= 0) { note = text.slice(noteAt + 2).trim(); text = text.slice(0, noteAt) + ' '; }

    const take = (re, fn) => {
      const m = text.match(re);
      if (!m) return false;
      fn(m);
      text = text.replace(re, ' ');
      return true;
    };

    take(/\s(!{1,3})(?=\s)/, m => { prio = m[1].length; });
    text = text.replace(/\s#([\p{L}\p{N}_-]{1,24})(?=\s)/gu, (_, t) => { tags.push(t.toLowerCase()); return ' '; });

    // how long: ~30m, ~2h, ~1h30, ~1.5h, "for 45 min"
    take(/\s~(\d+(?:[.,]\d+)?)\s?(?:h|hr|hrs|hour|hours)(?:\s?(\d{1,2})\s?(?:m|min|mins)?)?(?=\s)/i, m => { est = Math.round(parseFloat(m[1].replace(',', '.')) * 60 + (m[2] ? parseInt(m[2], 10) : 0)); });
    take(/\s~(\d+)\s?(?:m|min|mins|minutes)?(?=\s)/i, m => { est = parseInt(m[1], 10); });
    take(/\sfor\s(\d+(?:[.,]\d+)?)\s?(min|mins|minutes|h|hr|hrs|hour|hours)(?=\s)/i, m => {
      const n = parseFloat(m[1].replace(',', '.'));
      est = Math.round(/^h/i.test(m[2]) ? n * 60 : n);
    });

    // repeats, before the weekday rule so "every monday" isn't read as a plain monday
    take(/\severy\s+(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:[a-z]*day)?s?(?=\s)/i, m => { repeat = { every: 1, unit: 'week', weekday: weekdayIndex(m[1]) }; });
    take(/\severy\s+(\d+|two|three|four|five|six|seven)\s+(day|week|month)s?(?=\s)/i, m => { repeat = { every: NUMBER_WORDS[m[1].toLowerCase()] ?? parseInt(m[1], 10), unit: m[2].toLowerCase() }; });
    take(/\s(?:every\s+)?(weekdays?)(?=\s)/i, () => { repeat = { every: 1, unit: 'weekday' }; });
    take(/\severy\s+(day|week|month)(?=\s)/i, m => { repeat = { every: 1, unit: m[1].toLowerCase() }; });
    take(/\s(daily|weekly|monthly)(?=\s)/i, m => { repeat = { every: 1, unit: { daily: 'day', weekly: 'week', monthly: 'month' }[m[1].toLowerCase()] }; });

    // where it lives
    take(/\s(tonight|this\s+evening|evening)(?=\s)/i, () => { when = 'evening'; due = base; });
    take(/\s(someday|one\s+day|eventually)(?=\s)/i, () => { when = 'someday'; });

    take(/\s(?:by\s|on\s|due\s)?(today)(?=\s)/i, () => { due = base; });
    take(/\s(?:by\s|on\s|due\s)?(tomorrow|tmrw|tmr)(?=\s)/i, () => { due = base + DAY; });
    take(/\s(?:by\s|on\s|due\s)?next\s+week(?=\s)/i, () => { due = base + 7 * DAY; });
    take(/\s(?:by\s|on\s|due\s)?next\s+month(?=\s)/i, () => {
      const d = new Date(base); d.setMonth(d.getMonth() + 1); due = d.getTime();
    });
    take(/\sin\s+(\d{1,2}|a|an|one|two|three|four|five|six|seven)\s+(day|days|week|weeks)(?=\s)/i, m => {
      const n = NUMBER_WORDS[m[1].toLowerCase()] ?? parseInt(m[1], 10);
      due = base + n * (m[2].toLowerCase().startsWith('week') ? 7 : 1) * DAY;
    });
    take(/\s(?:by\s|on\s|due\s|next\s|this\s)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:[a-z]*day)?(?=\s)/i, m => {
      const idx = weekdayIndex(m[1]);
      let d = nextWeekday(base, idx, false);
      if (/\snext\s/i.test(m[0]) && (d - base) / DAY !== 7) d += 7 * DAY;
      due = d;
    });
    take(/\s(?:by\s|on\s|due\s)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?=\s)/i, m => {
      const month = MONTHS.indexOf(m[1].toLowerCase().slice(0, 3));
      const d = new Date(new Date(base).getFullYear(), month, parseInt(m[2], 10));
      if (d.getTime() < base - 30 * DAY) d.setFullYear(d.getFullYear() + 1);
      due = d.getTime();
    });

    // a repeat with no day starts today (or on its weekday)
    if (repeat && due == null && when !== 'someday') due = repeat.weekday != null ? nextWeekday(base, repeat.weekday, true) : base;

    text = text.replace(/\s+/g, ' ').trim().replace(/[,\s]+$/, '');
    if (text) text = text[0].toUpperCase() + text.slice(1);
    return { text, due, prio, tags, est, repeat, when, note };
  }

  function nextDue(repeat, from) {
    const start = Math.max(from ?? startOfDay(), startOfDay());
    if (repeat.unit === 'day') return start + repeat.every * DAY;
    if (repeat.unit === 'weekday') { let d = start + DAY; while ([0, 6].includes(new Date(d).getDay())) d += DAY; return d; }
    if (repeat.unit === 'week') return repeat.weekday != null ? nextWeekday(start, repeat.weekday, false) + (repeat.every - 1) * 7 * DAY : start + repeat.every * 7 * DAY;
    const d = new Date(start); d.setMonth(d.getMonth() + repeat.every); return d.getTime();
  }
  function repeatLabel(r) {
    if (!r) return '';
    if (r.unit === 'weekday') return 'weekdays';
    if (r.unit === 'week' && r.weekday != null) return r.every === 1 ? `every ${WEEKDAYS[r.weekday]}` : `every ${r.every} weeks on ${WEEKDAYS[r.weekday]}`;
    if (r.every === 1) return { day: 'daily', week: 'weekly', month: 'monthly' }[r.unit];
    return `every ${r.every} ${r.unit}s`;
  }
  function estLabel(min) {
    if (!min) return '';
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  }
  function spanLabel(min) {
    if (min < 60) return `${Math.round(min)} min`;
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function dueLabel(due, when) {
    if (due == null) return null;
    const diff = Math.round((due - startOfDay()) / DAY);
    if (diff === 0) return { label: when === 'evening' ? 'this evening' : 'today', cls: 'soon' };
    if (diff === 1) return { label: 'tomorrow', cls: 'soon' };
    if (diff === -1) return { label: 'yesterday', cls: 'overdue' };
    if (diff < 0) return { label: `${-diff} days ago`, cls: 'overdue' };
    if (diff < 7) return { label: WEEKDAYS[new Date(due).getDay()], cls: '' };
    const d = new Date(due);
    return { label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), cls: '' };
  }

  /* where a task lives on the page */
  function sectionOf(t) {
    if (t.done) return 'done';
    if (t.when === 'someday') return 'someday';
    if (t.when === 'evening') return 'evening';
    if (t.when === 'today') return 'today';
    if (t.due != null && t.due <= startOfDay()) return 'today';
    return 'next';
  }
  const isToday = t => { const s = sectionOf(t); return s === 'today' || s === 'evening'; };
  const ageDays = t => (Date.now() - (t.touched || t.created)) / DAY;
  function touch(t) { t.touched = t.updated = Date.now(); delete t.seed; }
  function stamp(t) { t.updated = Date.now(); delete t.seed; }

  /* what to do now: a Taskwarrior-style score */
  function urgency(t) {
    let s = 0;
    if (t.due != null) {
      const d = Math.round((t.due - startOfDay()) / DAY);
      s += d <= -7 ? 12 : d < 0 ? 8.8 + -d * .46 : d === 0 ? 8.8 : d >= 14 ? 2.4 : 8.34 - (d - 1) * (5.94 / 13);
    }
    s += [0, 1.8, 3.9, 6][t.prio || 0];
    if (t.when === 'today' || t.when === 'evening') s += 5;
    s += (t.carried || 0) * 1.2;
    if (t.est && t.est <= 15) s += .5;
    s += clamp((Date.now() - t.created) / DAY, 0, 60) / 60;
    return s;
  }
  function pick(exceptId) {
    const pool = state.todos.filter(t => !t.done && t.id !== exceptId && matchesFilter(t));
    const today = pool.filter(isToday);
    const from = today.length ? today : pool.filter(t => sectionOf(t) === 'next');
    return from.sort((a, b) => urgency(b) - urgency(a))[0] || null;
  }

  /* ── a new day ──────────────────────────────── */
  function rollover() {
    const key = todayKey();
    if (state.lastDay === key) return false;
    if (state.lastDay) {
      const yesterday = startOfDay() - DAY;
      for (const t of state.todos) {
        if (t.done) continue;
        if (t.when === 'today' || t.when === 'evening' || (t.due != null && t.due <= yesterday)) {
          t.carried = (t.carried || 0) + 1;
          if (t.when === 'evening') t.when = 'today';
        }
      }
    }
    state.lastDay = key;
    save();
    return true;
  }
  rollover();

  /* ── time of day ────────────────────────────── */
  function daypart(h) { return h < 5 ? 'night' : h < 8 ? 'dawn' : h < 17 ? 'day' : h < 20 ? 'dusk' : 'night'; }
  function greeting(h) {
    if (h < 5) return 'Still up?';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    if (h < 21) return 'Good evening';
    return 'Good night';
  }
  const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth', 'twenty-first', 'twenty-second', 'twenty-third', 'twenty-fourth', 'twenty-fifth', 'twenty-sixth', 'twenty-seventh', 'twenty-eighth', 'twenty-ninth', 'thirtieth', 'thirty-first'];
  function tickClock() {
    const now = new Date();
    el.html.dataset.daypart = daypart(now.getHours());
    el.greeting.textContent = greeting(now.getHours());
    const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
    const month = now.toLocaleDateString('en-US', { month: 'long' });
    el.date.textContent = `${weekday}, the ${ORDINALS[now.getDate()]} of ${month}`;
    el.date.dateTime = todayKey(now);
    if (rollover()) { staleId = chooseStale(); render(); } // midnight rolled over
    else renderCapacity();
  }

  /* ── theme ──────────────────────────────────── */
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    const dark = state.theme === 'dark' || (state.theme === 'auto' && darkQuery.matches);
    el.html.dataset.theme = dark ? 'dark' : 'light';
    $('meta[name="theme-color"]').content = dark ? '#161513' : '#f4efe6';
  }
  darkQuery.addEventListener('change', applyTheme);
  applyTheme();
  el.themeBtn.addEventListener('click', () => {
    const dark = el.html.dataset.theme === 'dark';
    state.theme = dark ? 'light' : 'dark';
    save(); applyTheme(); sound.tick();
  });

  /* ── sound ──────────────────────────────────── */
  const sound = (() => {
    let ctx = null, streak = 0, streakTimer = null;
    const ensure = () => {
      if (!state.sound) return null;
      if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { return null; } }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    };
    const note = (freq, t0, dur, gain = .08, type = 'sine') => {
      const c = ensure(); if (!c) return;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + .008);
      g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
      o.connect(g).connect(c.destination);
      o.start(t0); o.stop(t0 + dur + .02);
    };
    return {
      complete() {
        const c = ensure(); if (!c) return;
        clearTimeout(streakTimer);
        streakTimer = setTimeout(() => { streak = 0; }, 2500);
        const mult = Math.pow(2, Math.min(streak, 7) * 2 / 12); // climbs a whole tone per consecutive tick
        streak++;
        const t = c.currentTime;
        note(523 * mult, t, .18, .07);
        note(784 * mult, t + .07, .28, .06);
        el.soundBtn.classList.remove('ping'); void el.soundBtn.offsetWidth; el.soundBtn.classList.add('ping');
      },
      tick() { const c = ensure(); if (!c) return; note(1200, c.currentTime, .05, .03, 'triangle'); },
      add() { const c = ensure(); if (!c) return; note(660, c.currentTime, .09, .04, 'triangle'); },
      remove() { const c = ensure(); if (!c) return; note(220, c.currentTime, .16, .05, 'sine'); },
      focus() { const c = ensure(); if (!c) return; const t = c.currentTime; note(392, t, .4, .05); note(587, t + .12, .6, .04); },
      timeUp() { const c = ensure(); if (!c) return; const t = c.currentTime; [784, 784, 1047].forEach((f, i) => note(f, t + i * .16, .3, .05)); },
      close() { const c = ensure(); if (!c) return; const t = c.currentTime; [784, 659, 523, 392].forEach((f, i) => note(f, t + i * .14, .55, .05)); },
      fanfare() {
        const c = ensure(); if (!c) return;
        const t = c.currentTime;
        [523, 659, 784, 1047].forEach((f, i) => note(f, t + i * .09, .5, .06));
      },
    };
  })();
  el.soundBtn.setAttribute('aria-pressed', String(state.sound));
  el.soundBtn.addEventListener('click', () => {
    state.sound = !state.sound; save();
    el.soundBtn.setAttribute('aria-pressed', String(state.sound));
    if (state.sound) sound.tick();
  });

  /* ── filter (find instead of add) ───────────── */
  let filter = '';
  function matchesFilter(t) {
    if (!filter) return true;
    const q = filter.toLowerCase();
    if (q.startsWith('#')) return (t.tags || []).some(tag => tag.startsWith(q.slice(1)));
    return t.text.toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q) || (t.tags || []).some(tag => tag.includes(q));
  }
  function setFilter(q) {
    filter = q.trim();
    el.filterBar.hidden = !filter;
    el.composer.classList.toggle('is-finding', !!filter);
    render();
  }
  el.filterClear.addEventListener('click', () => { el.input.value = ''; el.composer.classList.remove('has-text'); setFilter(''); });

  /* ── the stale one ──────────────────────────── */
  let staleId = null;
  const askedStale = new Set();
  function chooseStale() {
    const cands = state.todos.filter(t => !t.done && !askedStale.has(t.id) && ageDays(t) >= 14 && ['next', 'someday'].includes(sectionOf(t)));
    cands.sort((a, b) => (a.touched || a.created) - (b.touched || b.created));
    return cands[0]?.id || null;
  }
  staleId = chooseStale();

  /* ── rendering ──────────────────────────────── */
  const HEADLINES = { empty: 'A blank page.', clear: 'All clear.', one: 'Just one thing.', few: 'A few things.', plate: 'A full plate.', tall: 'A tall order.', closed: 'Day closed.' };
  const EMPTY_LINES = ['Nothing to do. Nothing at all.', 'The page is yours.', 'Quiet, for now.', 'Write something down.'];
  const CLEAR_LINES = ['Go outside.', 'That was everything.', 'Nothing left but the afternoon.', 'You did the things.'];
  const TODAY_EMPTY = ['Nothing lined up yet. Pull something up, or press n.', 'A clear day. Choose what belongs on it.', 'Today is blank. That can be a good thing.'];
  let lastHeadline = null, lastActive = null, lastDone = null, lastClearLine = null, todayEmptyLine = null;

  function setHeadline(text, italic) {
    if (text === lastHeadline) return;
    lastHeadline = text;
    el.headline.textContent = text;
    el.headline.classList.toggle('is-italic', !!italic);
    el.headline.classList.remove('swap'); void el.headline.offsetWidth; el.headline.classList.add('swap');
    document.title = [HEADLINES.clear, HEADLINES.empty, HEADLINES.closed].includes(text) ? 'Inkling' : `Inkling · ${text}`;
  }

  function render() {
    const now = new Date();
    const visible = state.todos.filter(matchesFilter);
    const by = { today: [], evening: [], next: [], someday: [], done: [] };
    for (const t of visible) by[sectionOf(t)].push(t);
    by.done.sort((a, b) => (b.completed || 0) - (a.completed || 0));

    // positions before, for FLIP across every list
    const first = new Map();
    $$('.todo').forEach(li => first.set(li.dataset.id, li.getBoundingClientRect().top));
    for (const k of Object.keys(lists)) reconcile(lists[k], by[k]);
    reconcile(el.done, by.done);
    if (!reduceMotion) {
      $$('.todo').forEach(li => {
        const before = first.get(li.dataset.id);
        if (before == null || li.classList.contains('dragging')) return;
        const dy = before - li.getBoundingClientRect().top;
        if (Math.abs(dy) < 1) return;
        li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.16,1,.3,1)' });
      });
    }

    const active = state.todos.filter(t => !t.done);
    const n = active.length, todayN = by.today.length + by.evening.length;
    const closed = state.journal[todayKey()]?.closed;

    // headline
    if (filter) setHeadline(`Looking for “${filter}”`, true);
    else if (state.todos.length === 0) setHeadline(HEADLINES.empty, true);
    else if (n === 0) setHeadline(HEADLINES.clear, true);
    else if (closed && now.getHours() >= 16) setHeadline(HEADLINES.closed, true);
    else setHeadline(todayN === 0 ? HEADLINES.few : todayN === 1 ? HEADLINES.one : todayN <= 3 ? HEADLINES.few : todayN <= 7 ? HEADLINES.plate : HEADLINES.tall, false);

    // summary
    const overdue = active.filter(t => t.due != null && t.due < startOfDay()).length;
    const doneToday = state.history[todayKey()] || 0;
    let html = '';
    if (filter) html = `${visible.length ? `<span class="num">${visible.length}</span>` : 'Nothing'} ${visible.length === 1 ? 'matches' : 'match'}.`;
    else if (state.todos.length === 0) html = 'Add something and it will appear here.';
    else if (n === 0) { lastClearLine = lastClearLine || CLEAR_LINES[Math.floor(Math.random() * CLEAR_LINES.length)]; html = lastClearLine; }
    else if (closed && now.getHours() >= 16) {
      const j = state.journal[todayKey()];
      html = `<span class="num">${j.done}</span> finished${j.lined ? `, <span class="num">${j.lined}</span> lined up for tomorrow` : ''}. See you in the morning.`;
    } else {
      lastClearLine = null;
      html = `<span class="num" data-k="a">${todayN}</span> today`;
      if (by.next.length) html += `, <span class="num">${by.next.length}</span> up next`;
      if (doneToday) html += `, <span class="num" data-k="d">${doneToday}</span> done`;
      if (overdue) html += `, <span class="num">${overdue}</span> overdue`;
      html += '.';
      const y = state.journal[todayKey(new Date(Date.now() - DAY))];
      if (y?.lined && now.getHours() < 12) html += ` You lined up <span class="num">${y.lined}</span> ${y.lined === 1 ? 'thing' : 'things'} last night.`;
    }
    if (el.summary.innerHTML !== html) el.summary.innerHTML = html;
    if (lastActive !== null && lastActive !== todayN) $('[data-k="a"]', el.summary)?.classList.add('bump');
    if (lastDone !== null && lastDone !== doneToday) $('[data-k="d"]', el.summary)?.classList.add('bump');
    lastActive = todayN; lastDone = doneToday;

    // sections
    const nothing = state.todos.length === 0;
    if (nothing && el.empty.hidden) el.emptyText.textContent = EMPTY_LINES[Math.floor(Math.random() * EMPTY_LINES.length)];
    el.empty.hidden = !nothing;
    el.todaySection.hidden = nothing || (!!filter && todayN === 0);
    if (todayN === 0 && el.emptyToday.hidden) { todayEmptyLine = TODAY_EMPTY[Math.floor(Math.random() * TODAY_EMPTY.length)]; }
    el.emptyTodayText.textContent = filter ? 'Nothing here matches.' : todayEmptyLine;
    el.emptyToday.hidden = todayN > 0 || drag != null;
    el.eveningHead.hidden = by.evening.length === 0 && !(drag && drag.overList === el.evening);
    el.startBtn.hidden = todayN === 0 && by.next.length === 0;
    el.nextSection.hidden = by.next.length === 0 && !drag;
    el.nextCount.textContent = by.next.length;
    el.somedaySection.hidden = by.someday.length === 0 && !drag;
    el.somedayCount.textContent = by.someday.length;
    el.somedayToggle.setAttribute('aria-expanded', String(state.somedayOpen));
    el.someday.classList.toggle('collapsed', !state.somedayOpen);
    el.someday.style.maxHeight = state.somedayOpen ? el.someday.scrollHeight + 'px' : '0px';

    // done section
    el.doneSection.hidden = by.done.length === 0;
    if (el.doneCount.textContent !== String(by.done.length)) {
      el.doneCount.textContent = by.done.length;
      el.doneCount.classList.remove('bump'); void el.doneCount.offsetWidth; el.doneCount.classList.add('bump');
    }
    el.doneToggle.setAttribute('aria-expanded', String(state.doneOpen));
    el.done.classList.toggle('collapsed', !state.doneOpen);
    el.done.style.maxHeight = state.doneOpen ? el.done.scrollHeight + 'px' : '0px';

    el.closeDayBtn.hidden = closed || now.getHours() < 16 || state.todos.length === 0;
    renderCapacity();
    renderWeek();
  }

  /* the daylight meter: what is planned against what is left of the day */
  function renderCapacity() {
    const now = new Date();
    const todays = state.todos.filter(t => !t.done && isToday(t));
    const planned = todays.reduce((s, t) => s + (t.est || 0), 0);
    const unsized = todays.filter(t => !t.est).length;
    const left = Math.max(0, DAY_END - (now.getHours() + now.getMinutes() / 60)) * 60;
    let text = '', ratio = 0, cls = '';
    if (!todays.length) text = '';
    else if (!planned) text = left > 0 ? `${spanLabel(left)} left in the day` : 'The day is winding down';
    else {
      ratio = left > 0 ? planned / left : 2;
      text = `${spanLabel(planned)} planned`;
      if (unsized) text += ` +${unsized} unsized`;
      text += left <= 0 ? '. The day is winding down' : ratio > 1 ? `. More than the ${spanLabel(left)} left` : `, ${spanLabel(left)} left`;
      cls = ratio > 1 ? 'over' : ratio > .8 ? 'tight' : '';
    }
    el.capText.textContent = text;
    el.capacity.className = `capacity ${cls}`;
    el.capacity.hidden = !text;
    el.capFill.style.transform = `scaleX(${clamp(ratio, 0, 1)})`;
  }

  /* keep DOM nodes alive across renders so their transitions survive */
  function reconcile(list, todos) {
    let cursor = list.firstElementChild;
    for (const todo of todos) {
      let li = nodes.get(todo.id);
      if (!li) { li = createNode(todo); nodes.set(todo.id, li); }
      updateNode(li, todo);
      if (li !== cursor) list.insertBefore(li, cursor);
      else cursor = cursor.nextElementSibling;
    }
    const ids = new Set(todos.map(t => t.id));
    $$('.todo', list).forEach(li => {
      if (!ids.has(li.dataset.id) && !li.classList.contains('leaving') && !li.classList.contains('sweeping')) li.remove();
    });
  }

  function createNode(todo) {
    const li = el.template.content.firstElementChild.cloneNode(true);
    li.dataset.id = todo.id;
    const burst = $('.burst', li);
    for (let i = 0; i < 8; i++) {
      const dot = document.createElement('i');
      dot.style.setProperty('--a', `${i * 45 + 22}deg`);
      burst.appendChild(dot);
    }
    $('.check', li).addEventListener('click', () => toggle(todo.id));
    $('.delete', li).addEventListener('click', () => remove(todo.id));
    $('.prio', li).addEventListener('click', () => cyclePrio(todo.id));
    $('.move', li).addEventListener('click', () => {
      const t = state.todos.find(x => x.id === todo.id); if (!t) return;
      const s = sectionOf(t);
      setWhen(todo.id, s === 'today' || s === 'evening' ? 'next' : s === 'next' ? 'today' : 'next');
    });
    $('.todo-text', li).addEventListener('dblclick', () => edit(todo.id));
    $('.todo-meta', li).addEventListener('click', e => {
      const tag = e.target.closest('.chip-tag');
      if (tag) { el.input.value = '?' + tag.textContent; el.composer.classList.add('has-text'); setFilter(tag.textContent); }
    });
    $('.ask', li).addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      askedStale.add(todo.id);
      const t = state.todos.find(x => x.id === todo.id);
      if (b.dataset.act === 'today') setWhen(todo.id, 'today');
      else if (b.dataset.act === 'someday') setWhen(todo.id, 'someday');
      else if (b.dataset.act === 'go') remove(todo.id);
      else { touch(t); save(); }
      staleId = chooseStale(); render();
    });
    $('.grip', li).addEventListener('pointerdown', e => dragStart(e, li));
    li.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch' && !e.target.closest('button, [contenteditable="true"]')) touchHoldStart(e, li);
    });
    return li;
  }

  function tallyHTML(n) {
    const shown = Math.min(n, 15);
    let paths = '';
    for (let i = 0; i < shown; i++) {
      const g = Math.floor(i / 5), k = i % 5, x = g * 26 + 3;
      paths += k < 4
        ? `<path d="M${x + k * 5 + (i % 2) * .6} 2.5 L${x + k * 5 - (i % 3) * .4} 13.5"/>`
        : `<path d="M${x - 1} 12 L${x + 17} 3.5"/>`;
    }
    const width = (Math.ceil(shown / 5) - 1) * 26 + (shown % 5 === 0 ? 22 : (shown % 5) * 5 + 2) + 3;
    return `<span class="chip chip-carry" title="Carried over ${n} ${n === 1 ? 'day' : 'days'}"><svg viewBox="0 0 ${width} 16" width="${width}" height="16">${paths}</svg>${n > 15 ? `<b>+${n - 15}</b>` : ''}</span>`;
  }

  function updateNode(li, todo) {
    const section = sectionOf(todo);
    li.classList.toggle('is-done', todo.done);
    li.dataset.section = section;
    $('.check', li).setAttribute('aria-label', todo.done ? 'Mark incomplete' : 'Mark complete');
    const text = $('.todo-text', li);
    if (text.getAttribute('contenteditable') !== 'true' && text.textContent !== todo.text) text.textContent = todo.text;
    const noteEl = $('.todo-note', li);
    noteEl.hidden = !todo.note;
    if (todo.note && noteEl.textContent !== todo.note) noteEl.textContent = todo.note;

    const meta = $('.todo-meta', li);
    const d = todo.done ? null : dueLabel(todo.due, todo.when);
    let html = '';
    const dueIsRepeatDay = todo.repeat?.weekday != null && d && d.label === WEEKDAYS[todo.repeat.weekday];
    if (d && !(section === 'today' && d.label === 'today') && section !== 'evening' && !dueIsRepeatDay) html += `<span class="chip chip-due ${d.cls}">${d.label}</span>`;
    if (todo.repeat) html += `<span class="chip chip-repeat" title="Repeats"><svg viewBox="0 0 24 24"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>${repeatLabel(todo.repeat)}</span>`;
    if (todo.est) html += `<span class="chip chip-est">${estLabel(todo.est)}</span>`;
    for (const t of todo.tags || []) html += `<span class="chip chip-tag" role="button" tabindex="-1">#${escape(t)}</span>`;
    if (!todo.done && todo.carried > 0) html += tallyHTML(todo.carried);
    if (meta.innerHTML !== html) meta.innerHTML = html;
    $('.prio', li).dataset.level = todo.prio || 0;

    // ink ages on things left alone
    const age = todo.done ? 0 : ageDays(todo);
    li.style.setProperty('--age', clamp((age - 2) / 12, 0, 1).toFixed(3));
    li.classList.toggle('dusty', age >= 7);
    text.title = age >= 7 ? `Untouched for ${Math.floor(age)} days` : '';

    const move = $('.move', li);
    const up = section === 'next' || section === 'someday';
    move.classList.toggle('down', !up);
    move.setAttribute('aria-label', up ? (section === 'someday' ? 'Move to up next' : 'Move to today') : 'Move to up next');
    move.title = move.getAttribute('aria-label');

    const ask = $('.ask', li);
    const asking = todo.id === staleId && !todo.done;
    ask.hidden = !asking;
    if (asking && !ask.innerHTML) ask.innerHTML = `<span>Still want this? It has sat here ${Math.floor(age)} days.</span><button type="button" data-act="today">Today</button><button type="button" data-act="someday">Someday</button><button type="button" data-act="keep">Keep</button><button type="button" data-act="go">Let it go</button>`;
    if (!asking) ask.innerHTML = '';
  }

  function renderWeek() {
    const frag = document.createDocumentFragment();
    const today = todayKey();
    for (let i = 6; i >= 0; i--) {
      const key = todayKey(new Date(Date.now() - i * DAY));
      const n = state.history[key] || 0;
      const bar = document.createElement('i');
      bar.style.setProperty('--n', Math.min(n, 5));
      if (key === today) bar.classList.add('today');
      if (state.journal[key]?.closed) bar.classList.add('closed');
      frag.appendChild(bar);
    }
    el.week.replaceChildren(frag);
  }

  /* ── actions ────────────────────────────────── */
  function add(raw) {
    const parsed = parse(raw);
    if (!parsed.text) return;
    const todo = migrate({ id: uid(), ...parsed, when: parsed.when || 'next', done: false, created: Date.now() });
    // a task written for today goes to the top of today; everything else to the top of its section
    state.todos.unshift(todo);
    save();
    render();
    const li = nodes.get(todo.id);
    li.classList.add('entering');
    li.addEventListener('animationend', () => li.classList.remove('entering'), { once: true });
    sound.add();
  }

  function toggle(id) {
    const todo = state.todos.find(t => t.id === id);
    if (!todo) return;
    const li = nodes.get(id);
    const key = todayKey();
    if (!todo.done) {
      todo.done = true; todo.completed = Date.now(); stamp(todo);
      state.history[key] = (state.history[key] || 0) + 1;
      const burst = $('.burst', li);
      burst.classList.remove('go'); void burst.offsetWidth; burst.classList.add('go');
      sound.complete();
      li.classList.add('is-done');
      let next = null;
      if (todo.repeat) {
        next = migrate({ ...todo, id: uid(), done: false, completed: null, created: Date.now(), touched: Date.now(), updated: Date.now(), carried: 0, when: 'next', due: nextDue(todo.repeat, todo.due) });
        state.todos.splice(state.todos.indexOf(todo) + 1, 0, next);
      }
      save();
      // let the stroke draw before the item travels down
      setTimeout(() => {
        render();
        if (next) { const nl = nodes.get(next.id); nl?.classList.add('entering'); nl?.addEventListener('animationend', () => nl.classList.remove('entering'), { once: true }); }
        if (state.todos.every(t => t.done) && state.todos.length >= 2) celebrate();
      }, reduceMotion ? 0 : 520);
    } else {
      todo.done = false; todo.completed = null; touch(todo);
      state.history[key] = Math.max(0, (state.history[key] || 0) - 1);
      sound.tick();
      save(); render();
    }
  }

  function remove(id) {
    const idx = state.todos.findIndex(t => t.id === id);
    if (idx < 0) return;
    const [todo] = state.todos.splice(idx, 1);
    forget(id);
    const li = nodes.get(id);
    nodes.delete(id);
    if (focusing?.id === id) stopFocus(false);
    save();
    sound.remove();
    if (li) {
      li.style.height = li.offsetHeight + 'px';
      li.classList.add('leaving');
      li.addEventListener('animationend', () => { li.remove(); render(); }, { once: true });
    }
    render();
    toast(`Deleted <em>${escape(todo.text)}</em>`, () => {
      state.todos.splice(Math.min(idx, state.todos.length), 0, todo);
      unforget(todo.id); stamp(todo);
      save(); render();
      const back = nodes.get(todo.id);
      if (back) { back.classList.add('entering'); back.addEventListener('animationend', () => back.classList.remove('entering'), { once: true }); }
      sound.add();
    });
  }

  function cyclePrio(id) {
    const todo = state.todos.find(t => t.id === id);
    if (!todo || todo.done) return;
    todo.prio = ((todo.prio || 0) + 1) % 4;
    touch(todo);
    save(); render(); sound.tick();
  }

  /* send a task to today / this evening / up next / someday */
  function setWhen(id, when) {
    const todo = state.todos.find(t => t.id === id);
    if (!todo || todo.done) return;
    const today = startOfDay();
    let msg = null;
    if (when === 'next' && todo.due != null && todo.due <= today) { todo.due = today + DAY; msg = `<em>${escape(todo.text)}</em> moved to tomorrow`; }
    if (when === 'someday' && todo.due != null) todo.due = null;
    if (when === 'evening' && (todo.due == null || todo.due > today)) todo.due = today;
    todo.when = when;
    touch(todo);
    save(); render(); sound.tick();
    if (msg) toast(msg, null, 2600);
    nodes.get(id)?.focus();
  }

  function edit(id) {
    const todo = state.todos.find(t => t.id === id);
    const li = nodes.get(id);
    if (!todo || !li || todo.done) return;
    const text = $('.todo-text', li);
    if (text.getAttribute('contenteditable') === 'true') return;
    const original = todo.text;
    text.textContent = todo.note ? `${todo.text} // ${todo.note}` : todo.text;
    text.setAttribute('contenteditable', 'true');
    text.focus();
    const range = document.createRange(); range.selectNodeContents(text);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);

    const finish = (commit) => {
      text.removeAttribute('contenteditable');
      text.removeEventListener('keydown', onKey);
      text.removeEventListener('blur', onBlur);
      if (commit) {
        const parsed = parse(text.textContent);
        if (parsed.text) {
          todo.text = parsed.text;
          todo.note = parsed.note;
          if (parsed.due != null) todo.due = parsed.due;
          if (parsed.prio) todo.prio = parsed.prio;
          if (parsed.est) todo.est = parsed.est;
          if (parsed.repeat) todo.repeat = parsed.repeat;
          if (parsed.when) todo.when = parsed.when;
          if (parsed.tags.length) todo.tags = [...new Set([...(todo.tags || []), ...parsed.tags])];
          touch(todo);
        } else text.textContent = original;
      } else text.textContent = original;
      save(); render();
      li.focus();
    };
    const onKey = e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      e.stopPropagation();
    };
    const onBlur = () => finish(true);
    text.addEventListener('keydown', onKey);
    text.addEventListener('blur', onBlur);
  }

  function move(id, dir) {
    const todo = state.todos.find(t => t.id === id);
    if (!todo) return;
    const peers = state.todos.filter(t => !t.done && sectionOf(t) === sectionOf(todo));
    const i = peers.indexOf(todo), j = i + dir;
    if (i < 0 || j < 0 || j >= peers.length) return;
    const a = state.todos.indexOf(peers[i]), b = state.todos.indexOf(peers[j]);
    [state.todos[a], state.todos[b]] = [state.todos[b], state.todos[a]];
    save(); render(); sound.tick();
    nodes.get(id)?.focus();
  }

  function clearDone() {
    const done = state.todos.filter(t => t.done);
    if (!done.length) return;
    const lis = done.map(t => nodes.get(t.id)).filter(Boolean);
    lis.forEach((li, i) => { li.style.animationDelay = `${i * 40}ms`; li.classList.add('sweeping'); });
    sound.remove();
    setTimeout(() => {
      state.todos = state.todos.filter(t => !t.done);
      done.forEach(t => { nodes.delete(t.id); forget(t.id); });
      lis.forEach(li => li.remove());
      save(); render();
    }, reduceMotion ? 0 : 450 + lis.length * 40);
  }

  /* ── toast ──────────────────────────────────── */
  let toastTimer = null, toastAction = null;
  function toast(html, onUndo, ms = 5000) {
    clearTimeout(toastTimer);
    toastAction = onUndo;
    el.toastText.innerHTML = html;
    el.toastUndo.hidden = !onUndo;
    el.toast.style.setProperty('--toast-ms', ms + 'ms');
    el.toast.classList.remove('out');
    el.toast.hidden = false;
    const bar = $('.toast-bar', el.toast); bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = '';
    toastTimer = setTimeout(hideToast, ms);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    if (el.toast.hidden) return;
    el.toast.classList.add('out');
    el.toast.addEventListener('animationend', () => { el.toast.hidden = true; el.toast.classList.remove('out'); }, { once: true });
    toastAction = null;
  }
  el.toastUndo.addEventListener('click', () => { const fn = toastAction; hideToast(); fn && fn(); });

  /* ── composer ───────────────────────────────── */
  el.composer.addEventListener('submit', e => {
    e.preventDefault();
    if (el.input.value.trim().startsWith('?')) { setFilter(el.input.value.trim().slice(1)); return; }
    add(el.input.value);
    el.input.value = '';
    el.composer.classList.remove('has-text', 'has-hints');
    el.hints.innerHTML = '';
  });
  el.input.addEventListener('input', () => {
    const v = el.input.value;
    el.composer.classList.toggle('has-text', v.trim().length > 0);
    if (v.trim().startsWith('?') || filter) {
      setFilter(v.trim().startsWith('?') ? v.trim().slice(1) : '');
      el.hints.innerHTML = ''; el.composer.classList.remove('has-hints');
      return;
    }
    const p = parse(v);
    const chips = [];
    const d = dueLabel(p.due, p.when);
    if (p.when === 'someday') chips.push('<span class="hint">someday</span>');
    else if (d) chips.push(`<span class="hint hint-due">${p.when === 'evening' ? d.label : 'due ' + d.label}</span>`);
    if (p.repeat) chips.push(`<span class="hint hint-due">${repeatLabel(p.repeat)}</span>`);
    if (p.est) chips.push(`<span class="hint">${estLabel(p.est)}</span>`);
    if (p.prio) chips.push(`<span class="hint hint-prio">${['', 'low', 'high', 'urgent'][p.prio]} priority</span>`);
    p.tags.forEach(t => chips.push(`<span class="hint">#${escape(t)}</span>`));
    if (p.note) chips.push('<span class="hint">with a note</span>');
    const html = chips.join('');
    if (el.hints.innerHTML !== html) el.hints.innerHTML = html;
    el.composer.classList.toggle('has-hints', chips.length > 0);
  });

  // rotating placeholders, so the composer teaches by example
  const PLACEHOLDERS = [
    'What needs doing?',
    'Water the ferns tomorrow',
    'Call Ada on friday !!',
    'Finish the draft #work ~2h',
    'Take out the bins every monday',
    'Read in bed tonight',
    'Learn the cello, someday',
    'Buy stamps in 3 days // the nice ones',
    'Fix the squeaky door ! ~20m',
    '?ferns finds instead of adds',
  ];
  let phIndex = 0;
  setInterval(() => {
    if (document.activeElement === el.input || el.input.value) return;
    phIndex = (phIndex + 1) % PLACEHOLDERS.length;
    el.input.classList.add('placeholder-swap');
    setTimeout(() => { el.input.placeholder = PLACEHOLDERS[phIndex]; el.input.classList.remove('placeholder-swap'); }, 320);
  }, 4200);

  /* ── sections ───────────────────────────────── */
  el.doneToggle.addEventListener('click', () => { state.doneOpen = !state.doneOpen; save(); render(); sound.tick(); });
  el.somedayToggle.addEventListener('click', () => { state.somedayOpen = !state.somedayOpen; save(); render(); sound.tick(); });
  el.clearDone.addEventListener('click', clearDone);
  el.startBtn.addEventListener('click', () => startFocus(pick()));

  /* ── help & data ────────────────────────────── */
  el.helpBtn.addEventListener('click', () => { el.help.showModal(); sound.tick(); });
  el.helpClose.addEventListener('click', () => el.help.close());
  [el.help, el.closeDay, el.ledger].forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

  el.exportBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `inkling-${todayKey()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    sound.tick();
  });
  el.importBtn.addEventListener('click', () => el.importFile.click());
  el.importFile.addEventListener('change', async () => {
    const file = el.importFile.files[0]; if (!file) return;
    const raw = JSON.parse(await file.text());
    if (!raw || !Array.isArray(raw.todos)) { toast('That file is not an Inkling export'); return; }
    const before = JSON.stringify(state);
    const known = new Set(state.todos.map(t => t.id));
    let added = 0;
    for (const t of raw.todos.map(migrate)) if (!known.has(t.id)) { stamp(t); state.todos.push(t); added++; }
    for (const k of ['history', 'focus', 'journal']) Object.assign(state[k], raw[k] || {});
    save(); render(); el.help.close(); el.importFile.value = '';
    toast(`Imported <em>${added}</em> ${added === 1 ? 'task' : 'tasks'}`, () => { Object.assign(state, JSON.parse(before)); save(); render(); });
  });
  el.copyBtn.addEventListener('click', async () => {
    const line = t => {
      const bits = [t.done ? 'x' : '-', `[${t.done ? 'x' : ' '}]`, t.prio ? `(${'CBA'[t.prio - 1]})` : '', t.text];
      if (t.due != null) bits.push(`due:${todayKey(new Date(t.due))}`);
      if (t.est) bits.push(`~${estLabel(t.est)}`);
      if (t.repeat) bits.push(`rec:${repeatLabel(t.repeat)}`);
      (t.tags || []).forEach(x => bits.push('#' + x));
      if (t.note) bits.push('// ' + t.note);
      return bits.filter(Boolean).join(' ');
    };
    const groups = [['Today', isToday], ['Up next', t => sectionOf(t) === 'next'], ['Someday', t => sectionOf(t) === 'someday'], ['Done', t => t.done]];
    const text = groups.map(([name, f]) => { const rows = state.todos.filter(f); return rows.length ? `${name}\n${rows.map(line).join('\n')}` : ''; }).filter(Boolean).join('\n\n');
    await navigator.clipboard.writeText(text);
    toast('Copied your list as plain text'); sound.tick();
  });

  /* ── the ledger ─────────────────────────────── */
  function openLedger() {
    const rows = [];
    let streak = 0, counting = true;
    for (let i = 0; i < 28; i++) {
      const d = new Date(Date.now() - i * DAY), key = todayKey(d);
      const n = state.history[key] || 0, f = state.focus[key] || 0, j = state.journal[key];
      if (counting) { if (n > 0) streak++; else if (i > 0) counting = false; }
      if (i < 14 || n || j) rows.push({ key, d, n, f, j });
    }
    const total = Object.values(state.history).reduce((a, b) => a + b, 0);
    const bars = n => `<span class="ledger-bars">${'<i></i>'.repeat(Math.min(n, 12))}${n > 12 ? `<b>+${n - 12}</b>` : ''}</span>`;
    el.ledgerInner.innerHTML = `
      <h2 class="sheet-title">The ledger</h2>
      <p class="sheet-lede">${total ? `<span class="num">${total}</span> ${total === 1 ? 'thing' : 'things'} finished since you started.` : 'Nothing finished yet. The first tick starts the ledger.'}${streak > 1 ? ` <span class="num">${streak}</span> days in a row.` : ''}</p>
      <ol class="ledger-list">${rows.map(r => `
        <li class="ledger-row ${r.n ? '' : 'quiet'}">
          <span class="ledger-day">${r.key === todayKey() ? 'Today' : r.d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}</span>
          <span class="ledger-marks">${r.n ? bars(r.n) : '<i class="ledger-dash"></i>'}${r.f ? `<span class="ledger-focus">${spanLabel(r.f)} of focus</span>` : ''}</span>
          ${r.j?.note ? `<span class="ledger-note">${escape(r.j.note)}</span>` : ''}
        </li>`).join('')}</ol>
      <button class="text-btn help-close" type="button" data-close>Close</button>`;
    $('[data-close]', el.ledgerInner).addEventListener('click', () => el.ledger.close());
    el.ledger.showModal(); sound.tick();
  }
  el.week.addEventListener('click', openLedger);

  /* ── close the day ──────────────────────────── */
  function openCloseDay() {
    const key = todayKey();
    const finished = state.todos.filter(t => t.done && t.completed && todayKey(new Date(t.completed)) === key);
    const doneCount = state.history[key] || 0;
    const left = state.todos.filter(t => !t.done && isToday(t));
    const candidates = state.todos.filter(t => !t.done && sectionOf(t) === 'next' && !(t.due != null && t.due === startOfDay() + DAY)).sort((a, b) => urgency(b) - urgency(a)).slice(0, 8);
    const decision = new Map(left.map(t => [t.id, 'tomorrow']));
    const lined = new Set();
    let step = 0;
    const steps = [];
    steps.push(() => `
      <p class="sheet-eyebrow">Closing the day · one of three</p>
      <h2 class="sheet-title">${doneCount ? `You finished ${doneCount === 1 ? 'one thing' : `${doneCount} things`}.` : 'A quiet day.'}</h2>
      ${finished.length ? `<ul class="ritual-list done">${finished.map(t => `<li>${escape(t.text)}</li>`).join('')}</ul>` : doneCount ? '' : '<p class="sheet-lede">Some days are like that. Tomorrow is a fresh page.</p>'}
      ${left.length ? `<p class="sheet-lede">${left.length === 1 ? 'One thing is' : `${left.length} things are`} still on today. Carry, park, or let go.</p>
      <ul class="ritual-list choose">${left.map(t => `<li data-id="${t.id}"><span class="ritual-text">${escape(t.text)}</span><span class="seg">${['tomorrow', 'someday', 'go'].map(k => `<button type="button" data-d="${k}" class="${decision.get(t.id) === k ? 'on' : ''}">${{ tomorrow: 'Tomorrow', someday: 'Someday', go: 'Let it go' }[k]}</button>`).join('')}</span></li>`).join('')}</ul>` : ''}`);
    steps.push(() => `
      <p class="sheet-eyebrow">Closing the day · two of three</p>
      <h2 class="sheet-title">Line up tomorrow.</h2>
      <p class="sheet-lede">Pick up to three things to find waiting in the morning. The hard choice is easier tonight than tomorrow.</p>
      ${candidates.length ? `<ul class="ritual-list pickable">${candidates.map(t => `<li data-id="${t.id}" class="${lined.has(t.id) ? 'on' : ''}"><i class="ring"></i><span class="ritual-text">${escape(t.text)}</span>${t.est ? `<span class="chip chip-est">${estLabel(t.est)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="sheet-lede">Nothing waiting up next. Tomorrow is yours to write.</p>'}`);
    steps.push(() => `
      <p class="sheet-eyebrow">Closing the day · three of three</p>
      <h2 class="sheet-title">One line about today.</h2>
      <textarea class="ritual-note" id="ritualNote" rows="2" maxlength="200" placeholder="Anything. Or nothing."></textarea>`);
    const draw = () => {
      el.closeDayInner.innerHTML = steps[step]() + `
        <div class="sheet-actions">
          ${step > 0 ? '<button class="text-btn" type="button" data-back>Back</button>' : '<button class="text-btn" type="button" data-cancel>Not yet</button>'}
          <button class="pill pill-ink" type="button" data-next>${step < 2 ? 'Next' : 'Close the day'}</button>
        </div>`;
      $('[data-next]', el.closeDayInner).addEventListener('click', () => { if (step < 2) { step++; draw(); sound.tick(); } else finish(); });
      $('[data-back]', el.closeDayInner)?.addEventListener('click', () => { step--; draw(); sound.tick(); });
      $('[data-cancel]', el.closeDayInner)?.addEventListener('click', () => el.closeDay.close());
      $('.ritual-list.choose', el.closeDayInner)?.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        const li = b.closest('li'); decision.set(li.dataset.id, b.dataset.d);
        $$('button', li).forEach(x => x.classList.toggle('on', x === b)); sound.tick();
      });
      $('.ritual-list.pickable', el.closeDayInner)?.addEventListener('click', e => {
        const li = e.target.closest('li'); if (!li) return;
        const id = li.dataset.id;
        if (lined.has(id)) lined.delete(id); else if (lined.size < 3) lined.add(id); else return;
        li.classList.toggle('on', lined.has(id)); sound.tick();
      });
      $('#ritualNote', el.closeDayInner)?.focus();
    };
    const finish = () => {
      const note = ($('#ritualNote', el.closeDayInner)?.value || '').trim();
      const tomorrow = startOfDay() + DAY;
      const gone = [];
      for (const [id, d] of decision) {
        const t = state.todos.find(x => x.id === id); if (!t) continue;
        if (d === 'someday') { t.when = 'someday'; t.due = null; touch(t); }
        else if (d === 'go') gone.push(t);
        // 'tomorrow' is what the night does on its own: the task carries over
      }
      for (const t of gone) { state.todos.splice(state.todos.indexOf(t), 1); forget(t.id); }
      for (const id of lined) { const t = state.todos.find(x => x.id === id); if (t) { t.due = tomorrow; t.when = 'next'; touch(t); } }
      state.journal[key] = { closed: Date.now(), note, done: doneCount, lined: lined.size };
      save();
      el.closeDay.close();
      sound.close();
      gone.forEach(t => nodes.get(t.id)?.remove());
      gone.forEach(t => nodes.delete(t.id));
      render();
      if (gone.length) toast(`Let go of ${gone.length === 1 ? `<em>${escape(gone[0].text)}</em>` : `${gone.length} things`}`, () => { gone.forEach(t => { unforget(t.id); stamp(t); }); state.todos.push(...gone); save(); render(); });
    };
    draw();
    el.closeDay.showModal();
  }
  el.closeDayBtn.addEventListener('click', openCloseDay);

  /* ── focus: one task and an hourglass of ink ── */
  let focusing = null; // { id, start, end, total, raf, over }
  function startFocus(todo) {
    if (!todo) { toast('Nothing to start on. Write something down.'); return; }
    const minutes = todo.est || 25;
    if (focusing) cancelAnimationFrame(focusing.raf);
    focusing = { id: todo.id, start: Date.now(), end: Date.now() + minutes * 60000, total: minutes * 60000, raf: 0, over: false };
    el.focusText.textContent = todo.text;
    el.focusNote.textContent = todo.note || '';
    el.focusNote.hidden = !todo.note;
    el.focusHint.textContent = todo.est ? `You said about ${spanLabel(todo.est)}.` : 'Twenty-five minutes, then a breath.';
    el.focus.hidden = false;
    el.html.dataset.focus = 'on';
    el.focus.classList.remove('is-over');
    document.title = `Inkling · ${todo.text}`;
    sound.focus();
    el.focusDone.focus();
    stepFocus();
  }
  function stepFocus() {
    if (!focusing) return;
    const now = Date.now();
    const remaining = Math.max(0, focusing.end - now);
    const p = clamp((now - focusing.start) / (focusing.end - focusing.start), 0, 1);
    // ink drains from the top bulb into the bottom one
    el.hgTop.setAttribute('y', 12 + 86 * p); el.hgTop.setAttribute('height', 86 * (1 - p));
    el.hgBottom.setAttribute('y', 188 - 84 * p); el.hgBottom.setAttribute('height', 84 * p);
    el.hgStream.style.opacity = remaining > 0 ? 1 : 0;
    const m = Math.floor(remaining / 60000), s = Math.floor(remaining / 1000) % 60;
    el.focusTime.textContent = `${m}:${String(s).padStart(2, '0')}`;
    if (remaining <= 0) {
      if (!focusing.over) { focusing.over = true; el.focus.classList.add('is-over'); el.focusHint.textContent = 'Time. Breathe, then decide.'; sound.timeUp(); }
      return;
    }
    focusing.raf = requestAnimationFrame(stepFocus);
  }
  function logFocus() {
    if (!focusing) return;
    const ms = Math.min(Date.now(), focusing.end) - focusing.start;
    const min = Math.round(ms / 60000);
    if (min >= 1) { const k = todayKey(); state.focus[k] = (state.focus[k] || 0) + min; save(); }
  }
  function stopFocus(log = true) {
    if (!focusing) return;
    if (log) logFocus();
    cancelAnimationFrame(focusing.raf);
    focusing = null;
    el.focus.hidden = true;
    delete el.html.dataset.focus;
    lastHeadline = null; render();
  }
  el.focusStop.addEventListener('click', () => { stopFocus(); sound.tick(); });
  el.focusDone.addEventListener('click', () => {
    const id = focusing?.id; stopFocus();
    if (id) { toggle(id); nodes.get(id)?.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' }); }
  });
  el.focusMore.addEventListener('click', () => {
    if (!focusing) return;
    const now = Date.now();
    focusing.end = Math.max(focusing.end, now) + 5 * 60000;
    focusing.total = focusing.end - focusing.start;
    focusing.over = false; el.focus.classList.remove('is-over');
    el.focusHint.textContent = 'Five more.';
    sound.tick(); stepFocus();
  });
  el.focusNext.addEventListener('click', () => {
    const cur = focusing?.id; logFocus();
    const next = pick(cur);
    if (!next) { stopFocus(false); toast('That was the only thing.'); return; }
    startFocus(next);
  });

  /* ── keyboard ───────────────────────────────── */
  document.addEventListener('keydown', e => {
    const inInput = e.target === el.input || e.target.isContentEditable || e.target.tagName === 'TEXTAREA';
    const anyDialog = el.help.open || el.closeDay.open || el.ledger.open;
    if (e.key === 'Escape') {
      if (anyDialog) return; // dialog handles it
      if (focusing) { stopFocus(); return; }
      if (!el.toast.hidden) { hideToast(); return; }
      if (filter) { el.input.value = ''; el.composer.classList.remove('has-text'); setFilter(''); return; }
      if (inInput) { el.input.blur(); return; }
    }
    if (inInput || anyDialog) return;
    if (focusing) {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); el.focusDone.click(); }
      return;
    }
    if (e.key === '?') { e.preventDefault(); el.help.open ? el.help.close() : el.help.showModal(); return; }
    if (e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); el.input.focus(); return; }
    if (e.key === 'z' && (e.metaKey || e.ctrlKey) && toastAction) { e.preventDefault(); const fn = toastAction; hideToast(); fn(); return; }
    if (e.metaKey || e.ctrlKey) return;
    if (e.key === 'j') { e.preventDefault(); el.ledger.open ? el.ledger.close() : openLedger(); return; }
    if (e.key === 'c' && !el.closeDayBtn.hidden) { e.preventDefault(); openCloseDay(); return; }

    const items = [...$$('.todo', el.today), ...$$('.todo', el.evening), ...$$('.todo', el.next), ...(state.somedayOpen ? $$('.todo', el.someday) : []), ...(state.doneOpen ? $$('.todo', el.done) : [])];
    const focused = e.target.closest?.('.todo');
    const idx = items.indexOf(focused);
    if (e.key === 'n') { e.preventDefault(); startFocus(focused ? state.todos.find(t => t.id === focused.dataset.id && !t.done) || pick() : pick()); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (focused && e.altKey) { move(focused.dataset.id, e.key === 'ArrowDown' ? 1 : -1); return; }
      const next = idx < 0 ? (e.key === 'ArrowDown' ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)));
      items[next]?.focus();
      return;
    }
    if (!focused) return;
    const id = focused.dataset.id;
    if (e.key === ' ' || e.key === 'x') { e.preventDefault(); toggle(id); }
    else if (e.key === 'e' || e.key === 'Enter') { e.preventDefault(); edit(id); }
    else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); items[idx + 1]?.focus() || items[idx - 1]?.focus(); remove(id); }
    else if (e.key === 'p') { e.preventDefault(); cyclePrio(id); }
    else if (e.key === 't') { e.preventDefault(); setWhen(id, 'today'); }
    else if (e.key === 'v') { e.preventDefault(); setWhen(id, 'evening'); }
    else if (e.key === 'l') { e.preventDefault(); setWhen(id, 'next'); }
    else if (e.key === 's') { e.preventDefault(); setWhen(id, 'someday'); }
  });

  /* ── drag to reorder, and between sections ──── */
  let drag = null;
  function dragStart(e, li) {
    if (li.classList.contains('is-done')) return;
    e.preventDefault();
    const rect = li.getBoundingClientRect();
    drag = { li, pointerId: e.pointerId, startY: e.clientY, lastY: e.clientY, startTop: rect.top, translate: 0, overList: li.parentElement };
    li.classList.add('dragging');
    el.html.classList.add('is-dragging');
    if (!state.somedayOpen) { state.somedayOpen = true; }
    render();
    li.setPointerCapture?.(e.pointerId);
    document.addEventListener('pointermove', dragMove);
    document.addEventListener('pointerup', dragEnd);
    document.addEventListener('pointercancel', dragEnd);
    sound.tick();
  }
  function baseTop(li) {
    const t = li.style.transform; li.style.transform = 'none';
    const top = li.getBoundingClientRect().top; li.style.transform = t;
    return top;
  }
  function positionDragged() {
    const { li } = drag;
    const desired = drag.startTop + (drag.lastY - drag.startY);
    drag.translate = desired - baseTop(li);
    const tilt = Math.max(-1.5, Math.min(1.5, (drag.lastY - drag.startY) / 60));
    li.style.transform = `translateY(${drag.translate}px) rotate(${tilt}deg) scale(1.02)`;
  }
  function dragMove(e) {
    if (!drag) return;
    const { li } = drag;
    drag.lastY = e.clientY;
    positionDragged();
    const y = e.clientY;
    const all = Object.values(lists);
    const siblings = all.flatMap(l => $$('.todo', l)).filter(s => s !== li);
    // which list is the pointer over? (lists grow a little while dragging so empty ones can take a drop)
    let target = null;
    for (const l of all) {
      const r = l.getBoundingClientRect();
      const head = l.previousElementSibling?.getBoundingClientRect();
      const top = head ? Math.min(head.top, r.top) : r.top;
      if (y >= top && y <= r.bottom) { target = l; break; }
    }
    if (target && target !== li.parentElement && $$('.todo', target).filter(s => s !== li).length === 0) {
      flipMove(() => target.appendChild(li), siblings);
      drag.overList = target; markOver(); return;
    }
    for (const s of siblings) {
      const r = s.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      const sIsBefore = !!(s.compareDocumentPosition(li) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (sIsBefore && y < mid) { flipMove(() => s.parentElement.insertBefore(li, s), siblings); break; }
      if (!sIsBefore && y > mid) { flipMove(() => s.parentElement.insertBefore(li, s.nextSibling), siblings); break; }
    }
    drag.overList = li.parentElement; markOver();
  }
  function markOver() {
    Object.values(lists).forEach(l => l.classList.toggle('drop-here', l === drag.overList));
    el.eveningHead.hidden = $$('.todo', el.evening).length === 0 && drag.overList !== el.evening;
  }
  function flipMove(fn, siblings) {
    const first = siblings.map(s => s.getBoundingClientRect().top);
    fn();
    siblings.forEach((s, i) => {
      const dy = first[i] - s.getBoundingClientRect().top;
      if (Math.abs(dy) > .5) s.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.16,1,.3,1)' });
    });
    positionDragged(); // the dragged item's base moved; keep it under the pointer
  }
  function dragEnd() {
    if (!drag) return;
    const { li } = drag;
    document.removeEventListener('pointermove', dragMove);
    document.removeEventListener('pointerup', dragEnd);
    document.removeEventListener('pointercancel', dragEnd);
    // commit order and section from the DOM
    const today = startOfDay();
    const ordered = [];
    for (const [when, list] of Object.entries(lists)) {
      for (const s of $$('.todo', list)) {
        const t = state.todos.find(x => x.id === s.dataset.id);
        if (!t) continue;
        if (sectionOf(t) !== when) {
          if (when === 'next' && t.due != null && t.due <= today) t.due = today + DAY;
          if (when === 'someday') t.due = null;
          if (when === 'evening' && (t.due == null || t.due > today)) t.due = today;
          t.when = when; touch(t);
        }
        ordered.push(t);
      }
    }
    const rest = state.todos.filter(t => !ordered.includes(t));
    state.todos = [...ordered, ...rest];
    save();
    li.style.transform = '';
    li.classList.remove('dragging');
    el.html.classList.remove('is-dragging');
    Object.values(lists).forEach(l => l.classList.remove('drop-here'));
    drag = null;
    render();
  }
  // touch: press and hold to pick an item up
  function touchHoldStart(e, li) {
    const t = setTimeout(() => { dragStart(e, li); navigator.vibrate?.(10); }, 260);
    const cancel = () => { clearTimeout(t); li.removeEventListener('pointermove', cancel); li.removeEventListener('pointerup', cancel); };
    li.addEventListener('pointermove', cancel, { once: true });
    li.addEventListener('pointerup', cancel, { once: true });
  }

  /* ── confetti ───────────────────────────────── */
  function celebrate() {
    sound.fanfare();
    if (reduceMotion) return;
    const c = el.confetti, ctx = c.getContext('2d');
    const dpr = Math.min(devicePixelRatio || 1, 2);
    c.width = innerWidth * dpr; c.height = innerHeight * dpr; ctx.scale(dpr, dpr);
    const css = getComputedStyle(el.html);
    const colors = [css.getPropertyValue('--accent'), css.getPropertyValue('--amber'), css.getPropertyValue('--moss'), css.getPropertyValue('--ink'), css.getPropertyValue('--sky-a')].map(s => s.trim());
    const pieces = Array.from({ length: 140 }, () => ({
      x: innerWidth / 2 + (Math.random() - .5) * 200, y: innerHeight * .35,
      vx: (Math.random() - .5) * 14, vy: -Math.random() * 14 - 6,
      w: 6 + Math.random() * 6, h: 8 + Math.random() * 10,
      r: Math.random() * Math.PI, vr: (Math.random() - .5) * .3,
      color: colors[Math.floor(Math.random() * colors.length)], life: 1,
    }));
    let frame = 0;
    const step = () => {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      let alive = false;
      for (const p of pieces) {
        p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        if (frame > 60) p.life -= .02;
        if (p.life <= 0 || p.y > innerHeight + 20) continue;
        alive = true;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)) + 1);
        ctx.restore();
      }
      frame++;
      if (alive) requestAnimationFrame(step); else ctx.clearRect(0, 0, innerWidth, innerHeight);
    };
    requestAnimationFrame(step);
  }

  /* ── go ─────────────────────────────────────── */
  tickClock();
  setInterval(tickClock, 30000);
  render();
  // stagger the first paint
  if (!reduceMotion) {
    $$('.todo').forEach((li, i) => {
      li.style.animationDelay = `${300 + i * 70}ms`;
      li.classList.add('entering');
      li.addEventListener('animationend', () => { li.classList.remove('entering'); li.style.animationDelay = ''; }, { once: true });
    });
  }
  addEventListener('resize', () => {
    if (state.doneOpen) el.done.style.maxHeight = el.done.scrollHeight + 'px';
    if (state.somedayOpen) el.someday.style.maxHeight = el.someday.scrollHeight + 'px';
  });
  sync.init();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
