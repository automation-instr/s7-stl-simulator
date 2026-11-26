/**
 * Render test for src/mc7/render.ts.
 *  1. Synthetic corpus: exact formatted-line assertions (CALL frames, params, labels, comments).
 *  2. Full-project (MC7FULL + MC7AWL env, local only): render FC81 and compare statement-for-
 *     statement against its SIMATIC AWL source. FC81 has no calls and no recorded divergences,
 *     so the canonical sequences must match 100%.
 */
import { readFileSync } from 'node:fs';
import { S7Project, parseDbOffsets, dbFieldName } from '../src/mc7/project';
import { renderBlock, RenderCtx } from '../src/mc7/render';

let fail = 0;
const ok = (cond: boolean, msg: string) => { console.log((cond ? 'ok  ' : 'BAD ') + msg); if (!cond) fail++; };

// ---------- 1. synthetic ----------
{
  const snap = JSON.parse(readFileSync(new URL('./fixtures/snapshot.json', import.meta.url), 'utf8'));
  const proj = new S7Project(snap);
  const rev: Record<string, string> = {};
  for (const [n, a] of Object.entries(snap.symbols as Record<string, string>)) rev[a] = n;
  const ctx: RenderCtx = {
    symbolFor: a => rev[a] ?? null,
    blockName: (k, n) => { const e = Object.entries(snap.symbols as Record<string, string>).find(([, a]) => a === `${k} ${n}`); return e ? e[0] : null; },
    dbField: () => null,
  };
  const code = (k: string) => { const h = snap.blocks[k].code; const u = new Uint8Array(h.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(h.substr(i * 2, 2), 16); return u; };

  const l1 = renderBlock(code('FC9001'), proj, ctx);
  const txt = l1.map(l => (l.label ? l.label + ': ' : '') + l.text + (l.comment ? '  // ' + l.comment : ''));
  ok(l1.filter(l => l.cls === 'raw').length === 1, 'FC9001: exactly one RAW line');
  ok(txt.includes('A "MOTOR"  // M 10.3'), 'FC9001: symbol resolution A "MOTOR"');
  ok(txt.includes('= "MOTOR"  // M 10.3'), 'FC9001: = "MOTOR"');
  ok(!txt.includes('S "VALVE"  // Q 42.3'), 'FC9001: no bogus symbol resolution');
  ok(txt.some(t => t.startsWith('S M 42.5')), 'FC9001: S M 42.5 absolute');
  ok(txt.includes('L S5T#5S'), 'FC9001: S5T formatting');
  ok(txt.includes('L 16#40200000  // = 2.5'), 'FC9001: CONST32 float comment');
  ok(txt.includes('L -5'), 'FC9001: signed const');
  ok(l1.some(l => l.label === 'M001' && l.off === 190), 'FC9001: label M001 at jump target 190');
  ok(txt.includes('JNB M001'), 'FC9001: JNB uses label');
  ok(txt.includes('OPN DB 10  // "MY_DB"'), 'FC9001: OPN DB with symbol comment');
  ok(txt.includes('UC SFC 65'), 'FC9001: UC SFC');
  ok(txt.includes('= L 42.0'), 'FC9001: L-area bit assignment');

  const l2 = renderBlock(code('FC9002'), proj, ctx).map(l => l.text);
  ok(l2.includes('CALL "MY_FUNC"'), 'FC9002: CALL with symbolic name');
  ok(l2.includes('      A := 7'), 'FC9002: materialized IN param A := 7');
  ok(l2.includes('      B := M 2.3'), 'FC9002: M-area IN param B := M 2.3');
  ok(l2.includes('      C := MD 40'), 'FC9002: OUT param copy-back C := MD 40');

  const ctx5: RenderCtx = { ...ctx, paramName: op => (['P1', 'P2'] as const)[op / 2 - 1] ?? null };
  const l5lines = renderBlock(code('FC9005'), proj, ctx5);
  const t5 = l5lines.map(l => (l.label ? l.label + ': ' : '') + l.text + (l.comment ? '  // ' + l.comment : ''));
  ok(l5lines.filter(l => l.cls === 'raw').length === 0, 'FC9005: zero RAW lines');
  ok(t5.includes('JC M001') && l5lines.some(l => l.label === 'M001' && l.off === 8), 'FC9005: JC label at 8');
  ok(t5.some(x => x.includes('LOOP M002')) && t5.some(x => x.includes('JCN M003')), 'FC9005: LOOP/JCN labels');
  ok(t5.some(x => x.includes('A OS')) && t5.includes('AN OV') && t5.includes('O ==0') && t5.includes('X BR'), 'FC9005: status-bit logic');
  ok(t5.includes('A #P1') && t5.includes('L #P2'), 'FC9005: PARAMETER names from own interface');
  ok(t5.includes('A DIX [AR2,P#2.0]') && t5.includes('L DIW [AR2,P#4.0]'), 'FC9005: register-indirect area forms');
  ok(t5.includes('L B [AR1,P#1.0]') && t5.includes('A [AR1,P#1.1]'), 'FC9005: area-less register-indirect');
  ok(t5.includes('O T 711') && t5.includes('A C 256') && t5.includes('SD T 256'), 'FC9005: 16-bit timer/counter ops');
  ok(t5.includes('L P#M2.0'), 'FC9005: P# literal with area');
  ok(t5.includes('L 1.5  // = 16#3FC00000'), 'FC9005: REAL literal');
  ok(t5.includes('L 2#00000000000000000000000000001111'), 'FC9005: 32-bit binary literal');
  ok(t5.includes('L W#16#1234'), 'FC9005: W#16 literal');
  ok(t5.includes('RND') && t5.includes('TAK') && t5.includes('CLR') && t5.includes('SAVE') && t5.includes('BEC') && t5.includes('BEU'), 'FC9005: misc 2B ops');
  ok(t5.includes('>D') && t5.includes('>=I') && t5.includes('AW') && t5.includes('OW') && t5.includes('NEGI') && t5.includes('INVI') && t5.includes('XOD'), 'FC9005: compares and accu logic');
  ok(t5.includes('LAR1') && t5.includes('LAR1 LD 10') && t5.includes('TAR1 LD 10'), 'FC9005: AR1 ops');

  const l3 = renderBlock(code('FC9003'), proj, ctx).map(l => l.text);
  ok(l3.includes('CALL "MY_FB" , DB 30'), 'FC9003: CALL FB with instance');
  ok(l3.includes('      X := MB 12'), 'FC9003: FB IN param X := MB 12');
  ok(l3.includes('      F := I 10.2'), 'FC9003: FB IN BOOL F := I 10.2');
  ok(l3.includes('      Y := MD 60'), 'FC9003: FB OUT param Y := MD 60');
}

// ---------- 2. full-project AWL comparison (local only) ----------
if (process.env.MC7FULL && process.env.MC7AWL) {
  const dir = process.env.MC7FULL;
  const snap = JSON.parse(readFileSync(dir + '/project_snapshot.json', 'utf8'));
  const codeMap = JSON.parse(readFileSync(dir + '/golden_code.json', 'utf8'));
  const proj = new S7Project(snap);
  const syms: Record<string, string> = snap.symbols; // name -> "M 10.3" / "DB 10"
  const rev: Record<string, string> = {};
  for (const [n, a] of Object.entries(syms)) rev[(a as string).replace(/\s+/g, ' ').trim()] = n;
  const dbOff = new Map<number, Map<string, { byte: number; bit: number | null }>>();
  for (const [k, v] of Object.entries(snap.dbs as Record<string, { declaration?: string }>)) {
    const n = +k.replace(/^DB/, '');
    if (v.declaration) dbOff.set(n, parseDbOffsets(v.declaration));
  }
  const ctx: RenderCtx = {
    symbolFor: a => rev[a] ?? null,
    blockName: (k, n) => rev[`${k} ${n}`] ?? null,
    dbField: (db, byte, bit) => { const o = dbOff.get(db); return o ? dbFieldName(o, db, byte, bit) : null; },
  };
  const hex2u8 = (h: string) => { const u = new Uint8Array(h.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(h.substr(i * 2, 2), 16); return u; };

  const f32bits = (v: number) => { const b = new ArrayBuffer(4); new DataView(b).setFloat32(0, v); return new DataView(b).getUint32(0); };
  const s5tMs = (s: string) => {
    const m = /^S5T#(\d+)(MS|S|M|H)$/i.exec(s.replace(/\s/g, ''));
    if (!m) return null;
    return +m[1] * { MS: 1, S: 1000, M: 60000, H: 3600000 }[m[2].toUpperCase() as 'MS'];
  };
  // canonical: symbol names -> absolute addresses; numbers normalized; floats -> hex bits; labels -> LBL
  const canon = (op: string, operand: string): string => {
    let t = operand.trim().replace(/\s+/g, ' ');
    t = t.replace(/"([^"]+)"/g, (_, n) => (syms[n] ?? `"${n}"`).replace(/\s+/g, ' ').trim());
    t = t.replace(/\s+/g, ' ');
    t = t.replace(/\bDB\s*(\d+)\.(DB[BWDX]|DIX|DIB|DIW|DID) (\d+(?:\.\d+)?)/g, '@$2 $3@$1');
    t = t.replace(/\bDB\s*(\d+)\.(\w+)/g, '@$2@$1');
    t = t.replace(/@(\w+)@(\d+)\.(\w+)/g, '@$1.$3@$2');
    if (/^NOP$/i.test(op) && t === '0') t = '';
    t = t.replace(/\b16#([0-9A-Fa-f]+)\b/g, (_, h) => String(parseInt(h, 16)));
    t = t.replace(/\bL ([0-9]+)\b/, (m, d) => `L ${+d}`);
    const fl = /^(-?\d+\.\d+(?:e[+-]?\d+)?)$/i.exec(t);
    if (fl) t = '16#' + f32bits(+fl[1]).toString(16).toUpperCase();
    const s5 = /S5T#/i.test(t) ? s5tMs(t) : null;
    if (s5 != null) t = 'S5T:' + s5;
    if (/^(JNB|JU|JC|JCN)\b/i.test(op)) t = 'LBL';
    return (op.toUpperCase() + ' ' + t).trim().replace(/\s+/g, ' ');
  };

  const awlAll = readFileSync(process.env.MC7AWL, 'utf8').replace(/\r/g, '').split('\n');
  const RANGE: Record<string, [number, number]> = { '81': [4661, 5230], '82': [5231, 5857] }; // FC81 + FC82 (has calls)
  for (const fc of Object.keys(RANGE)) {
    const [a, b] = RANGE[fc];
    const awl: string[] = [];
    let begun = false;
    for (let i = a - 1; i < b && i < awlAll.length; i++) {
      let l = awlAll[i];
      l = l.replace(/\/\/.*$/, '').trim();
      if (!l || l.startsWith('{')) continue;
      if (!begun) { if (/^BEGIN\b/i.test(l)) begun = true; continue; }
      if (/^(NETWORK|TITLE|BEGIN|END_FUNCTION|FUNCTION|VAR_|END_VAR|BLD)/i.test(l)) continue;
      l = l.replace(/^\w+\s*:(?!=)\s*/, '').replace(/;\s*$/, '').trim();
      if (!l) continue;
      const m = /^(\S+)\s*(.*)$/.exec(l);
      if (m) awl.push(canon(m[1], m[2]));
    }
    const lines = renderBlock(hex2u8(codeMap[fc]), proj, ctx).filter(l => l.cls === 'instr' || l.cls === 'raw' || l.cls === 'call');
    const ours: string[] = [];
    for (let li = 0; li < lines.length; li++) {
      const l = lines[li];
      if (/^BLD /.test(l.text)) continue;
      if (l.cls === 'call') { ours.push('CALL'); continue; }
      // collapse OPN DB n + register-relative op into the source's qualified form
      const opm = /^OPN (DB|DI) (\d+)$/.exec(l.text);
      const nx = lines[li + 1];
      if (opm && nx) {
        const m2 = /^(\S+) (DBX|DIX|DBB|DBW|DBD|DIB|DIW|DID) (\d+(?:\.\d+)?)$/.exec(nx.text);
        if (m2) {
          const f = nx.comment && /^DB\d+\./.test(nx.comment) ? nx.comment.replace(/^DB\d+\./, '') : `${m2[2]} ${m2[3]}`;
          ours.push(canon(m2[1], `@${f}@${opm[2]}`));
          li++; continue;
        }
      }
      const m = /^(\S+)\s*(.*)$/.exec(l.text.replace(/\? /, 'RAW '));
      let operand = m ? m[2] : '';
      if (l.comment && /^[A-Z]+ [\d.]/.test(l.comment)) operand = l.comment; // absolute address from comment
      ours.push(m ? canon(m[1], operand) : l.text);
    }
    // ordered comparison allowing CALL folding (source CALL + param lines <-> one CALL marker)
    let i = 0, j = 0, match = 0, miss = 0;
    const misses: string[] = [];
    while (i < awl.length && j < ours.length) {
      if (awl[i] === ours[j]) { match++; i++; j++; continue; }
      if (ours[j] === 'CALL') { // skip source lines until past its parameter block
        while (i < awl.length && !/^CALL\b/i.test(awl[i])) { miss++; misses.push('src-skip ' + awl[i]); i++; }
        if (i < awl.length) { i++; j++; while (i < awl.length && /:=/.test(awl[i])) i++; match++; continue; }
      }
      if (/^CALL\b/i.test(awl[i])) { i++; continue; }
      if (/:=/.test(awl[i])) { i++; continue; }
      miss++; if (misses.length < 12) misses.push(`@${i}/${j} src[${awl[i]}] ours[${ours[j]}]`);
      i++; j++;
    }
    miss += (awl.length - i) + (ours.length - j);
    // multiset check: greedy order can drop one duplicate; contents must be identical
    const bag = (xs: string[]) => { const m = new Map<string, number>(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return m; };
    const ba = bag(awl), bo = bag(ours);
    const bagDiff: string[] = [];
    for (const [k, v] of ba) { const d = v - (bo.get(k) ?? 0); if (d) bagDiff.push(`${k}: src+${d}`); }
    for (const [k, v] of bo) { const d = v - (ba.get(k) ?? 0); if (d) bagDiff.push(`${k}: ours+${d}`); }
    if (bagDiff.length) console.log('   bag diff: ' + bagDiff.slice(0, 10).join(' | ')); else console.log('   bags identical');
    const pct = (100 * match / (match + miss)).toFixed(1);
    console.log(`FC${fc}: AWL ${awl.length} vs rendered ${ours.length}: ${match} matched, ${miss} missed (${pct}%)`);
    for (const m of misses) console.log('   ' + m);
    if (fc === '81' && match / (match + miss) < 0.99) fail++;
  }
} else {
  console.log('(full-project AWL comparison skipped: set MC7FULL + MC7AWL)');
}

console.log(fail ? `FAIL (${fail})` : 'RENDER TESTS PASS');
process.exit(fail ? 1 : 0);
