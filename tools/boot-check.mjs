// Boot-check: minimal DOM shim, run bootScroller, capture throw.
import { readFileSync } from 'node:fs';
const html = readFileSync('index.html', 'utf8');
const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
const nodes = new Map();
class N {
  constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.dataset = {}; this.hidden = false; this.attrs = {}; this._cls=''; }
  set className(v) { this._cls = v; } get className() { return this._cls; }
  get classList() { const s=this; return { add:c=>{s._cls=(s._cls+' '+c).trim()}, remove:()=>{}, contains:c=>(s._cls||'').includes(c) }; }
  set textContent(v) { this._t = String(v); this.children=[]; } get textContent() { return this._t||''; }
  append(...ns) { this.children.push(...ns); }
  replaceChildren(...ns) { this.children = [...ns]; }
  addEventListener() {} removeEventListener() {}
  setAttribute(k,v) { this.attrs[k]=v; } getAttribute(k) { return this.attrs[k]; }
  getBoundingClientRect() { return { x:0,y:0,width:1280,height:720,top:0,left:0,bottom:720,right:1280 }; }
  focus() {} click() {} remove() {}
  get isConnected() { return true; }
  getContext() { return null; } // real ctx absent — boot must tolerate
}
function mkNode(id){ const n=new N('div'); n.id=id; return n; }
for (const id of ids) nodes.set('#'+id, mkNode(id));
globalThis.document = {
  getElementById: (id) => nodes.get('#'+id) || new N('div'),
  querySelector: (sel) => nodes.get(sel) || new N('div'),
  querySelectorAll: () => [],
  createElement: (tag) => new N(tag),
  addEventListener: () => {}, removeEventListener: () => {},
  documentElement: { dataset: {} },
  body: new N('body'),
  hidden: false,
};
globalThis.window = { devicePixelRatio: 1, addEventListener(){}, requestAnimationFrame: ()=>0, location: { href: 'x' } };
globalThis.requestAnimationFrame = () => 0;
// seeded save: exercises the load-toast TDZ path
const __save = JSON.stringify({ era: 2, walkX: 500, lastBoundaryEra: 2 });
globalThis.localStorage = { getItem:(k)=> k==='long-ascent-save-v1' ? __save : null, setItem:()=>{}, removeItem:()=>{} }; // seeded save: exercises load-toast
globalThis.matchMedia = () => ({ matches:false });
globalThis.performance = { now: ()=>0 };
globalThis.Image = class { set src(v){ this._s=v; } get src(){return this._s;} };
try {
  const { bootScroller } = await import('../src/ui/scroller-boot.js');
  const eras = JSON.parse(readFileSync('src/data/eras.json','utf8'));
  const enc = JSON.parse(readFileSync('research/encounters-v6.json','utf8'));
  const bs = JSON.parse(readFileSync('research/boundary-stones-v6.json','utf8'));
  const arcs = JSON.parse(readFileSync('research/arc-encounters-v6.json','utf8'));
  bootScroller({
  erasData: eras,
  content: { encounters: enc.encounters ?? enc, stones: bs.stones ?? bs, arcs: arcs.arc_encounters ?? arcs },
  canvas: nodes.get('#world-canvas'), hudRoot: nodes.get('#resource-bar'),
  promptRoot: nodes.get('#world-prompt'), menuRoot: nodes.get('#world-menu'), toastRoot: nodes.get('#toast'),
});
  console.log('BOOT OK');
  console.log('hud kids:', nodes.get('#resource-bar').children.length, '| text:', nodes.get('#resource-bar').textContent.slice(0,80));
} catch (e) {
  console.log('BOOT THREW:', e.message);
  console.log(e.stack.split('\n').slice(0,4).join('\n'));
}
