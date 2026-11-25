import { parseBlockView } from '/tmp/pwa/src/blockview.ts';
import { splitBlocks } from '/tmp/an/engine.mts';
import fs from 'node:fs';
const dir='/tmp/plc/MORE PLC/s7asrcom/00000001/';
const fl=fs.readdirSync(dir).filter(f=>/\.AWL$/i.test(f));
let tot=0;
for (const f of fl){ for(const b of splitBlocks(fs.readFileSync(dir+f,'latin1'))){ const v=parseBlockView(b.text); tot++;
 if(b.kind!=='DATA_BLOCK'||tot<4) console.log(b.kind,b.name,'title=',v.title.slice(0,30),'| meta',v.meta.length,'secs',v.sections.map(s=>s.sec+':'+s.vars.length).join(','),'struct',v.struct.length,'nets',v.nets.length,'code',v.nets.reduce((a,n)=>a+n.code.length,0),'netcomments',v.nets.filter(n=>n.comment.length).length,'cm',v.comments);
 }}
const b=splitBlocks(fs.readFileSync(dir+'00000023.AWL','latin1'))[0]; const v=parseBlockView(b.text);
console.log(JSON.stringify(v.nets[0],null,1).slice(0,900)); console.log(JSON.stringify(v.sections).slice(0,400), v.meta);
