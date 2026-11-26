// Indirect addressing: AR1/AR2 pointer model, register- and memory-indirect operands.
import { compile, Machine, Ctx } from '../src/engine';

let fails = 0;
const chk = (name: string, cond: boolean, extra?: any) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' ' + JSON.stringify(extra))); };

function run(src: string, steps = 400): Machine {
  const ctx: Ctx = { symbols: {}, dbs: {}, mnem: 'en' };
  const { prog, errors } = compile(src, ctx);
  if (errors.length) throw new Error('compile: ' + JSON.stringify(errors));
  const m = new Machine();
  m.load(prog);
  for (let i = 0; i < steps && m.step(); i++);
  return m;
}
const mw = (m: Machine, b: number) => (m.M[b] << 8) | m.M[b + 1];

// LAR1 with pointer constant + register-indirect word load
let m = run('L W#16#1234\nT MW 4\nLAR1 P#4.0\nL MW [AR1,P#0.0]\nT MW 0');
chk('LAR1 P#4.0 reads MW4', mw(m, 0) === 0x1234, mw(m, 0));

// +AR1 pointer constant advances the pointer (raw bit-unit add: P#2.0 = 16)
m = run('L B#16#AB\nT MB 6\nLAR1 P#4.0\n+AR1 P#2.0\nL MB [AR1,P#0.0]\nT MB 0');
chk('+AR1 P#2.0 moves to MB6', m.M[0] === 0xAB, m.M[0]);

// +AR1 with ACCU1-L (L 8 = P#1.0)
m = run('L B#16#5A\nT MB 5\nLAR1 P#4.0\nL 8\n+AR1\nL MB [AR1,P#0.0]\nT MB 0');
chk('+AR1 accu1-L=8 moves to MB5', m.M[0] === 0x5A, m.M[0]);

// register-indirect bit ops: A I [AR1,P#0.1]
m = run('SET\n= M 10.3\nLAR1 P#10.2\nA M [AR1,P#0.1]\n= M 0.0');
chk('A M [AR1,P#0.1] hits M10.3', m.M[0] === 1, m.M[0]);

// area-crossing pointer: L P#M 20.0 / LAR1 / T [AR1,P#2.0] writes MB22
m = run('L P#M 20.0\nLAR1\nL B#16#77\nT MB [AR1,P#2.0]');
chk('area-crossing P#M 20.0 + P#2.0 writes MB22', m.M[22] === 0x77, m.M[22]);

// TAR1 to memory and LAR1 from memory round-trip
m = run('LAR1 P#12.0\nTAR1 MD 20\nLAR1 P#0.0\nLAR1 MD 20\nL P#12.0\nL MD 20\n==D\n= M 0.0');
chk('TAR1/LAR1 MD round-trip', m.M[0] === 1, m.M[0]);

// LAR1 AR2 copies AR2; CAR swaps
m = run('LAR2 P#8.0\nLAR1 AR2\nTAR1 MD 0\nL P#8.0\nL MD 0\n==D\n= M 4.0\nLAR1 P#1.0\nLAR2 P#2.0\nCAR\nTAR1 MD 40\nTAR2 MD 44\nL MD 40\nL P#2.0\n==D\n= M 4.1\nL MD 44\nL P#1.0\n==D\n= M 4.2');
chk('LAR1 AR2 copy', (m.M[4] & 1) === 1, m.M[4]);
chk('CAR swaps AR1/AR2', (m.M[4] & 6) === 6, m.M[4]);

// memory-indirect: L MW [MD 30] where MD30 = P#40.0
m = run('L P#40.0\nT MD 30\nL W#16#BEEF\nT MW 40\nL MW [MD 30]\nT MW 0');
chk('L MW [MD 30] reads MW40', mw(m, 0) === 0xBEEF, mw(m, 0).toString(16));

// memory-indirect bit: A M [MD 30] with P#40.5
m = run('L P#40.5\nT MD 30\nSET\n= M 40.5\nA M [MD 30]\n= M 0.0');
chk('A M [MD 30] hits M40.5', m.M[0] === 1, m.M[0]);

// DB-indirect: OPN DB [MW 50], then DBX access
m = run('L 1\nT MW 50\nOPN DB [MW 50]\nL B#16#11\nT DBB 0\nL DBB 0\nT MB 0');
chk('OPN DB [MW 50] opens DB1', m.M[0] === 0x11, m.M[0]);

// register-indirect DB access: T DBW [AR1,P#0.0]
m = run('OPN DB 1\nLAR1 P#2.0\nL W#16#4321\nT DBW [AR1,P#0.0]\nL DBW 2\nT MW 0');
chk('T DBW [AR1,P#0.0] writes DB1.DBW2', mw(m, 0) === 0x4321, mw(m, 0).toString(16));

// area-crossing DIX pointer uses the DI register
m = run('OPN DI 2\nL P#DIX 0.0\nLAR1\nL B#16#99\nT B [AR1,P#1.0]\nL DIB 1\nT MB 0');
chk('DIX pointer writes open DI', m.M[0] === 0x99, m.M[0]);

// LAR2/TAR2 work like AR1
m = run('LAR2 P#6.0\nTAR2 MD 20\nL MD 20\nL P#6.0\n==D\n= M 0.0');
chk('LAR2/TAR2', m.M[0] === 1, m.M[0]);

// compile errors are caught
const ctx: Ctx = { symbols: {}, dbs: {}, mnem: 'en' };
const bad1 = compile('L IB [AR3,P#0.0]', ctx);
chk('bad register rejected', bad1.errors.length > 0);
const bad2 = compile('A M [AR1,P#0.8]', ctx);
chk('bad bit rejected', bad2.errors.length > 0);
const bad3 = compile('LAR1 MW 0', ctx);
chk('LAR1 needs a double word', bad3.errors.length > 0);
const bad4 = compile('L MW [MW 30]', ctx);
chk('memory-indirect needs D pointer', bad4.errors.length > 0);

console.log(fails ? 'FAILURES: ' + fails : 'ALL PASS');
process.exit(fails ? 1 : 0);
