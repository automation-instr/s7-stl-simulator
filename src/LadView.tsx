import React from 'react';
import { LadNetwork, LadRung, LadElem, LadGroup } from './lad';

/**
 * View-only ladder rendering for a convertible STL network.
 * Layout: recursive grid; every element reports (w,h); chains sum widths,
 * OR groups stack branches vertically and take the widest branch.
 */

const CW = 96;        // contact width
const CH = 44;        // element row height
const BW = 26;        // branch join padding
const BH = 10;        // vertical gap between branches
const COILW = 88;
const BOXW = 150;

interface Box { w: number; h: number }

function sizeElem(e: LadElem): Box {
  if (e.kind === 'or') {
    const bs = e.branches.map(sizeChain);
    return { w: Math.max(...bs.map(b => b.w)) + 2 * BW, h: bs.reduce((a, b) => a + b.h, 0) + BH * (bs.length - 1) };
  }
  if (e.kind === 'p' || e.kind === 'n') return { w: 64, h: CH };
  return { w: CW, h: CH };
}
function sizeChain(c: LadElem[]): Box {
  if (!c.length) return { w: 24, h: CH };
  let w = 0, h = 0;
  for (const e of c) { const b = sizeElem(e); w += b.w; h = Math.max(h, b.h); }
  return { w, h };
}

const LINE = '#8ab4d8';
const TXT = '#d7e3f0';
const SUB = '#8ea3b8';

function ContactSvg({ e, x, y }: { e: LadElem & { kind: 'no' | 'nc' | 'p' | 'n' }; x: number; y: number }) {
  const w = e.kind === 'no' || e.kind === 'nc' ? CW : 64;
  const mid = y + CH / 2;
  const cx = x + w / 2;
  const label = (t: string) => <text x={cx} y={y + 12} textAnchor="middle" fill={TXT} fontSize="12" fontFamily="ui-monospace, monospace">{t}</text>;
  if (e.kind === 'p' || e.kind === 'n') {
    return <g>
      <line x1={x} y1={mid} x2={x + w} y2={mid} stroke={LINE} strokeWidth="2" />
      <circle cx={cx} cy={mid} r="11" fill="none" stroke={LINE} strokeWidth="2" />
      <text x={cx} y={mid + 4} textAnchor="middle" fill={LINE} fontSize="12" fontFamily="ui-monospace, monospace">{e.kind === 'p' ? 'P' : 'N'}</text>
      {label(e.op)}
    </g>;
  }
  return <g>
    <line x1={x} y1={mid} x2={x + w} y2={mid} stroke={LINE} strokeWidth="2" />
    <line x1={cx - 10} y1={mid - 12} x2={cx - 10} y2={mid + 12} stroke={LINE} strokeWidth="2" />
    <line x1={cx + 10} y1={mid - 12} x2={cx + 10} y2={mid + 12} stroke={LINE} strokeWidth="2" />
    {e.kind === 'nc' && <line x1={cx - 14} y1={mid + 14} x2={cx + 14} y2={mid - 14} stroke={LINE} strokeWidth="2" />}
    {label(e.op)}
  </g>;
}

function GroupSvg({ g, x, y, w }: { g: LadGroup; x: number; y: number; w: number }) {
  const innerW = w - 2 * BW;
  const bs = g.branches.map(sizeChain);
  const H = bs.reduce((a, b) => a + b.h, 0) + BH * (bs.length - 1);
  const firstMid = y + bs[0].h / 2;
  const lastMid = y + H - bs[bs.length - 1].h / 2;
  let cy = y;
  return <g>
    {/* join lines into/out of the branches */}
    <line x1={x} y1={firstMid} x2={x} y2={lastMid} stroke={LINE} strokeWidth="2" />
    <line x1={x + w} y1={firstMid} x2={x + w} y2={lastMid} stroke={LINE} strokeWidth="2" />
    {g.branches.map((br, i) => {
      const bh = bs[i].h;
      const mid = cy + bh / 2;
      const el = <g key={i}>
        <line x1={x} y1={mid} x2={x + BW} y2={mid} stroke={LINE} strokeWidth="2" />
        <ChainSvg chain={br} x={x + BW} y={cy} w={innerW} />
        <line x1={x + BW + innerW} y1={mid} x2={x + w} y2={mid} stroke={LINE} strokeWidth="2" />
      </g>;
      cy += bh + BH;
      return el;
    })}
  </g>;
}

