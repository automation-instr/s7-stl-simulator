// OV/OS/CC0/CC1/UO status bits: STEP 7 semantics pinned.
import { compile, Machine, Ctx } from '../src/engine';

let fails = 0;
const chk = (name: string, cond: boolean, extra?: any) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' ' + JSON.stringify(extra))); };

interface Snap { OV: boolean; OS: boolean; UO: boolean; CC0: boolean; CC1: boolean }
// status flags at block end are captured BEFORE endScan clears OV/OS
function run(src: string, steps = 200): { m: Machine; f: Snap } {
  const ctx: Ctx = { symbols: {}, dbs: {}, mnem: 'en' };
  const { prog, errors } = compile(src, ctx);
  if (errors.length) throw new Error('compile: ' + JSON.stringify(errors));
  const m = new Machine();
  m.load(prog);
  let f: Snap = { OV: false, OS: false, UO: false, CC0: false, CC1: false };
  const orig = m.endScan.bind(m);
  m.endScan = () => { f = { OV: m.OV, OS: m.OS, UO: m.UO, CC0: m.CC0, CC1: m.CC1 }; orig(); };
  for (let i = 0; i < steps && m.step(); i++);
  return { m, f };
}
const mw = (m: Machine, b: number) => (m.M[b] << 8) | m.M[b + 1];

// +I overflow sets OV and OS
let { m, f } = run('L 32000\nL 1000\n+I\nT MW0');
chk('+I overflow OV', f.OV === true && f.OS === true, f);
chk('+I stored wraps', mw(m, 0) === (33000 & 0xffff), mw(m, 0));

// no overflow: OV clears, OS stays latched until JOS or block end
({ m, f } = run('L 32000\nL 1000\n+I\nL 1\nL 1\n+I\nT MW0'));
chk('good math clears OV not OS', f.OV === false && f.OS === true, f);

// JO jumps on OV
({ m, f } = run('L 32000\nL 1000\n+I\nJO OV1\nL 0\nT MW0\nJU END\nOV1: L 1\nT MW0\nEND: NOP 0'));
chk('JO taken on OV', mw(m, 0) === 1, mw(m, 0));
({ m, f } = run('L 3\nL 4\n+I\nJO OV1\nL 0\nT MW0\nJU END\nOV1: L 1\nT MW0\nEND: NOP 0'));
chk('JO not taken', mw(m, 0) === 0, mw(m, 0));

// JOS jumps on OS and clears it
({ m, f } = run('L 32000\nL 1000\n+I\nL 1\nL 1\n+I\nJOS OS1\nL 0\nT MW0\nJU END\nOS1: L 1\nT MW0\nEND: NOP 0'));
chk('JOS latched', mw(m, 0) === 1 && f.OS === false, { M: mw(m, 0), OS: f.OS });

// JOS clears OS even when not taken? (S7: JOS resets OS after testing)
({ m, f } = run('L 32000\nL 1000\n+I\nJOS L1\nL1: JOS L2\nL2: L 5\nT MW0'));
chk('JOS clears after first', f.OS === false && mw(m, 0) === 5, { OS: f.OS });

// divide by zero
({ m, f } = run('L 100\nL 0\n/I\nT MD0'));
chk('/I div0 OV+OS', f.OV === true && f.OS === true, f);

// NEGI INT_MIN overflow
({ m, f } = run('L -32768\nNEGI\nT MW0'));
chk('NEGI overflow', f.OV === true, f);

// compares set CC bits: JP after >
({ m, f } = run('L 5\nL 3\n>I\nJP P1\nL 0\nT MW0\nJU END\nP1: L 1\nT MW0\nEND: NOP 0'));
chk('JP after >', mw(m, 0) === 1, mw(m, 0));
// JM after <
({ m, f } = run('L 3\nL 5\n<I\nJM M1\nL 0\nT MW0\nJU END\nM1: L 1\nT MW0\nEND: NOP 0'));
chk('JM after <', mw(m, 0) === 1, mw(m, 0));
// JZ after ==
({ m, f } = run('L 5\nL 5\n-I\nJZ Z1\nL 0\nT MW0\nJU END\nZ1: L 1\nT MW0\nEND: NOP 0'));
chk('JZ after zero result', mw(m, 0) === 1, mw(m, 0));
// JN after nonzero
({ m, f } = run('L 5\nL 3\n-I\nJN N1\nL 0\nT MW0\nJU END\nN1: L 1\nT MW0\nEND: NOP 0'));
chk('JN after nonzero', mw(m, 0) === 1, mw(m, 0));
// JPZ / JMZ
({ m, f } = run('L 5\nL 5\n-I\nJPZ P1\nL 0\nT MW0\nJU END\nP1: L 1\nT MW0\nEND: NOP 0'));
chk('JPZ on zero', mw(m, 0) === 1, mw(m, 0));
({ m, f } = run('L 3\nL 5\n-I\nJMZ M1\nL 0\nT MW0\nJU END\nM1: L 1\nT MW0\nEND: NOP 0'));
chk('JMZ on negative', mw(m, 0) === 1, mw(m, 0));

// real: 0/0 -> UO
({ m, f } = run('L 0.0\nL 0.0\n/R\nT MD0'));
chk('0.0/0.0 UO', f.UO === true && f.OS === true, f);
// real: 1/0 -> OV (Inf), not UO
({ m, f } = run('L 1.0\nL 0.0\n/R\nT MD0'));
chk('1.0/0.0 OV not UO', f.OV === true && f.UO === false, f);
// JUO
({ m, f } = run('L 0.0\nL 0.0\n/R\nJUO U1\nL 0\nT MW0\nJU END\nU1: L 1\nT MW0\nEND: NOP 0'));
chk('JUO taken', mw(m, 0) === 1, mw(m, 0));
// SQRT of negative -> NaN -> UO
({ m, f } = run('L -1.0\nSQRT\nT MD0'));
chk('SQRT(-1) UO', f.UO === true, f);

// CC bits after plain compare reflect relation (CC1=1 for p>q)
({ m, f } = run('L 5\nL 3\n>I\nNOP 0'));
chk('compare CC bits p>q', f.CC1 === true && f.CC0 === false && f.OV === false, f);

// OS and OV clear at scan end (block end)
({ m, f } = run('L 32000\nL 1000\n+I\nT MW0', 400)); // run past end, into next scan
chk('OV/OS clear at block end', m.OV === false && m.OS === false, { OV: m.OV, OS: m.OS });

process.exit(fails ? 1 : 0);
