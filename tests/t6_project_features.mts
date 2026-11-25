import { compile, Machine } from './engine.mts';
let fails=0; const ok=(c:boolean,m:string)=>{ if(!c){fails++;} console.log((c?'PASS ':'FAIL ')+m); };
function run(src:string, ctx:any={}) { const r=compile(src,ctx); if(r.errors.length){console.log('ERR',r.errors.slice(0,3));} const m=new Machine(); m.load(r.prog); return {m,r}; }
const scan=(m:Machine,n=1)=>{for(let i=0;i<n;i++){m.advance(10);m.runScan();}};
// English timers
const tim=(op:string)=>`A I0.0\nL S5T#2S\n${op} T1\nA T1\n= Q0.0\n`;
for (const [op,name] of [['SD','on-delay'],['SP','pulse'],['SE','ext pulse'],['SF','off-delay']] as const) {
  const {m,r}=run(tim(op)+'JU _X\n_X: NOP 0',{mnem:'en'});
  const q=()=>m.Q[0]&1; const res:string[]=[];
  m.I[0]=0; scan(m); res.push('idle='+q());
  m.I[0]=1; scan(m); res.push('start='+q()); m.advance(1000); scan(m); res.push('1s='+q()); m.advance(1500); scan(m); res.push('2.5s='+q());
  m.I[0]=0; scan(m); res.push('release='+q()); m.advance(3000); scan(m); res.push('after3s='+q());
  console.log(op,name,res.join(' '));
  const exp:any={SD:'idle=0 start=0 1s=0 2.5s=1 release=0 after3s=0',SP:'idle=0 start=1 1s=1 2.5s=0 release=0 after3s=0',SE:'idle=0 start=1 1s=1 2.5s=0 release=0 after3s=0',SF:'idle=0 start=1 1s=1 2.5s=1 release=1 after3s=0'};
  ok(res.join(' ')===exp[op], op+' '+name);
}
// SE extended pulse keeps running after release; SP stops at release
{ const mk=(op:string)=>{const {m}=run(tim(op),{mnem:'en'}); m.I[0]=1; scan(m); m.I[0]=0; m.advance(500); scan(m); return m.Q[0]&1;}; ok(mk('SE')===1 && mk('SP')===0,'SE(en)=extended pulse holds after release, SP(en) stops'); }
// German: SE=on-delay
{ const {m}=run(tim('SE'),{mnem:'de'}); m.I[0]=1; scan(m); const a=m.Q[0]&1; m.advance(2500); scan(m); ok(a===0&&(m.Q[0]&1)===1,'SE(de)=on-delay'); }
// auto detect
ok(compile('A I0.0\nL S5T#1S\nSD T1\n').mnem==='en','auto en by SD'); ok(compile('U E0.0\nSPA M001\nM001: NOP 0').mnem==='de','auto de');
// JNB / BR / BLD
{ const {m}=run('A I0.0\nJNB _001\nL 5\nT MW10\n_001: NOP 0\nBLD 103\nA I0.1\n= Q0.0'); scan(m); ok(m.M[10]===0&&m.M[11]===0,'JNB jumps when RLO=0'); m.I[0]=1; scan(m); ok(m.M[11]===5,'JNB falls through when RLO=1'); m.I[0]=3; scan(m); ok((m.Q[0]&1)===1,'BLD no-op, chain restarts after label'); }
// JNBI/JBI with SAVE
{ const {m}=run('A I0.0\nSAVE\nCLR\nJBI _001\nSET\n= Q0.0\n_001: NOP 0'); m.I[0]=1; scan(m); ok((m.Q[0]&1)===0,'SAVE + JBI jumps when BR=1'); m.I[0]=0; scan(m); ok((m.Q[0]&1)===1,'JBI no jump when BR=0'); }
// temps
{ const {m,r}=run('FUNCTION "X" : VOID\nVAR_TEMP\n a : INT;\n b : BOOL;\n c : DINT;\nEND_VAR\nBEGIN\nNETWORK\nA I0.0\n= #b\nA #b\n= Q0.0\nL 7\nT #a\nL #a\nT MW20\nL L#100000\nT #c\nL #c\nT MD30\nEND_FUNCTION'); ok(r.temps===8,'temp layout 8 bytes'); I0(m); function I0(m:Machine){m.I[0]=1;} scan(m); ok((m.Q[0]&1)===1&&m.M[21]===7&&((m.M[30]<<24)|(m.M[31]<<16)|(m.M[32]<<8)|m.M[33])===100000,'#temps (BOOL/INT/DINT) work'); }
// L area explicit + local cleared per scan
{ const {m}=run('A I0.0\n= L 12.0\nA L 12.0\n= Q0.0'); m.I[0]=1; scan(m); ok((m.Q[0]&1)===1,'L 12.0 bit local'); }
// big ranges
{ const {m,r}=run('A I902.3\n= M1802.1\nL PIW140\nT MW1800\nL 9\nT PQW20\nOPN DB2680\nSET\n= DBX0.0',{dbs:{2680:{size:16,fields:{}}}}); m.PI[140]=0; m.PI[141]=42; m.I[902]=8; scan(m); ok(r.errors.length===0&&(m.M[1802]&2)===2&&m.M[1801]===42&&m.PQ[21]===9,'big I/M addresses + PIW/PQW + DB2680'); }
// symbols, db fields, skipped calls
{ const symbols:any={START:'I 0.0',LAMP:'Q 0.0',DATA:'DB 5',TMR:'T 3',CNT:'MW 100'}; const dbs={5:{size:6,fields:{RUN:{off:2,bit:3,type:'BOOL'},SP:{off:4,type:'INT'}}}};
  const {m,r}=run('A "START"\nCALL "FOO" (\n  X := "LAMP",// c\n  Y := 5);\nA "START"\n= "DATA".RUN\nA "DATA".RUN\n= "LAMP"\nL 5\nT "CNT"\nL "CNT"\nT "DATA".SP',{symbols,dbs}); m.I[0]=1; scan(m);
  ok(r.errors.length===0&&r.skipped.length===1&&r.skipped[0].callee==='FOO','CALL skipped, reported'); ok((m.Q[0]&1)===1&&m.M[101]===5&&m.dbArr(5)[5]===5,'symbols + DB field by name'); ok(m.dbArr(5)[2]===8,'DB field bit at DBX2.3'); }
// virtual DB fields
{ const symbols:any={W:'DB 10',L:'Q 0.0'}; const {m,r}=run('A "W".OK\n= "L"\nL "W".VAL_REAL\nL 2.0\n*R\nT "W".OUT_REAL\nL 3\nT "W".CNT',{symbols}); ok(r.errors.length===0&&r.virtual.length===4&&r.virtual.find(v=>v.name==='VAL_REAL')!.type==='REAL'&&r.virtual.find(v=>v.name==='CNT')!.type==='INT','virtual DB fields typed from usage'); }
console.log(fails?'FAILS '+fails:'ALL PASS');
