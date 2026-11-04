import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {transformSync} from 'esbuild';

const code=transformSync(fs.readFileSync(new URL('../SeasonSwitcher.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs'}).code;
const tick=()=>new Promise(resolve=>setImmediate(resolve));

const SEASONS=[
 {series_id:'8001',series_title:'谁让这个悍匪修仙的！',label:'第一季',is_current:false},
 {series_id:'8002',series_title:'谁让这个悍匪修仙的！第二季',label:'第二季',is_current:false},
 {series_id:'7001',series_title:'谁让这个悍匪修仙的！第五季',label:'第五季',is_current:true},
];

function harness(api,{seriesId='7001',onPick=()=>{}}={}){
 let cursor=0,tree;const slots=[],effects=[];
 const react={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),
  useState(initial){const at=cursor++;if(!(at in slots))slots[at]=initial;return[slots[at],value=>slots[at]=value];},
  useRef(initial){const at=cursor++;return slots[at]||={current:initial};},
  useEffect(effect,deps){const at=cursor++,previous=slots[at];if(!previous||deps.some((value,index)=>value!==previous.deps[index])){previous?.cleanup?.();slots[at]={deps};effects.push(()=>slots[at].cleanup=effect());}},
  useCallback:fn=>fn,useMemo:fn=>fn};
 const module={exports:{}};
 const require=id=>id==='react'?react:id==='./SeasonSwitcher.css'?{}:undefined;
 vm.runInNewContext(code,{module,exports:module.exports,require,window:{electronAPI:api},setTimeout,clearTimeout});
 const render=(props)=>{cursor=0;tree=module.exports.default({seriesId,onPick,...props});while(effects.length)effects.shift()();};
 const find=(predicate,root=tree)=>{let match;const visit=node=>{if(!node||typeof node!=='object'||match)return;if(predicate(node))match=node;(node.children||[]).forEach(visit);};visit(root);return match;};
 const chips=()=>{const group=find(node=>node.props?.className==='season-switcher');return group?group.children.filter(node=>node.type==='button'):[];};
 return{render,find,chips};
}

test('多季时渲染同系列行：当前季禁用、点击上报所选季',async()=>{
 const picks=[];let requested='';
 const api={findSeriesSeasons:async id=>{requested=id;return{success:true,seasons:SEASONS};}};
 const ui=harness(api,{seriesId:'7001',onPick:season=>picks.push(season)});
 ui.render();
 assert.equal(requested,'7001');
 await tick();ui.render();
 const group=ui.find(node=>node.props?.className==='season-switcher');
 assert.ok(group,'应渲染 season-switcher');
 assert.equal(group.props['aria-label'],'同系列各季');
 assert.deepEqual(ui.chips().map(chip=>chip.children[0]),['第一季','第二季','第五季']);
 assert.deepEqual(ui.chips().map(chip=>chip.props.disabled),[false,false,true]);
 ui.chips()[0].props.onClick();
 assert.deepEqual(picks,[SEASONS[0]]);
});

test('只有本季或查询失败时整体隐藏',async()=>{
 const onlyCurrent={success:true,seasons:[SEASONS[2]]};
 const cases=[
  ['only-current',{findSeriesSeasons:async()=>onlyCurrent}],
  ['failing',{findSeriesSeasons:async()=>{throw new Error('网络不可用');}}],
  ['error-payload',{findSeriesSeasons:async()=>({success:false,seasons:[],error:'剧名无法识别'})}],
 ];
 for(const [name,api] of cases){
  const ui=harness(api,{seriesId:'7001',onPick:()=>{}});
  ui.render();await tick();ui.render();
  assert.ok(!ui.find(node=>node.props?.className==='season-switcher'),name);
 }
});

test('切换剧后旧查询的迟到响应不再上屏',async()=>{
 let resolveA;const gateA=new Promise(resolve=>{resolveA=resolve;});
 const seasonsB=[
  {series_id:'B1',series_title:'乙第一季',label:'第一季',is_current:false},
  {series_id:'B',series_title:'乙第二季',label:'第二季',is_current:true},
 ];
 const api={findSeriesSeasons:async id=>id==='A'?gateA:Promise.resolve({success:true,seasons:seasonsB})};
 const ui=harness(api,{seriesId:'A',onPick:()=>{}});
 ui.render({seriesId:'A'});
 ui.render({seriesId:'B'});
 await tick();ui.render({seriesId:'B'});
 assert.deepEqual(ui.chips().map(chip=>chip.children[0]),['第一季','第二季']);
 resolveA();await tick();ui.render({seriesId:'B'});
 assert.deepEqual(ui.chips().map(chip=>chip.children[0]),['第一季','第二季']);
});
