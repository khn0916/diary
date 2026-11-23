'use strict';
const STORAGE_KEY = 'yeobaek.diary.v1';
const today = new Date();
let shown = new Date(today.getFullYear(), today.getMonth(), 1);
let selectedKey = '';
let store = { entries: {}, notes: {} };
let calendarPlans = [];
let calendarPlanLanes = 0;
const previewSegments = new Intl.Segmenter('ko', { granularity: 'grapheme' });
const $ = id => document.getElementById(id);
const keyOf = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const monthKey = () => keyOf(shown).slice(0, 7);
const months = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
// Decorative month illustrations share the same 32 × 32 drawing area.
const monthIcons = [
  // January: snowflake
  'M16 3v26M5 9.5l22 13M5 22.5l22-13M12 6l4 4 4-4m-8 20 4-4 4 4M5.5 14l5.5-1.5L9.5 7m13 18-1.5-5.5 5.5-1.5m0-4L21 12.5 22.5 7m-13 18 1.5-5.5L5.5 18',
  // February: bungeoppang, with a pressed tail and pastry scales
  'M3 16c1.5-5 5.5-8 10.5-8 4.1 0 7.1 2.3 9.2 5l5.8-3c1.1-.5 1.7.3 1.4 1.6L28 16l1.9 4.4c.3 1.3-.3 2.1-1.4 1.6l-5.8-3c-2.2 2.7-5.1 5-9.2 5C8.5 24 4.5 21 3 16ZM8 14h.01M3.2 17.5H6m6-7c1.9 3.6 1.9 7.5 0 11m4-9c2.4.7 2.4 3 0 3.7 2.4.7 2.4 3 0 3.7m7-4 5-2m-5 2 5 2',
  // March: sprout
  'M16 28V17M9 28h14M16 21C10 21 6 17 5 11c6 0 10 4 11 10Z M16 18C16 11 20 6 27 5c0 7-4 12-11 13Z',
  // April: blossom
  'M16 11c-5-8-10-2-7 3-7 0-8 7-1 8 2 0 4-1 5-2-2 6 3 10 7 5 1-2 1-4 0-5 5 5 11 1 8-4-1-2-4-2-6-2 3-5-2-11-6-3Zm0 5h.01',
  // May: pinwheel for Children’s Day
  'M16 15c-6 0-9-4-8-10l8 4 2 6c0-6 4-9 10-8l-4 8-6 2c6 0 9 4 8 10l-8-4-2-6c0 6-4 9-10 8l4-8 6-2Zm1 4v10',
  // June: umbrella
  'M5 17a11 11 0 0 1 22 0c-3-3-5-3-8 0-2-3-4-3-6 0-3-3-5-3-8 0ZM16 15v11a2.5 2.5 0 0 0 5 0',
  // July: sandcastle, flag and beach shovel
  'M8 24l1-9h3v2h3v-2h3v2h3v-2h4l1.5 10M10 15l1-6h2v2h2V9h3v2h2V9h3l1 6M17 9V3l6 2-6 2M14 24v-3a3 3 0 0 1 6 0v3M2.5 29c3-3.4 8-5 14-5 5.5 0 10 1.5 13 5ZM3 17l2 5m-2-5c-1.6.5-2.5-2.5-1-3s2.6 2.5 1 3Zm4 9-3-1.5.5-2.5 2.7.9',
  // August: naengmyeon with chopsticks, noodles and toppings
  'M4 5h24a1.1 1.1 0 0 1 0 2.2H4A1.1 1.1 0 0 1 4 5ZM7 7.2c-2 2 .8 3 0 5-.6 1.4-1.4 2-.8 3.8m4-8.8c-1.8 2 .8 3 0 5-.7 1.4-1.4 2-.7 3.8m4-8.8c-1.7 2 1 3 0 5-.6 1.4-1.3 2-.7 3.8M4 16h24c-1 7-5.5 10.5-12 10.5S5 23 4 16Zm9 10-1 3h8l-1-3M18 10l2 2-2 2-2-2Zm7 0 2 2-2 2-2-2Z',
  // September: acorn
  'M16 9c0-3 2-5 5-5m-14 9c0-4 4-6 9-6s9 2 9 6v3H7Zm2 3v3c0 5 4 8 7 10 3-2 7-5 7-10v-3m-7-5v1m-4-1v1m8-1v1',
  // October: jack-o'-lantern
  'M16 8C9 4 3 10 3 18s5.5 11 10 10c1.6.7 4.4.7 6 0 4.5 1 10-2 10-10S23 4 16 8ZM15 7.5c-.3-2 .2-3.5 1.5-5l2 1.2c-.9 1.2-1.3 2.5-1 3.8M11 11l-2.5 4h5ZM21 11l-2.5 4h5ZM8 19l4 1.5 1-1.5 3 2 3-2 1 1.5 4-1.5c-1.2 4.2-4.7 6-8 6s-6.8-1.8-8-6Z',
  // November: maple leaf
  'm16 3 3.5 8 4-2-.5 7 5-1-2 6-7 3-3-1-3 1-7-3-2-6 5 1-.5-7 4 2L16 3Zm0 13v13',
  // December: Christmas tree
  'm16 5 6 8h-3l6 7h-4l5 5H6l5-5H7l6-7h-3l6-8Zm-2 20v4h4v-4m-7-8h.01m7 4h.01m1-9h.01'
];
let storageReadable = true;
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const data = JSON.parse(raw);
    if (!data || typeof data.entries !== 'object' || !data.entries || Array.isArray(data.entries) || typeof data.notes !== 'object' || !data.notes || Array.isArray(data.notes)) throw new Error('Invalid diary data');
    store = data;
  }
} catch {
  storageReadable = false;
  $('saveStatus').textContent = '저장된 기록을 읽지 못했습니다. 저장소 설정을 확인하세요.';
}
function persist() {
  if (!storageReadable) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    $('saveStatus').textContent = '기록이 저장되었어요';
    return true;
  } catch {
    $('saveStatus').textContent = '저장 공간을 확인해주세요. 현재 기록은 임시 보관 중입니다.';
    return false;
  }
}
function render() {
  const year = shown.getFullYear(), month = shown.getMonth();
  $('yearLabel').textContent = year;
  $('monthEnglish').textContent = `${months[month]} ${year}`;
  $('monthTitle').textContent = `${String(month+1).padStart(2,'0')}월`;
  const monthIcon = $('monthIconPath');
  monthIcon.setAttribute('d', monthIcons[month]);
  monthIcon.setAttribute('fill', month === 2 ? 'currentColor' : 'none');
  $('navDate').textContent = `${year}. ${String(month+1).padStart(2,'0')}`;
  $('pageNumber').textContent = `${String(month*2+1).padStart(2,'0')} — ${String(month*2+2).padStart(2,'0')}`;
  $('monthlyNote').value = typeof store.notes[monthKey()] === 'string' ? store.notes[monthKey()] : '';
  const fragment = document.createDocumentFragment();
  const firstDay = new Date(year,month,1).getDay();
  let count = 0;
  for (let index = 0; index < 42; index++) {
    const date = new Date(year, month, index-firstDay+1);
    const key = keyOf(date), entry = store.entries[key];
    const holiday = typeof koreanPublicHolidays === 'undefined' ? '' : koreanPublicHolidays[key];
    const inMonth = date.getMonth() === month;
    const isToday = key === keyOf(today);
    if (inMonth && entry) count++;
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = `day${inMonth?'':' outside'}${isToday?' today':''}${index%7===0?' sunday':''}${index%7===6?' saturday':''}`;
    cell.dataset.date = key;
    cell.dataset.dayLabel = `${date.getFullYear()}년 ${date.getMonth()+1}월 ${date.getDate()}일${isToday?', 오늘':''}${entry?', 기록 있음':', 기록하기'}`;
    if (holiday) {
      cell.classList.add('public-holiday');
      cell.dataset.dayLabel += `, ${holiday}`;
    }
    if (isToday) cell.setAttribute('aria-current','date');
    const number = document.createElement('span');
    number.className = 'day-number'; number.textContent = date.getDate(); cell.append(number);
    if (holiday) {
      const label = document.createElement('span');
      label.className = 'holiday-label';
      label.textContent = label.title = holiday;
      cell.append(label);
    }
    if (entry && typeof entry.mood === 'string' && ['☀','❀','☁','☂'].includes(entry.mood)) {
      const mood = document.createElement('span'); mood.className = 'day-mood'; mood.textContent = entry.mood; cell.append(mood);
    }
    if (isToday) { const tag = document.createElement('span'); tag.className = 'today-tag'; tag.textContent = 'TODAY'; cell.append(tag); }
    if (entry && typeof entry.text === 'string') {
      const content = document.createElement('span');
      content.className = 'day-content';
      if (entry.text.trim()) cell.append(content);
    }
    fragment.append(cell);
  }
  $('days').replaceChildren(fragment);
  renderPlanMarks();
  $('entryCount').textContent = `${count} DAYS RECORDED`;
}
function countPlanLanes(plans) {
  // Start an interval before ending any interval on the same day.
  const boundaries = plans.flatMap(plan => [
    { date: plan.start_date, change: 1 },
    { date: plan.end_date, change: -1 }
  ]);
  boundaries.sort((a, b) => a.date.localeCompare(b.date) || b.change - a.change);
  let active = 0;
  let peak = 0;
  for (const { change } of boundaries) {
    active += change;
    peak = Math.max(peak, active);
  }
  return peak;
}
function updateCalendarHeight(grid) {
  // Reserve the same row height for every month, including during a paper turn.
  const hasPreview = Object.values(store.entries).some(entry =>
    typeof entry?.text === 'string' && entry.text.trim()
  );
  const baseHeight = hasPreview ? '66px' : 'var(--plan-top)';
  grid.style.setProperty('--plan-min-height', `calc(${baseHeight} + ${calendarPlanLanes} * var(--plan-step))`);
}
function renderPlanMarks() {
  const grid = $('days');
  const cells = Array.from(grid.querySelectorAll('.day'));
  const dates = cells.map(cell => cell.dataset.date);
  const dayPlans = cells.map(() => []);
  const depth = cells.map(() => 0);
  const visiblePlans = calendarPlans
    .filter(plan => plan.end_date >= dates[0] && plan.start_date <= dates.at(-1))
    .map(plan => ({
      plan,
      start: dates.findIndex(date => date >= plan.start_date),
      end: dates.findLastIndex(date => date <= plan.end_date)
    }));
  const overlay = document.createElement('div');
  overlay.className = 'calendar-plan-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  for (let offset = 0; offset < cells.length; offset += 7) {
    const week = document.createElement('div');
    week.className = 'calendar-plan-week';
    const lanes = [];
    for (const { plan, start, end } of visiblePlans) {
      if (end < offset || start > offset + 6) continue;
      const first = Math.max(start, offset);
      const last = Math.min(end, offset + 6);
      // Each bit represents an occupied day column in this week.
      const columns = ((1 << (last - first + 1)) - 1) << (first - offset);
      let lane = lanes.findIndex(used => !(used & columns));
      if (lane === -1) lane = lanes.length;
      lanes[lane] = (lanes[lane] || 0) | columns;

      const mark = document.createElement('span');
      mark.className = 'plan-highlight plan-paper';
      mark.dataset.color = plan.color;
      mark.classList.toggle('plan-start', dates[first] === plan.start_date);
      mark.classList.toggle('plan-end', dates[last] === plan.end_date);
      mark.style.gridColumn = `${first - offset + 1} / ${last - offset + 2}`;
      mark.style.gridRow = String(lane + 1);
      if (first === start) mark.textContent = plan.title;
      week.append(mark);

      for (let index = first; index <= last; index++) {
        dayPlans[index].push(plan.title);
        depth[index] = Math.max(depth[index], lane + 1);
      }
    }
    overlay.append(week);
  }
  grid.querySelector('.calendar-plan-overlay')?.remove();
  if (dayPlans.some(plans => plans.length)) grid.append(overlay);
  for (const [index, cell] of cells.entries()) {
    const plans = dayPlans[index];
    cell.setAttribute('aria-label', [cell.dataset.dayLabel, ...plans].join(', '));
    cell.style.setProperty('--plan-lanes', depth[index]);
    const preview = cell.querySelector('.day-content');
    if (preview) preview.hidden = plans.length >= 2;
  }
  updateCalendarHeight(grid);
  renderEntryPreviews();
}
function renderEntryPreviews() {
  for (const preview of $('days').querySelectorAll('.day-content:not([hidden])')) {
    const text = store.entries[preview.closest('.day').dataset.date]?.text ?? '';
    preview.textContent = text;
    if (!preview.clientHeight || preview.scrollHeight <= preview.clientHeight) continue;

    const parts = Array.from(previewSegments.segment(text), part => part.index);
    let low = 0, high = parts.length - 1;
    const withDots = count => text.slice(0, parts[count]).trimEnd() + '···';
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      preview.textContent = withDots(middle);
      if (preview.scrollHeight <= preview.clientHeight) low = middle;
      else high = middle - 1;
    }
    preview.textContent = withDots(low);
  }
}
function openEntry(key) {
  selectedKey = key;
  const [year,month,day] = key.split('-').map(Number);
  $('dialogTitle').textContent = `${month}월 ${day}일 ${new Date(year,month-1,day).toLocaleDateString('ko-KR',{weekday:'long'})}`;
  $('entryForm').reset();
  const entry = store.entries[key];
  $('entryText').value = typeof entry?.text === 'string' ? entry.text : '';
  for (const radio of document.querySelectorAll('input[name="mood"]')) radio.checked = radio.value === entry?.mood;
  $('deleteEntry').hidden = !entry;
  $('dialogStatus').textContent = '';
  $('entryDialog').showModal();
}
$('days').addEventListener('click', event => {
  const cell = event.target.closest('[data-date]');
  if (cell) openEntry(cell.dataset.date);
});
$('previousMonth').addEventListener('click', () => { if (pageTurn) return; shown = new Date(shown.getFullYear(),shown.getMonth()-1,1); render(); });
$('nextMonth').addEventListener('click', () => { if (pageTurn) return; shown = new Date(shown.getFullYear(),shown.getMonth()+1,1); render(); });
$('todayButton').addEventListener('click', () => { if (pageTurn) return; shown = new Date(today.getFullYear(),today.getMonth(),1); render(); const cell = document.querySelector('.day.today'); cell?.focus({preventScroll:true}); cell?.scrollIntoView({block:'nearest',inline:'center'}); });
$('monthlyNote').addEventListener('input', () => { store.notes[monthKey()] = $('monthlyNote').value; persist(); });
$('closeDialog').addEventListener('click', () => $('entryDialog').close());
$('entryForm').addEventListener('submit', event => {
  event.preventDefault();
  const text = $('entryText').value.trim();
  const mood = document.querySelector('input[name="mood"]:checked')?.value || '';
  if (!text && !mood) delete store.entries[selectedKey];
  else store.entries[selectedKey] = { text, mood };
  const saved = persist();
  render();
  if (saved) $('entryDialog').close();
  else $('dialogStatus').textContent = '브라우저에 저장하지 못했습니다. 이 창의 기록을 복사해 보관해주세요.';
});
$('deleteEntry').addEventListener('click', () => {
  delete store.entries[selectedKey];
  const saved = persist(); render();
  if (saved) $('entryDialog').close();
  else $('dialogStatus').textContent = '삭제 내용을 저장하지 못했습니다. 저장소 설정을 확인해주세요.';
});
// Reflect the lifted portion of a paper sheet across the crease between its
// original corner and the pointer. The next month is revealed underneath.
const book = document.querySelector('.book');
let pageTurn = null;
function clipHalfPlane(points, midpoint, normal, keepCorner) {
  const result = [];
  const distance = p => (p.x-midpoint.x)*normal.x + (p.y-midpoint.y)*normal.y;
  const inside = d => keepCorner ? d >= 0 : d <= 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i+1)%points.length];
    const da = distance(a), db = distance(b);
    if (inside(da)) result.push(a);
    if (inside(da) !== inside(db)) {
      const t = da/(da-db);
      result.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
    }
  }
  return result;
}
function polygon(points) {
  return points.length ? `polygon(${points.map(p=>`${p.x}px ${p.y}px`).join(',')})` : 'polygon(0 0,0 0,0 0)';
}
function copyPaper() {
  const copy = book.cloneNode(true);
  copy.querySelectorAll('.page-corner,.turn-stage').forEach(el=>el.remove());
  copy.removeAttribute('aria-label');
  copy.removeAttribute('id');
  copy.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
  copy.className = 'book turn-copy';
  copy.inert = true;
  copy.setAttribute('aria-hidden','true');
  return copy;
}
function liftPaper(turn) {
  if (pageTurn !== turn || turn.active) return;
  turn.active = true;
  turn.stationary = copyPaper();
  turn.front = copyPaper();
  turn.back = copyPaper();
  turn.back.classList.add('turn-back');
  turn.shade = document.createElement('div');
  turn.shade.className = 'turn-crease';
  turn.stage = document.createElement('div');
  turn.stage.className = 'turn-stage';
  turn.stage.setAttribute('aria-hidden','true');
  turn.stage.append(turn.stationary,turn.front);
  // Keep the flat sheet clipped to the book. Lift the folded sheet into a fixed
  // layer outside both overflow containers so its upper tip is never cut off.
  turn.floating = document.createElement('div');
  turn.floating.className = 'diary-open turn-floating';
  turn.floating.inert = true;
  turn.floating.setAttribute('aria-hidden','true');
  turn.floating.append(turn.back,turn.shade);
  positionFloating(turn);
  turn.stationary.style.clipPath = turn.direction === 1 ? 'inset(0 50% 0 0)' : 'inset(0 0 0 50%)';
  shown = new Date(turn.original.getFullYear(),turn.original.getMonth()+turn.direction,1);
  render();
  book.append(turn.stage);
  document.body.append(turn.floating);
  book.classList.add('turning');
  $('turnStatus').textContent = '안쪽으로 당긴 뒤 놓아 페이지를 넘기세요.';
  drawPaper(turn,turn.x,turn.y);
}
function positionFloating(turn) {
  const rect=book.getBoundingClientRect();
  turn.floating.style.left=`${rect.left}px`;
  turn.floating.style.top=`${rect.top}px`;
  turn.floating.style.width=`${turn.width}px`;
  turn.floating.style.height=`${turn.height}px`;
}
function drawPaper(turn,x,y) {
  positionFloating(turn);
  const {width:w,height:h} = turn;
  const cx = turn.direction === 1 ? w : 0;
  x = Math.max(0,Math.min(w,x));
  y = Math.max(h*.1,Math.min(h-1,y));
  // At least a small curl makes the initial long press visible.
  if (Math.abs(cx-x)<2) x = cx-turn.direction*2;
  turn.x = x; turn.y = y;
  const dx = cx-x,dy = h-y,length = Math.hypot(dx,dy);
  const n = {x:dx/length,y:dy/length},m = {x:(cx+x)/2,y:(h+y)/2};
  const sheet = [{x:w/2,y:0},{x:turn.direction===1?w:0,y:0},{x:cx,y:h},{x:w/2,y:h}];
  const flat = clipHalfPlane(sheet,m,n,false),flap = clipHalfPlane(sheet,m,n,true);
  turn.front.style.clipPath = polygon(flat);
  turn.back.style.clipPath = polygon(flap);
  const a=1-2*n.x*n.x,b=-2*n.x*n.y,d=1-2*n.y*n.y;
  const projection = 2*(n.x*m.x+n.y*m.y);
  const tx=n.x*projection,ty=n.y*projection;
  const reflection=`matrix(${a},${b},${b},${d},${tx},${ty})`;
  turn.back.style.transform = reflection;
  turn.shade.style.clipPath = polygon(flap);
  turn.shade.style.transform = reflection;
  turn.shade.style.setProperty('--crease-angle',`${Math.atan2(n.y,n.x)*180/Math.PI+90}deg`);
}
function finishPaper(commit) {
  const turn = pageTurn;
  if (!turn || turn.settling) return;
  clearTimeout(turn.holdTimer);
  if (!turn.active) { cleanupPaper(turn,false); return; }
  turn.settling = true;
  const fromX=turn.x,fromY=turn.y,cx=turn.direction===1?turn.width:0;
  const toX=commit?(turn.direction===1?0:turn.width):cx;
  const started=performance.now();
  const duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:360;
  function animate(now) {
    const t=duration?Math.min(1,(now-started)/duration):1;
    const ease=1-Math.pow(1-t,3);
    drawPaper(turn,fromX+(toX-fromX)*ease,fromY+(turn.height-1-fromY)*ease);
    if (t<1) turn.frame=requestAnimationFrame(animate);
    else cleanupPaper(turn,commit);
  }
  turn.frame=requestAnimationFrame(animate);
}
function cleanupPaper(turn,commit) {
  clearTimeout(turn.holdTimer);
  cancelAnimationFrame(turn.frame);
  if (!commit) { shown = turn.original; render(); }
  turn.stage?.remove();
  turn.floating?.remove();
  book.classList.remove('turning','turn-held');
  pageTurn=null;
  turn.updatePlans?.();
  $('turnStatus').textContent = commit?`${shown.getFullYear()}년 ${shown.getMonth()+1}월을 펼쳤어요.`:'아래 모서리를 꾹 누르고 안쪽으로 당겨보세요.';
}
for (const [id,direction] of [['turnPrevious',-1],['turnNext',1]]) {
  const corner=$(id);
  corner.addEventListener('pointerdown',event=>{
    if (pageTurn || !event.isPrimary || event.button!==0) return;
    const rect=book.getBoundingClientRect();
    const turn={direction,original:new Date(shown),pointerId:event.pointerId,width:rect.width,height:rect.height,x:event.clientX-rect.left,y:event.clientY-rect.top,active:false};
    pageTurn=turn;
    corner.setPointerCapture(event.pointerId);
    book.classList.add('turn-held');
    turn.holdTimer=setTimeout(()=>liftPaper(turn),220);
    event.preventDefault();
  });
  corner.addEventListener('pointermove',event=>{
    const turn=pageTurn;
    if (!turn || turn.pointerId!==event.pointerId || turn.settling) return;
    const rect=book.getBoundingClientRect();
    turn.x=event.clientX-rect.left; turn.y=event.clientY-rect.top;
    const inward=direction===1?turn.width-turn.x:turn.x;
    if (!turn.active && inward>48) liftPaper(turn);
    if (turn.active) drawPaper(turn,turn.x,turn.y);
  });
  corner.addEventListener('pointerup',event=>{
    const turn=pageTurn;
    if (!turn || turn.pointerId!==event.pointerId) return;
    const inward=direction===1?turn.width-turn.x:turn.x;
    finishPaper(turn.active && inward>=Math.min(140,turn.width*.18));
  });
  for (const type of ['pointercancel','lostpointercapture']) corner.addEventListener(type,event=>{
    if (pageTurn?.pointerId===event.pointerId && !pageTurn.settling) finishPaper(false);
  });
  // Enter / Space provides the same interaction without dragging.
  corner.addEventListener('click',event=>{
    if (event.detail!==0 || pageTurn) return;
    const rect=book.getBoundingClientRect();
    pageTurn={direction,original:new Date(shown),width:rect.width,height:rect.height,x:direction===1?rect.width-20:20,y:rect.height-20};
    liftPaper(pageTurn); finishPaper(true);
  });
}
document.addEventListener('keydown',event=>{if(event.key==='Escape' && pageTurn && !pageTurn.settling) finishPaper(false);});
window.addEventListener('blur',()=>{if(pageTurn && !pageTurn.settling) finishPaper(false);});
window.addEventListener('resize',()=>{if(pageTurn) cleanupPaper(pageTurn,false);});
window.addEventListener('scroll',()=>{if(pageTurn?.active) positionFloating(pageTurn);},{capture:true,passive:true});
render();
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    if (!pageTurn) renderEntryPreviews();
  }).observe($('days'));
  document.fonts?.ready.then(renderEntryPreviews);
}
if (window.PDSStorage) {
  let planRead = 0;
  async function refreshCalendarPlans() {
    const request = ++planRead;
    try {
      const { state } = await window.PDSStorage.read();
      if (request !== planRead) return;
      const applyPlans = () => {
        if (request !== planRead) return;
        // Processing plans by start date keeps the weekly lane count within the overlap peak.
        calendarPlans = state.plans.filter(plan => !plan.deleted_at)
          .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.priority - b.priority || a.id - b.id);
        calendarPlanLanes = countPlanLanes(calendarPlans);
        renderPlanMarks();
      };
      if (pageTurn) pageTurn.updatePlans = applyPlans;
      else applyPlans();
    } catch {
      if (request === planRead) $('saveStatus').textContent = '계획 노트의 일정을 불러오지 못했어요.';
    }
  }
  window.PDSStorage.channel?.addEventListener('message', refreshCalendarPlans);
  window.addEventListener('pageshow', refreshCalendarPlans);
  window.addEventListener('focus', refreshCalendarPlans);
  refreshCalendarPlans();
}
