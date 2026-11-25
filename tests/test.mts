import { compile, Machine } from './engine.mts';
let fails = 0;
const ok = (c: boolean, m: string) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
function mk(src: string) { const r = compile(src); if (r.errors.length) console.log(r.errors); const m = new Machine(); m.load(r.prog); return m; }
const setI = (m: Machine, b: number, bit: number, v: boolean) => { if (v) m.I[b] |= 1 << bit; else m.I[b] &= ~(1 << bit); };
const q = (m: Machine, b = 0, bit = 0) => (m.Q[b] >> bit) & 1;
// seal-in
let m = mk(`A(\nO I0.0\nO Q0.0\n)\nAN I0.1\n= Q0.0`);
m.runScan(); ok(q(m) === 0, 'seal idle off');
setI(m,0,0,true); m.runScan(); ok(q(m)===1,'seal on with start');
setI(m,0,0,false); m.runScan(); ok(q(m)===1,'seal holds');
setI(m,0,1,true); m.runScan(); ok(q(m)===0,'stop drops');
setI(m,0,1,false); m.runScan(); ok(q(m)===0,'stays off');
// AND before OR
m = mk(`A I0.0\nA I0.1\nO I0.2\nA I0.3\n= Q0.0`); // I0.0&I0.1 | I0.2&I0.3
for (let v=0; v<16; v++){ for(let i=0;i<4;i++) setI(m,0,i,!!(v>>i&1)); m.runScan();
  const e=((v&1)&&(v>>1&1))||((v>>2&1)&&(v>>3&1)); if (q(m)!==(e?1:0)) ok(false,'AND-before-OR v='+v); }
ok(true,'AND before OR 16 combos');
m = mk(`A I0.0\nA I0.1\nO\nA I0.2\nA I0.3\n= Q0.0`);
for (let v=0; v<16; v++){ for(let i=0;i<4;i++) setI(m,0,i,!!(v>>i&1)); m.runScan();
  const e=((v&1)&&(v>>1&1))||((v>>2&1)&&(v>>3&1)); if (q(m)!==(e?1:0)) ok(false,'standalone O v='+v); }
ok(true,'standalone O 16 combos');
// (a|b)&(c|d)
m = mk(`O( \nA I0.0\nO I0.1\n)\n`.replace('O( ','A(')+`O I0.0\nO I0.1\n)\nA(\nO I0.2\nO I0.3\n)\n= Q0.0`);
console.log(compile(`A(\nO I0.0\nO I0.1\n)\nA(\nO I0.2\nO I0.3\n)\n= Q0.0`).errors);
m = mk(`A(\nO I0.0\nO I0.1\n)\nA(\nO I0.2\nO I0.3\n)\n= Q0.0`);
let bad=0; for (let v=0; v<16; v++){ for(let i=0;i<4;i++) setI(m,0,i,!!(v>>i&1)); m.runScan();
  const e=((v&1)||(v>>1&1))&&((v>>2&1)||(v>>3&1)); if (q(m)!==(e?1:0)) bad++; } ok(bad===0,'(a|b)&(c|d)');