function ChainSvg({ chain, x, y, w }: { chain: LadElem[]; x: number; y: number; w?: number }) {
  const size = sizeChain(chain);
  const totalW = w ?? size.w;
  // distribute: elements keep natural width; extra space goes to the last gap
  let cx = x;
  const els = chain.map((e, i) => {
    const b = sizeElem(e);
    const ew = i === chain.length - 1 && totalW > size.w ? b.w + (totalW - size.w) : b.w;
    const el = e.kind === 'or'
      ? <GroupSvg key={i} g={e} x={cx} y={y + (size.h - sizeElem(e).h) / 2} w={ew} />
      : <g key={i} transform={`translate(0,${(size.h - CH) / 2})`}><ContactSvg e={e as any} x={cx} y={y} /></g>;
    cx += ew;
    return el;
  });
  return <g>{els}</g>;
}

function OutSvg({ rung, x, y, h }: { rung: LadRung; x: number; y: number; h: number }) {
  const mid = y + h / 2;
  const o = rung.out;
  if (o.kind === 'timer') {
    const bh = 56, bw = BOXW;
    return <g>
      <line x1={x} y1={mid} x2={x + 14} y2={mid} stroke={LINE} strokeWidth="2" />
      <rect x={x + 14} y={mid - bh / 2} width={bw - 28} height={bh} fill="#17263a" stroke={LINE} strokeWidth="1.5" rx="4" />
      <text x={x + bw / 2} y={mid - bh / 2 + 17} textAnchor="middle" fill={TXT} fontSize="12" fontFamily="ui-monospace, monospace">{o.timerOp} {o.timer}</text>
      <text x={x + bw / 2} y={mid - bh / 2 + 33} textAnchor="middle" fill={SUB} fontSize="11" fontFamily="ui-monospace, monospace">{'TV'} {o.tv || '—'}</text>
      <text x={x + bw / 2} y={mid - bh / 2 + 48} textAnchor="middle" fill={SUB} fontSize="11" fontFamily="ui-monospace, monospace">{'Q → RLO'}</text>
    </g>;
  }
  if (o.kind === 'move') {
    const bh = 44, bw = BOXW;
    return <g>
      <line x1={x} y1={mid} x2={x + 14} y2={mid} stroke={LINE} strokeWidth="2" />
      <rect x={x + 14} y={mid - bh / 2} width={bw - 28} height={bh} fill="#17263a" stroke={LINE} strokeWidth="1.5" rx="4" />
      <text x={x + bw / 2} y={mid - 2} textAnchor="middle" fill={TXT} fontSize="12" fontFamily="ui-monospace, monospace">{'MOVE'}</text>
      <text x={x + bw / 2} y={mid + 14} textAnchor="middle" fill={SUB} fontSize="11" fontFamily="ui-monospace, monospace">{o.src}{' → '}{o.dst}</text>
    </g>;
  }
  return <g>
    <line x1={x} y1={mid} x2={x + COILW} y2={mid} stroke={LINE} strokeWidth="2" />
    <circle cx={x + COILW / 2} cy={mid} r="11" fill="none" stroke={LINE} strokeWidth="2" />
    {o.kind !== '=' && <text x={x + COILW / 2} y={mid + 4} textAnchor="middle" fill={LINE} fontSize="12" fontFamily="ui-monospace, monospace">{o.kind}</text>}
    <text x={x + COILW / 2} y={mid - 18} textAnchor="middle" fill={TXT} fontSize="12" fontFamily="ui-monospace, monospace">{o.op}</text>
  </g>;
}

function RungSvg({ rung }: { rung: LadRung }) {
  const cs = sizeChain(rung.chain);
  const outW = rung.out.kind === '=' || rung.out.kind === 'S' || rung.out.kind === 'R' ? COILW : BOXW;
  const h = Math.max(cs.h, CH);
  const W = 14 + cs.w + outW + 14;
  return <svg width={W} height={h + 8} style={{ display: 'block' }} role="img" aria-label="LAD rung">
    <line x1={7} y1={0} x2={7} y2={h + 8} stroke={LINE} strokeWidth="2.5" />
    <line x1={W - 7} y1={0} x2={W - 7} y2={h + 8} stroke={LINE} strokeWidth="2.5" />
    <line x1={7} y1={4 + h / 2} x2={14} y2={4 + h / 2} stroke={LINE} strokeWidth="2" />
    <g transform="translate(14,4)">
      <ChainSvg chain={rung.chain} x={0} y={0} />
      <OutSvg rung={rung} x={cs.w} y={0} h={h} />
    </g>
  </svg>;
}

export function LadView({ net }: { net: LadNetwork }) {
  return <div className="s7-ladnet">
    <div className="s7-ladtitle">{'Network '}{net.n}{net.title ? ': ' + net.title : ''}</div>
    {net.convertible
      ? net.rungs.map((r, i) => <RungSvg key={i} rung={r} />)
      : <div>
          <div className="s7-hint">{'Not convertible to LAD yet'}<small>{net.note ? ' (' + net.note + ')' : ''}</small></div>
          <pre className="s7-ladstl">{net.stl.join('\n')}</pre>
        </div>}
  </div>;
}
