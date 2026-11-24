// Exercise the cover state machine without touching browser records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function element() {
  const classes = new Set();
  return { hidden: false, inert: false, disabled: false, events: {}, children: [],
    classList: { add(...names) { names.forEach(n => classes.add(n)); }, remove(...names) { names.forEach(n => classes.delete(n)); }, replace(a, b) { classes.delete(a); classes.add(b); }, contains: n => classes.has(n) },
    addEventListener(type, fn) { this.events[type] = fn; }, click() { this.events.click?.(); },
    replaceChildren(...nodes) { this.children = nodes; }, setAttribute(name, value) { this[name] = value; }, focus() { this.focused = true; }
  };
}
function setup(reduced = false) {
  const ids = Object.fromEntries(['coverScene', 'diaryWorkspace', 'openDiary', 'coverYear', 'todayButton', 'monthTitle'].map(id => [id, element()]));
  ids.diaryWorkspace.hidden = true;
  let month = 12, turning = false;
  ids.todayButton.events.click = () => { month = 11; };
  const viewport = { scrollLeft: 0, scrollWidth: 1000, clientWidth: 400 };
  ids.diaryWorkspace.querySelector = selector => selector === '.book-viewport' ? viewport : turning;
  const timers = new Map(); let sequence = 0;
  const motion = { matches: reduced, addEventListener(_, fn) { this.change = fn; } };
  const body = element(); body.classList.add('diary-closed');
  const context = vm.createContext({ Date, String, Math, matchMedia: () => motion,
    document: { getElementById: id => ids[id], createElement: element, body }, window: { scrollTo() {}, DiaryAuth: { enter: open => open() } },
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(fs.readFileSync(`${__dirname}/cover.js`, 'utf8'), context);
  const tick = delay => { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.fn(); } };
  return { ids, viewport, timers, body, motion, tick, month: () => month, turning(value) { turning = value; } };
}
const normal = setup();
assert(normal.ids.diaryWorkspace.inert);
assert.equal(normal.ids.coverYear.children.map(n => n.textContent).join(''), String(new Date().getFullYear()));
normal.ids.openDiary.click();
assert.equal(normal.month(), 11);
assert.equal(normal.ids.diaryWorkspace.hidden, false);
assert.equal(normal.ids.diaryWorkspace.inert, true);
assert(normal.ids.openDiary.disabled);
assert(normal.ids.coverScene.classList.contains('is-opening'));
normal.ids.openDiary.click();
assert.equal(normal.timers.size, 2, 'duplicate activation must not schedule extra animations');
normal.tick(1050);
assert(!normal.ids.diaryWorkspace.classList.contains('is-revealing'));
normal.tick(1750);
assert(normal.ids.coverScene.hidden);
assert(!normal.ids.diaryWorkspace.inert);
assert(normal.ids.monthTitle.focused);
assert.equal(normal.viewport.scrollLeft, 300);
assert.equal(normal.timers.size, 0);
assert(!fs.readFileSync(`${__dirname}/index.html`, 'utf8').includes('closeDiary'));
assert(!fs.readFileSync(`${__dirname}/cover.js`, 'utf8').includes('closeDiary'));
const reduced = setup(true); reduced.ids.openDiary.click();
assert(reduced.ids.coverScene.hidden);
assert.equal(reduced.timers.size, 0);
assert(!reduced.ids.diaryWorkspace.inert);
const changed = setup(); changed.ids.openDiary.click(); changed.motion.matches = true; changed.motion.change();
assert(changed.ids.coverScene.hidden);
assert.equal(changed.timers.size, 0);
console.log('PASS: closed entry, current month, stagger lifecycle, duplicate activation, centered monthly, no return-to-cover feature, focus, reduced motion and timer cleanup.');
