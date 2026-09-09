/* Inkling — app.js
   No framework, no build step. Everything lives in localStorage. */
(() => {
  'use strict';

  const STORE_KEY = 'inkling.v1';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const DAY = 86400000;
  const todayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── state ──────────────────────────────────── */
  const state = load();
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (raw && Array.isArray(raw.todos)) return { sound: true, theme: 'auto', doneOpen: true, history: {}, ...raw };
    } catch (_) { /* fall through */ }
    return { todos: [], history: {}, sound: true, theme: 'auto', doneOpen: true, seeded: false };
  }
  function save() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

  /* first visit: a gentle demo so the page isn't a blank stare */
  if (!state.seeded && state.todos.length === 0) {
    const t = Date.now();
    state.todos = [
      { id: uid(), text: 'Type a task above and press enter', done: false, prio: 0, due: null, tags: [], created: t },
      { id: uid(), text: 'Tick this one, listen closely', done: false, prio: 0, due: null, tags: [], created: t - 1 },
      { id: uid(), text: 'Drag me somewhere else', done: false, prio: 2, due: startOfDay() + DAY, tags: [], created: t - 2 },
      { id: uid(), text: 'Press ? for the little tricks', done: false, prio: 0, due: null, tags: ['hint'], created: t - 3 },
    ];
    state.seeded = true;
    save();
  }

  /* ── dom ────────────────────────────────────── */
  const el = {
    html: document.documentElement,
    greeting: $('#greeting'), date: $('#date'), headline: $('#headline'), summary: $('#summary'),
    composer: $('#composer'), input: $('#input'), hints: $('#hints'),
    active: $('#active'), done: $('#done'), empty: $('#empty'), emptyText: $('#emptyText'),
    doneSection: $('#doneSection'), doneToggle: $('#doneToggle'), doneCount: $('#doneCount'), clearDone: $('#clearDone'),
    week: $('#week'), soundBtn: $('#soundBtn'), themeBtn: $('#themeBtn'), helpBtn: $('#helpBtn'),
    help: $('#help'), helpClose: $('#helpClose'),
    toast: $('#toast'), toastText: $('#toastText'), toastUndo: $('#toastUndo'),
    confetti: $('#confetti'), template: $('#todoTemplate'),
  };
  const nodes = new Map(); // id -> li

  /* ── natural language ───────────────────────── */
  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function parse(input) {
    let text = ' ' + input.trim() + ' ';
    let due = null, prio = 0;
    const tags = [];
    const base = startOfDay();

    const take = (re, fn) => {
      const m = text.match(re);
      if (!m) return;
      fn(m);
      text = text.replace(re, ' ');
    };

    take(/\s(!{1,3})(?=\s)/, m => { prio = m[1].length; });
    text = text.replace(/\s#([\p{L}\p{N}_-]{1,24})(?=\s)/gu, (_, t) => { tags.push(t.toLowerCase()); return ' '; });

    take(/\s(?:by\s|on\s|due\s)?(today|tonight)(?=\s)/i, () => { due = base; });
    take(/\s(?:by\s|on\s|due\s)?(tomorrow|tmrw|tmr)(?=\s)/i, () => { due = base + DAY; });
    take(/\s(?:by\s|on\s|due\s)?next\s+week(?=\s)/i, () => { due = base + 7 * DAY; });
    take(/\s(?:by\s|on\s|due\s)?next\s+month(?=\s)/i, () => {
      const d = new Date(base); d.setMonth(d.getMonth() + 1); due = d.getTime();
    });
    take(/\sin\s+(\d{1,2}|a|an|one|two|three|four|five|six|seven)\s+(day|days|week|weeks)(?=\s)/i, m => {
      const words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
      const n = words[m[1].toLowerCase()] ?? parseInt(m[1], 10);
      due = base + n * (m[2].toLowerCase().startsWith('week') ? 7 : 1) * DAY;
    });
    take(/\s(?:by\s|on\s|due\s|next\s|this\s)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:[a-z]*day)?(?=\s)/i, m => {
      const idx = WEEKDAYS.findIndex(w => w.startsWith(m[1].toLowerCase().slice(0, 3)));
      const today = new Date(base).getDay();
      let delta = (idx - today + 7) % 7;
      if (delta === 0) delta = 7;
      if (/\snext\s/i.test(m[0])) delta += 7 * (delta === 7 ? 0 : 1);
      due = base + delta * DAY;
    });
    take(/\s(?:by\s|on\s|due\s)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?=\s)/i, m => {
      const month = MONTHS.indexOf(m[1].toLowerCase().slice(0, 3));
      const d = new Date(new Date(base).getFullYear(), month, parseInt(m[2], 10));
      if (d.getTime() < base - 30 * DAY) d.setFullYear(d.getFullYear() + 1);
      due = d.getTime();
    });

    text = text.replace(/\s+/g, ' ').trim().replace(/[,\s]+$/, '');
    if (text) text = text[0].toUpperCase() + text.slice(1);
    return { text, due, prio, tags };
  }

  function dueLabel(due) {
    if (due == null) return null;
    const diff = Math.round((due - startOfDay()) / DAY);
    if (diff === 0) return { label: 'today', cls: 'soon' };
    if (diff === 1) return { label: 'tomorrow', cls: 'soon' };
    if (diff === -1) return { label: 'yesterday', cls: 'overdue' };
    if (diff < 0) return { label: `${-diff} days ago`, cls: 'overdue' };
    if (diff < 7) return { label: WEEKDAYS[new Date(due).getDay()], cls: '' };
    const d = new Date(due);
    return { label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), cls: '' };
  }

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
  let lastDayKey = null;
  function tickClock() {
    const now = new Date();
    el.html.dataset.daypart = daypart(now.getHours());
    el.greeting.textContent = greeting(now.getHours());
    const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
    const month = now.toLocaleDateString('en-US', { month: 'long' });
    el.date.textContent = `${weekday}, the ${ORDINALS[now.getDate()]} of ${month}`;
    el.date.dateTime = todayKey(now);
    if (lastDayKey && lastDayKey !== todayKey(now)) render(); // midnight rolled over: due labels change
    lastDayKey = todayKey(now);
  }
  tickClock();
  setInterval(tickClock, 30000);

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

  /* ── rendering ──────────────────────────────── */
  const HEADLINES = {
    empty: 'A blank page.',
    clear: 'All clear.',
    one: 'Just one thing.',
    few: 'A few things.',
    plate: 'A full plate.',
    tall: 'A tall order.',
  };
  const EMPTY_LINES = [
    'Nothing to do. Nothing at all.',
    'The page is yours.',
    'Quiet, for now.',
    'Write something down.',
  ];
  const CLEAR_LINES = [
    'Go outside.',
    'That was everything.',
    'Nothing left but the afternoon.',
    'You did the things.',
  ];
  let lastHeadline = null, lastActive = null, lastDone = null, lastClearLine = null;

  function setHeadline(text, italic) {
    if (text === lastHeadline) return;
    lastHeadline = text;
    el.headline.textContent = text;
    el.headline.classList.toggle('is-italic', !!italic);
    el.headline.classList.remove('swap'); void el.headline.offsetWidth; el.headline.classList.add('swap');
    document.title = text === HEADLINES.clear || text === HEADLINES.empty ? 'Inkling' : `Inkling · ${text}`;
  }

  function render() {
    const active = state.todos.filter(t => !t.done);
    const done = state.todos.filter(t => t.done).sort((a, b) => (b.completed || 0) - (a.completed || 0));

    reconcile(el.active, active);
    reconcile(el.done, done);

    // headline
    const n = active.length;
    if (state.todos.length === 0) setHeadline(HEADLINES.empty, true);
    else if (n === 0) setHeadline(HEADLINES.clear, true);
    else setHeadline(n === 1 ? HEADLINES.one : n <= 3 ? HEADLINES.few : n <= 7 ? HEADLINES.plate : HEADLINES.tall, false);

    // summary
    const overdue = active.filter(t => t.due != null && t.due < startOfDay()).length;
    let html = '';
    if (state.todos.length === 0) html = 'Add something and it will appear here.';
    else if (n === 0) { lastClearLine = lastClearLine || CLEAR_LINES[Math.floor(Math.random() * CLEAR_LINES.length)]; html = lastClearLine; }
    else {
      lastClearLine = null;
      html = `<span class="num" data-k="a">${n}</span> to go`;
      if (done.length) html += `, <span class="num" data-k="d">${done.length}</span> done`;
      if (overdue) html += `, <span class="num">${overdue}</span> overdue`;
      html += '.';
    }
    el.summary.innerHTML = html;
    if (lastActive !== null && lastActive !== n) $('[data-k="a"]', el.summary)?.classList.add('bump');
    if (lastDone !== null && lastDone !== done.length) $('[data-k="d"]', el.summary)?.classList.add('bump');
    lastActive = n; lastDone = done.length;

    // empty state
    const showEmpty = n === 0 && state.todos.length === 0;
    if (showEmpty && el.empty.hidden) el.emptyText.textContent = EMPTY_LINES[Math.floor(Math.random() * EMPTY_LINES.length)];
    el.empty.hidden = !showEmpty;

    // done section
    el.doneSection.hidden = done.length === 0;
    if (el.doneCount.textContent !== String(done.length)) {
      el.doneCount.textContent = done.length;
      el.doneCount.classList.remove('bump'); void el.doneCount.offsetWidth; el.doneCount.classList.add('bump');
    }
    el.doneToggle.setAttribute('aria-expanded', String(state.doneOpen));
    el.done.classList.toggle('collapsed', !state.doneOpen);
    el.done.style.maxHeight = state.doneOpen ? el.done.scrollHeight + 'px' : '0px';

    renderWeek();
  }

  /* keep DOM nodes alive across renders so their transitions survive; FLIP the moves */
  function reconcile(list, todos) {
    const first = new Map();
    $$('.todo', list).forEach(li => first.set(li.dataset.id, li.getBoundingClientRect().top));

    let cursor = list.firstElementChild;
    for (const todo of todos) {
      let li = nodes.get(todo.id);
      if (!li) { li = createNode(todo); nodes.set(todo.id, li); }
      updateNode(li, todo);
      if (li !== cursor) list.insertBefore(li, cursor);
      else cursor = cursor.nextElementSibling;
    }
    // remove nodes no longer in this list (they either moved or were deleted)
    const ids = new Set(todos.map(t => t.id));
    $$('.todo', list).forEach(li => {
      if (!ids.has(li.dataset.id) && !li.classList.contains('leaving') && !li.classList.contains('sweeping')) li.remove();
    });

    if (reduceMotion) return;
    $$('.todo', list).forEach(li => {
      const before = first.get(li.dataset.id);
      if (before == null || li.classList.contains('dragging')) return;
      const dy = before - li.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) return;
      li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.16,1,.3,1)' });
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
    $('.todo-text', li).addEventListener('dblclick', () => edit(todo.id));
    $('.grip', li).addEventListener('pointerdown', e => dragStart(e, li));
    li.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch' && !e.target.closest('button, [contenteditable="true"]')) touchHoldStart(e, li);
    });
    return li;
  }

  function updateNode(li, todo) {
    li.classList.toggle('is-done', todo.done);
    $('.check', li).setAttribute('aria-label', todo.done ? 'Mark incomplete' : 'Mark complete');
    const text = $('.todo-text', li);
    if (text.getAttribute('contenteditable') !== 'true' && text.textContent !== todo.text) text.textContent = todo.text;
    const meta = $('.todo-meta', li);
    const d = todo.done ? null : dueLabel(todo.due);
    let html = '';
    if (d) html += `<span class="chip chip-due ${d.cls}">${d.label}</span>`;
    for (const t of todo.tags || []) html += `<span class="chip chip-tag">#${escape(t)}</span>`;
    if (meta.innerHTML !== html) meta.innerHTML = html;
    $('.prio', li).dataset.level = todo.prio || 0;
  }
  const escape = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function renderWeek() {
    const frag = document.createDocumentFragment();
    const today = todayKey();
    for (let i = 6; i >= 0; i--) {
      const key = todayKey(new Date(Date.now() - i * DAY));
      const n = state.history[key] || 0;
      const bar = document.createElement('i');
      bar.style.setProperty('--n', Math.min(n, 5));
      bar.title = `${key}: ${n}`;
      if (key === today) bar.classList.add('today');
      frag.appendChild(bar);
    }
    el.week.replaceChildren(frag);
  }

  /* ── actions ────────────────────────────────── */
  function add(raw) {
    const parsed = parse(raw);
    if (!parsed.text) return;
    const todo = { id: uid(), ...parsed, done: false, created: Date.now() };
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
      todo.done = true; todo.completed = Date.now();
      state.history[key] = (state.history[key] || 0) + 1;
      const burst = $('.burst', li);
      burst.classList.remove('go'); void burst.offsetWidth; burst.classList.add('go');
      sound.complete();
      li.classList.add('is-done');
      save();
      // let the stroke draw before the item travels down
      setTimeout(() => {
        render();
        if (state.todos.every(t => t.done) && state.todos.length >= 2) celebrate();
      }, reduceMotion ? 0 : 520);
    } else {
      todo.done = false; todo.completed = null;
      state.history[key] = Math.max(0, (state.history[key] || 0) - 1);
      sound.tick();
      save(); render();
    }
  }

  function remove(id) {
    const idx = state.todos.findIndex(t => t.id === id);
    if (idx < 0) return;
    const [todo] = state.todos.splice(idx, 1);
    const li = nodes.get(id);
    nodes.delete(id);
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
    save(); render(); sound.tick();
  }

  function edit(id) {
    const todo = state.todos.find(t => t.id === id);
    const li = nodes.get(id);
    if (!todo || !li || todo.done) return;
    const text = $('.todo-text', li);
    if (text.getAttribute('contenteditable') === 'true') return;
    const original = todo.text;
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
          if (parsed.due != null) todo.due = parsed.due;
          if (parsed.prio) todo.prio = parsed.prio;
          if (parsed.tags.length) todo.tags = [...new Set([...(todo.tags || []), ...parsed.tags])];
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
    const active = state.todos.filter(t => !t.done);
    const i = active.findIndex(t => t.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= active.length) return;
    const a = state.todos.indexOf(active[i]), b = state.todos.indexOf(active[j]);
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
      done.forEach(t => nodes.delete(t.id));
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
    el.toast.style.setProperty('--toast-ms', ms + 'ms');
    el.toast.classList.remove('out');
    el.toast.hidden = false;
    // restart the bar animation
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
    add(el.input.value);
    el.input.value = '';
    el.composer.classList.remove('has-text', 'has-hints');
    el.hints.innerHTML = '';
  });
  el.input.addEventListener('input', () => {
    const v = el.input.value;
    el.composer.classList.toggle('has-text', v.trim().length > 0);
    const p = parse(v);
    const chips = [];
    const d = dueLabel(p.due);
    if (d) chips.push(`<span class="hint hint-due">due ${d.label}</span>`);
    if (p.prio) chips.push(`<span class="hint hint-prio">${['', 'low', 'high', 'urgent'][p.prio]} priority</span>`);
    p.tags.forEach(t => chips.push(`<span class="hint">#${escape(t)}</span>`));
    const html = chips.join('');
    if (el.hints.innerHTML !== html) el.hints.innerHTML = html;
    el.composer.classList.toggle('has-hints', chips.length > 0);
  });

  // rotating placeholders, so the composer teaches by example
  const PLACEHOLDERS = [
    'What needs doing?',
    'Water the ferns tomorrow',
    'Call Ada on friday !!',
    'Finish the draft #work',
    'Buy stamps in 3 days',
    'Fix the squeaky door !',
    'Book the train next week #trip',
  ];
  let phIndex = 0;
  setInterval(() => {
    if (document.activeElement === el.input || el.input.value) return;
    phIndex = (phIndex + 1) % PLACEHOLDERS.length;
    el.input.classList.add('placeholder-swap');
    setTimeout(() => { el.input.placeholder = PLACEHOLDERS[phIndex]; el.input.classList.remove('placeholder-swap'); }, 320);
  }, 4200);

  /* ── done section ───────────────────────────── */
  el.doneToggle.addEventListener('click', () => { state.doneOpen = !state.doneOpen; save(); render(); sound.tick(); });
  el.clearDone.addEventListener('click', clearDone);

  /* ── help ───────────────────────────────────── */
  el.helpBtn.addEventListener('click', () => { el.help.showModal(); sound.tick(); });
  el.helpClose.addEventListener('click', () => el.help.close());
  el.help.addEventListener('click', e => { if (e.target === el.help) el.help.close(); });

  /* ── keyboard ───────────────────────────────── */
  document.addEventListener('keydown', e => {
    const inInput = e.target === el.input || e.target.isContentEditable;
    if (e.key === 'Escape') {
      if (el.help.open) return; // dialog handles it
      if (!el.toast.hidden) { hideToast(); return; }
      if (inInput) { el.input.blur(); return; }
    }
    if (inInput) return;
    if (e.key === '?' ) { e.preventDefault(); el.help.open ? el.help.close() : el.help.showModal(); return; }
    if (e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); el.input.focus(); return; }
    if (e.key === 'z' && (e.metaKey || e.ctrlKey) && toastAction) { e.preventDefault(); const fn = toastAction; hideToast(); fn(); return; }

    const items = [...$$('.todo', el.active), ...(state.doneOpen ? $$('.todo', el.done) : [])];
    const focused = e.target.closest?.('.todo');
    const idx = items.indexOf(focused);
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
  });

  /* ── drag to reorder ────────────────────────── */
  let drag = null;
  function dragStart(e, li) {
    if (li.classList.contains('is-done')) return;
    e.preventDefault();
    const rect = li.getBoundingClientRect();
    drag = { li, pointerId: e.pointerId, startY: e.clientY, lastY: e.clientY, startTop: rect.top, translate: 0 };
    li.classList.add('dragging');
    el.active.classList.add('is-dragging');
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
    const siblings = $$('.todo', el.active).filter(s => s !== li);
    for (const s of siblings) {
      const r = s.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      const sIsBefore = !!(s.compareDocumentPosition(li) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (sIsBefore && e.clientY < mid) { flipMove(() => el.active.insertBefore(li, s), siblings); break; }
      if (!sIsBefore && e.clientY > mid) { flipMove(() => el.active.insertBefore(li, s.nextSibling), siblings); break; }
    }
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
    // commit the order from the DOM
    const order = $$('.todo', el.active).map(s => s.dataset.id);
    const active = order.map(id => state.todos.find(t => t.id === id));
    const done = state.todos.filter(t => t.done);
    state.todos = [...active, ...done];
    save();
    li.style.transform = '';
    li.classList.remove('dragging');
    el.active.classList.remove('is-dragging');
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
  render();
  // stagger the first paint
  if (!reduceMotion) {
    $$('.todo').forEach((li, i) => {
      li.style.animationDelay = `${300 + i * 70}ms`;
      li.classList.add('entering');
      li.addEventListener('animationend', () => { li.classList.remove('entering'); li.style.animationDelay = ''; }, { once: true });
    });
  }
  addEventListener('resize', () => { if (state.doneOpen) el.done.style.maxHeight = el.done.scrollHeight + 'px'; });
})();
