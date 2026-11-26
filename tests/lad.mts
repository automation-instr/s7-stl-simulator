import { convertAll } from '../src/lad';
const cases: [string, string, boolean][] = [
  ['simple series', 'NETWORK\nA I0.0\nA I0.1\n= Q0.0', true],
  ['or branches', 'NETWORK\nA I0.0\nO I0.1\nO I0.2\n= Q0.0', true],
  ['bare O', 'NETWORK\nA I0.0\nA I0.1\nO\nA I0.2\nA I0.3\n= Q0.0', true],
  ['paren group', 'NETWORK\nA I0.0\nA(\nO I0.1\nO I0.2\n)\n= Q0.0', true],
  ['multi coil rungs', 'NETWORK\nA I0.0\n= Q0.0\nA I0.1\n= Q0.1', true],
  ['set/reset', 'NETWORK\nA I0.0\nS Q0.0\nA I0.1\nR Q0.0', true],
  ['edge', 'NETWORK\nA I0.0\nFP M0.0\n= Q0.0', true],
  ['timer', 'NETWORK\nA I0.0\nL S5T#2S\nSD T1\nA T1\n= Q0.0', true],
  ['move', 'NETWORK\nL MW10\nT MW12', true],
  ['jump -> fallback', 'NETWORK\nA I0.0\nJCN M001\n= Q0.0\nM001: NOP 0', false],
  ['call -> fallback', 'NETWORK\nCALL FC1', false],
  ['xor -> fallback', 'NETWORK\nX I0.0\n= Q0.0', false],
  ['set instr -> fallback', 'NETWORK\nSET\n= Q0.0', false],
  ['word compare -> fallback', 'NETWORK\nL MW10\nL 5\n==I\n= Q0.0', false],
];
let fails = 0;
for (const [name, src, want] of cases) {
  const nets = convertAll(src);
  const allOk = nets.every(n => n.convertible);
  const got = nets.length > 0 && allOk;
  const pass = got === want;
  if (!pass) fails++;
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (pass ? '' : ' (nets=' + JSON.stringify(nets.map(n => n.note)) + ')'));
}
// structural spot checks
const g = convertAll('NETWORK\nA I0.0\nA(\nO I0.1\nO I0.2\n)\n= Q0.0')[0].rungs[0];
console.log('paren structure:', JSON.stringify(g));
const t = convertAll('NETWORK\nA I0.0\nL S5T#2S\nSD T1\nA T1\n= Q0.0')[0];
console.log('timer rungs:', JSON.stringify(t.rungs));
process.exit(fails ? 1 : 0);
