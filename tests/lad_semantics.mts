import { convertAll } from '../src/lad';
let fails = 0;
const chk = (name: string, cond: boolean, extra?: any) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' ' + JSON.stringify(extra))); };

// RLO semantics: A a / O b / AN c  ==  (a OR b) AND /c
let r = convertAll('NETWORK\nA I0.0\nO I0.1\nAN I0.2\n= Q0.0')[0].rungs[0];
chk('or-then-and', r.chain.length === 2 && r.chain[0].kind === 'or' && (r.chain[0] as any).branches.length === 2 && r.chain[1].kind === 'nc' && (r.chain[1] as any).op === 'I0.2', r);

// O-group first: A( O a; O b ) series with c
r = convertAll('NETWORK\nA(\nO I0.0\nO I0.1\n)\nA I0.2\n= Q0.0')[0].rungs[0];
chk('paren-or-then-and', r.chain.length === 2 && r.chain[0].kind === 'or' && r.chain[1].kind === 'no', r);

// A a; A( O b; O c ); = out  == a AND (b OR c)
r = convertAll('NETWORK\nA I0.0\nA(\nO I0.1\nO I0.2\n)\n= Q0.0')[0].rungs[0];
chk('and-then-paren-or', r.chain.length === 2 && r.chain[0].kind === 'no' && r.chain[1].kind === 'or', r);

// (a OR b) AND (c OR d): A a; O b; A( O c; O d ); =
r = convertAll('NETWORK\nA I0.0\nO I0.1\nA(\nO I0.2\nO I0.3\n)\n= Q0.0')[0].rungs[0];
chk('or-and-or', r.chain.length === 2 && r.chain[0].kind === 'or' && r.chain[1].kind === 'or', r);

// O( parallel group: A a; O( A b; A c ); = out  == a OR (b AND c)
r = convertAll('NETWORK\nA I0.0\nO(\nA I0.1\nA I0.2\n)\n= Q0.0')[0].rungs[0];
chk('or-paren-and', r.chain.length === 1 && r.chain[0].kind === 'or' && (r.chain[0] as any).branches.length === 2 && (r.chain[0] as any).branches[1].length === 2, r);

// bare O: (a AND b) OR (c AND d)
r = convertAll('NETWORK\nA I0.0\nA I0.1\nO\nA I0.2\nA I0.3\n= Q0.0')[0].rungs[0];
chk('bare-o', r.chain.length === 1 && r.chain[0].kind === 'or' && (r.chain[0] as any).branches.every((b: any) => b.length === 2), r);

// three-way O with trailing AND: (a|b|c) AND d
r = convertAll('NETWORK\nA I0.0\nO I0.1\nO I0.2\nA I0.3\n= Q0.0')[0].rungs[0];
chk('or3-then-and', r.chain.length === 2 && (r.chain[0] as any).branches.length === 3 && r.chain[1].kind === 'no', r);

// series inside A( parens flattens: A( A a; A b ) AND c
r = convertAll('NETWORK\nA(\nA I0.0\nA I0.1\n)\nA I0.2\n= Q0.0')[0].rungs[0];
chk('paren-series', r.chain.length === 3 && r.chain.every(e => e.kind === 'no'), r);

// simple series unchanged
r = convertAll('NETWORK\nA I0.0\nAN I0.1\n= Q0.0')[0].rungs[0];
chk('series', r.chain.length === 2 && r.chain[0].kind === 'no' && r.chain[1].kind === 'nc', r);

// timer + MOVE still fine
const nets = convertAll('NETWORK\nA I0.0\nL S5T#2S\nSD T1\nA T1\n= Q0.0\nNETWORK\nL MW10\nT MW12');
chk('timer+move', nets.every(x => x.convertible) && nets[0].rungs.length === 2 && nets[1].rungs[0].out.kind === 'move', nets);

// fallback cases
for (const [name, src] of [['jump','NETWORK\nJCN M1\nM1: NOP 0'],['call','NETWORK\nCALL FC1'],['xor','NETWORK\nX I0.0\n= Q0.0'],['compare','NETWORK\nL MW10\nL 5\n==I\n= Q0.0'],['neg group','NETWORK\nAN(\nO I0.0\nO I0.1\n)\n= Q0.0']] as const) {
  chk('fallback ' + name, !convertAll(src)[0].convertible);
}
process.exit(fails ? 1 : 0);
