'use strict';
const STORAGE_KEY = 'yeobaek.diary.v1';
const today = new Date();
let shown = new Date(today.getFullYear(), today.getMonth(), 1);
let selectedKey = '';
let store = { entries: {}, notes: {} };
const $ = id => document.getElementById(id);
const keyOf = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const monthKey = () => keyOf(shown).slice(0, 7);
const months = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
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
  $('navDate').textContent = `${year}. ${String(month+1).padStart(2,'0')}`;
  $('pageNumber').textContent = `${String(month*2+1).padStart(2,'0')} — ${String(month*2+2).padStart(2,'0')}`;
  $('monthlyNote').value = typeof store.notes[monthKey()] === 'string' ? store.notes[monthKey()] : '';
  const fragment = document.createDocumentFragment();
  const firstDay = new Date(year,month,1).getDay();
  let count = 0;
  for (let index = 0; index < 42; index++) {
    const date = new Date(year, month, index-firstDay+1);
    const key = keyOf(date), entry = store.entries[key];
    const inMonth = date.getMonth() === month;
    const isToday = key === keyOf(today);
    if (inMonth && entry) count++;
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = `day${inMonth?'':' outside'}${isToday?' today':''}${index%7===0?' sunday':''}${index%7===6?' saturday':''}`;
    cell.dataset.date = key;
    cell.setAttribute('aria-label', `${date.getFullYear()}년 ${date.getMonth()+1}월 ${date.getDate()}일${isToday?', 오늘':''}${entry?', 기록 있음':', 기록하기'}`);
    if (isToday) cell.setAttribute('aria-current','date');
    const number = document.createElement('span');
    number.className = 'day-number'; number.textContent = date.getDate(); cell.append(number);
    if (entry && typeof entry.mood === 'string' && ['☀','❀','☁','☂'].includes(entry.mood)) {
      const mood = document.createElement('span'); mood.className = 'day-mood'; mood.textContent = entry.mood; cell.append(mood);
    }
    if (isToday) { const tag = document.createElement('span'); tag.className = 'today-tag'; tag.textContent = 'TODAY'; cell.append(tag); }
    if (entry && typeof entry.text === 'string') {
      const content = document.createElement('span'); content.className = 'day-content'; content.textContent = entry.text; cell.append(content);
    }
    fragment.append(cell);
  }
  $('days').replaceChildren(fragment);
  $('entryCount').textContent = `${count} DAYS RECORDED`;
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
