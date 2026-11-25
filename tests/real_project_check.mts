import { readFileSync, readdirSync } from 'node:fs';
import { compile, splitBlocks, dbLayouts, parseSymList, Machine } from './engine.mts';
const root='/tmp/plc/MORE PLC/';
const dec=(b:Buffer)=>{ try{return new TextDecoder('utf-8',{fatal:true}).decode(b);}catch{return new TextDecoder('windows-1252').decode(b);} };
const dir=root+'s7asrcom/00000001/';
let blocks:any[]=[]; for (const f of readdirSync(dir).filter(f=>/\.AWL$/i.test(f))) blocks.push(...splitBlocks(dec(readFileSync(dir+f))).map(b=>({...b,file:f})));
console.log('blocks',blocks.length, blocks.filter(b=>b.kind=='FUNCTION').length,'functions');
const {dbs,warn}=dbLayouts(blocks); console.log('DB layouts',Object.keys(dbs).length,'warn',warn.slice(0,5));
// verify layout vs Spare_Bit_Tag_B_b names
let chk=0,bad=0; for(const n in dbs) for(const [k,f] of Object.entries(dbs[+n].fields)){const m=/^SPARE_BIT_TAG_(\d+)_(\d)$/.exec(k); if(m){chk++; if(+m[1]!==f.off||+m[2]!==f.bit){bad++; if(bad<4)console.log('MISMATCH',n,k,f);}}}
console.log('spare-bit name check',chk,'bad',bad);
for (const n of [200,201,240]) console.log('DB'+n,'size',dbs[n]?.size);
const dbf=readFileSync(root+'YDBs/30927/SYMLIST.DBF'); const symbols=parseSymList(new Uint8Array(dbf)); console.log('symbols',Object.keys(symbols).length);
for (const b of blocks.filter(b=>b.kind=='FUNCTION')) {
  const r=compile(b.text,{symbols,dbs});
  const g:Record<string,number>={}; r.errors.forEach(e=>{const k=e.msg.replace(/"[^"]*"/g,'"…"').replace(/#\w+/g,'#…').slice(0,70); g[k]=(g[k]||0)+1;});
  console.log(`\n${b.name}: mnem=${r.mnem} ins=${r.prog.ins.length} errors=${r.errors.length} skippedCalls=${r.skipped.length} temps=${r.temps}B`);
  console.log(Object.entries(g).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>'  '+v+'  '+k).join('\n'));
}
{ const b=blocks.find(b=>b.name=='HMI_STATUS'); const r=compile(b.text,{symbols,dbs}); for(const e of r.errors) console.log(e.line, b.text.split('\n')[e.line-1]); }
