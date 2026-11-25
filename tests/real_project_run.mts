import { readFileSync, readdirSync } from 'node:fs';
import { compile, splitBlocks, dbLayouts, parseSymList, Machine } from './engine.mts';
const root='/tmp/plc/MORE PLC/'; const dec=(b:Buffer)=>{ try{return new TextDecoder('utf-8',{fatal:true}).decode(b);}catch{return new TextDecoder('windows-1252').decode(b);} };
const dir=root+'s7asrcom/00000001/'; let blocks:any[]=[]; for (const f of readdirSync(dir).filter(f=>/\.AWL$/i.test(f))) blocks.push(...splitBlocks(dec(readFileSync(dir+f))));
const {dbs}=dbLayouts(blocks); const symbols=parseSymList(new Uint8Array(readFileSync(root+'YDBs/30927/SYMLIST.DBF')));
const mnem='en';
for (const b of blocks.filter(b=>b.kind=='FUNCTION')) {
  const r=compile(b.text,{symbols,dbs,mnem}); const m=new Machine(); m.load(r.prog);
  m.M[10]|=2; // "ON" M10.1 always on
  const snap=()=>[...m.M].reduce((a,x)=>a+x.toString(2).replace(/0/g,'').length,0)+[...m.Q].reduce((a,x)=>a+x.toString(2).replace(/0/g,'').length,0);
  let errs=0, steps=0; const t0=Date.now();
  for (let i=0;i<50;i++){ m.advance(100); if(i%10==0) m.M[14]|=0x20; else m.M[14]&=~0x20; m.runScan(100000); if(m.error){errs++; if(errs==1) console.log('  runtime error:',m.error); m.error='';} }
  console.log(b.name,'scans',m.scans,'ins',r.prog.ins.length,'errors',errs,'bits set M+Q',snap(),'ms',Date.now()-t0, 'timers',Object.keys(m.timers).length);
}
