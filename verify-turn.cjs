// Run with: node verify-turn.cjs. Exercise pointer lifecycle without browser storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor(){this.events={};this.style={setProperty(){}};this.classList={add(){},remove(){}};}
  addEventListener(type,handler){this.events[type]=handler;}
  getBoundingClientRect(){return {left:0,top:0,width:1000,height:800};}
  cloneNode(){return new Element();}
  querySelectorAll(){return [];}
  removeAttribute(){} setAttribute(){} append(){} remove(){} setPointerCapture(){}
}
const elements = Object.fromEntries(['turnPrevious','turnNext','turnStatus'].map(id=>[id,new Element()]));
const book = new Element();
const timers=new Map(),frames=new Map();
let sequence=0,clock=0;
const context=vm.createContext({
  console,Date,Math,shown:new Date(2026,10,1),render(){},$:id=>elements[id],
  document:{querySelector:()=>book,createElement:()=>new Element(),addEventListener(){}},
  window:{addEventListener(){}},performance:{now:()=>clock},matchMedia:()=>({matches:false}),
  setTimeout:fn=>{const id=++sequence;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
  requestAnimationFrame:fn=>{const id=++sequence;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)
});
const source=fs.readFileSync(`${__dirname}/app.js`,'utf8');
vm.runInContext(source.slice(source.indexOf('// Reflect the lifted')),context);
const read=code=>vm.runInContext(code,context);
function event(id,type,x,y=780){elements[id].events[type]({isPrimary:true,button:0,pointerId:1,clientX:x,clientY:y,preventDefault(){}});}
function hold(){for(const [id,fn] of [...timers]){timers.delete(id);fn();}}
function settle(){for(let i=0;frames.size&&i<10;i++){clock+=100;for(const [id,fn] of [...frames]){frames.delete(id);fn(clock);}}assert.equal(read('pageTurn'),null);}
function month(){return read('shown.getMonth()');}
// Hold and drag next, then drag previous without waiting for the hold timer.
event('turnNext','pointerdown',985);hold();event('turnNext','pointermove',650,650);event('turnNext','pointerup',650,650);settle();assert.equal(month(),11);
event('turnPrevious','pointerdown',15);event('turnPrevious','pointermove',350,650);event('turnPrevious','pointerup',350,650);settle();assert.equal(month(),10);
// Insufficient drag, a tap, cancellation, lost capture and Escape must not change month.
event('turnNext','pointerdown',985);hold();event('turnNext','pointermove',920);event('turnNext','pointerup',920);settle();assert.equal(month(),10);
event('turnNext','pointerdown',985);event('turnNext','pointerup',985);settle();assert.equal(month(),10);
for(const type of ['pointercancel','lostpointercapture']){event('turnNext','pointerdown',985);hold();event('turnNext','pointermove',600,600);event('turnNext',type,600,600);settle();assert.equal(month(),10);}
event('turnNext','pointerdown',985);hold();event('turnNext','pointermove',500,500);read('finishPaper(false)');settle();assert.equal(month(),10);
// Crossing a year boundary still changes exactly one month.
read('shown = new Date(2026,11,1)');
event('turnNext','pointerdown',985);hold();event('turnNext','pointermove',400,600);event('turnNext','pointerup',400,600);settle();assert.equal(month(),0);assert.equal(read('shown.getFullYear()'),2027);
// Rapid secondary gestures cannot replace an active turn.
event('turnNext','pointerdown',985);const active=read('pageTurn');event('turnPrevious','pointerdown',15);assert.equal(read('pageTurn'),active);event('turnNext','pointercancel',985);settle();
assert.equal(timers.size,0);assert.equal(frames.size,0);
console.log('PASS: held/quick drag, both directions, short-drag rollback, tap, pointer cancellation, lost capture, explicit cancellation, year boundary, duplicate gestures, timer/frame cleanup.');