// multiple = share RLO
m = mk(`A I0.0\n= Q0.0\n= Q0.1\nA I0.1\n= Q0.2`);
setI(m,0,0,true); m.runScan(); ok(q(m,0,0)===1&&q(m,0,1)===1&&q(m,0,2)===0,'multi = shares RLO, new chain after');
// S/R
m = mk(`A I0.0\nS Q0.0\nA I0.1\nR Q0.0`);
setI(m,0,0,true); m.runScan(); setI(m,0,0,false); m.runScan(); ok(q(m)===1,'S latch');
setI(m,0,1,true); m.runScan(); ok(q(m)===0,'R unlatch');
// L/T/compare
m = mk(`L 5\nT MW10\nL MW10\nL 3\n>I\n= Q0.0\nL MW10\nL 5\n==I\n= Q0.1\nL 3\nL MW10\n>I\n= Q0.2`);
m.runScan(); ok(m.M[10]===0&&m.M[11]===5,'MW10 big-endian 5'); ok(q(m,0,0)===1&&q(m,0,1)===1&&q(m,0,2)===0,'compare >I (ACCU2>ACCU1), ==I');
// compare combined with A
m = mk(`L 10\nL 5\n>I\nA I0.0\n= Q0.0`); m.runScan(); ok(q(m)===0,'cmp AND I0.0 (false)'); setI(m,0,0,true); m.runScan(); ok(q(m)===1,'cmp AND I0.0 (true)');
// jumps
m = mk(`A I0.0\nSPBN M001\nL 50\nT MW10\nSPA M002\nM001: L 10\nT MW10\nM002: NOP 0`);
m.runScan(); ok(m.M[11]===10,'SPBN taken'); setI(m,0,0,true); m.runScan(); ok(m.M[11]===50,'SPB not taken');
// SE timer
m = mk(`A I0.0\nL S5T#2S\nSE T1\nA T1\n= Q0.0\nA I0.1\nR T1`);
setI(m,0,0,true); m.runScan(); ok(q(m)===0,'SE not yet'); m.advance(1000); m.runScan(); ok(q(m)===0 && Math.abs(m.timers[1].rem-1000)<1,'SE 1s left');
m.advance(1000); m.runScan(); ok(q(m)===1,'SE done after 2s'); setI(m,0,0,false); m.runScan(); ok(q(m)===0,'SE drops with input');
setI(m,0,0,true); m.runScan(); m.advance(2500); m.runScan(); ok(q(m)===1,'SE again'); setI(m,0,1,true); m.runScan(); m.runScan(); ok(q(m)===0,'R T1 resets');
// SI
m = mk(`A I0.0\nL S5T#2S\nSI T1\nA T1\n= Q0.0`);
setI(m,0,0,true); m.runScan(); ok(q(m)===1,'SI on immediately'); m.advance(2100); m.runScan(); ok(q(m)===0,'SI ends after 2s while input 1');
// SS
m = mk(`A I0.0\nL S5T#2S\nSS T1\nA T1\n= Q0.0\nA I0.1\nR T1`);
setI(m,0,0,true); m.runScan(); setI(m,0,0,false); m.runScan(); m.advance(2100); m.runScan(); ok(q(m)===1,'SS runs after input drop'); setI(m,0,1,true); m.runScan(); m.runScan(); ok(q(m)===0,'SS R');
// SA
m = mk(`A I0.0\nL S5T#2S\nSA T1\nA T1\n= Q0.0`);
setI(m,0,0,true); m.runScan(); ok(q(m)===1,'SA on'); setI(m,0,0,false); m.runScan(); ok(q(m)===1,'SA holds'); m.advance(2100); m.runScan(); ok(q(m)===0,'SA off after delay');
// SV
m = mk(`A I0.0\nL S5T#2S\nSV T1\nA T1\n= Q0.0`);
setI(m,0,0,true); m.runScan(); setI(m,0,0,false); m.runScan(); ok(q(m)===1,'SV stays'); m.advance(2100); m.runScan(); ok(q(m)===0,'SV ends');
// blinker
m = mk(`A I0.0\nAN T2\nL S5T#1S\nSE T1\nA T1\nL S5T#1S\nSE T2\nA T1\n= Q0.0`);
setI(m,0,0,true); const seq:number[]=[]; for(let t=0;t<60;t++){ m.runScan(); seq.push(q(m)); m.advance(100);} console.log(seq.join(''));
// counter
m = mk(`A I0.0\nZV C1\nA I0.1\nZR C1\nA I0.2\nL C#5\nS C1\nA I0.3\nR C1\nA C1\n= Q0.0\nL C1\nL 3\n>=I\n= Q0.1`);
const pulse=(b:number)=>{setI(m,0,b,true);m.runScan();setI(m,0,b,false);m.runScan();};
pulse(0);pulse(0); ok(m.counters[1].val===2&&q(m,0,0)===1&&q(m,0,1)===0,'CU x2'); pulse(0); ok(m.counters[1].val===3&&q(m,0,1)===1,'>=3');
setI(m,0,0,true); m.runScan(); m.runScan(); m.runScan(); ok(m.counters[1].val===4,'CU edge only');
setI(m,0,0,false); pulse(1); ok(m.counters[1].val===3,'CD'); pulse(2); ok(m.counters[1].val===5,'S preset 5'); pulse(3); ok(m.counters[1].val===0&&q(m)===0,'R');
// errors
console.log(compile(`A I0.9\nXYZ\nSPB NOPE\nA(\nL S5T#9\nAN\nTOOLONGLBL: A I0.0\n= Q`).errors.map(e=>e.line+': '+e.msg));
// FP
m = mk(`A I0.0\nFP M10.0\n= Q0.0`); setI(m,0,0,true); m.runScan(); ok(q(m)===1,'FP pulse'); m.runScan(); ok(q(m)===0,'FP one scan');
// arithmetic
m = mk(`L 7\nL 3\n-I\nT MW0\nL 6\nL 4\n/I\nT MW2`); m.runScan(); ok(m.M[1]===4,'7... acc2-acc1: 7-3=4'); ok(m.M[3]===1,'6/4=1');
console.log(fails?'FAILS '+fails:'ALL PASS');
