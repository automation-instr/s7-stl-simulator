import React, { useMemo, useState } from 'react';
import { Block, DbLayout } from './engine';
import { parseBlockView, BVar } from './blockview';

const tidy = (c: string) => c.replace(/(\S) {4,}/g, '$1  ');
export const KIND_LABEL: Record<string, string> = { ORGANIZATION_BLOCK: 'OB', FUNCTION_BLOCK: 'FB', FUNCTION: 'FC', DATA_BLOCK: 'DB', TYPE: 'UDT' };
const SEC_LABEL: Record<string, string> = { VAR_INPUT: 'IN', VAR_OUTPUT: 'OUT', VAR_IN_OUT: 'IN_OUT', VAR_TEMP: 'TEMP', VAR: 'STAT' };

function VarTable({ vars, layout, filter, max }: { vars: BVar[]; layout?: DbLayout; filter: string; max: number }) {
    const f = filter.toLowerCase();
    const rows = f ? vars.filter(v => (v.name + ' ' + v.type + ' ' + v.comment).toLowerCase().includes(f)) : vars;
    return <div className="bv-vars">
        {rows.slice(0, max).map((v, i) => {
            const fl = layout && layout.fields[v.name];
            return <div className="bv-var" key={i} style={{ paddingLeft: v.indent * 12 }}>
                {layout && <span className="off">{fl ? fl.off + (fl.bit !== undefined ? '.' + fl.bit : '') : ''}</span>}
                <b>{v.name}</b><i>{v.type}</i>{v.init && <em>:= {v.init}</em>}
                {v.comment && <span className="cm">// {v.comment}</span>}
            </div>;
        })}
        {rows.length > max && <div className="s7-hint">… {rows.length - max} more (use the filter)</div>}
        {rows.length === 0 && <div className="s7-hint">No entries</div>}
    </div>;
}

export function BlockSheet({ b, layout, onClose, onLoad, status }: { b: Block; layout?: DbLayout; onClose: () => void; onLoad?: () => void; status?: string }) {
    const v = useMemo(() => parseBlockView(b.text), [b]);
    const [filter, setFilter] = useState('');
    const [netMax, setNetMax] = useState(25);
    const [varMax, setVarMax] = useState(150);
    const f = filter.toLowerCase();
    const nets = f ? v.nets.filter(n => (n.title + ' ' + n.comment.join(' ') + ' ' + n.code.map(c => c.code + ' ' + c.comment).join(' ')).toLowerCase().includes(f)) : v.nets;
    if (!b.text.trim()) return <div className="s7-modal" onClick={onClose}><div className="s7-sheet" onClick={e => e.stopPropagation()}><div className="s7-h">{b.name}<button type="button" className="s7-x" onClick={onClose}>✕</button></div><div className="s7-hint">{'The source of this block was not stored by an earlier version. Load the project again to view it.'}</div></div></div>;
    const label = KIND_LABEL[v.kind] || v.kind;
    return <div className="s7-modal" onClick={onClose}>
        <div className="s7-sheet bv" role="dialog" aria-label={'Block ' + v.name} onClick={e => e.stopPropagation()}>
            <div className="bv-head">
                <div style={{ minWidth: 0 }}>
                    <div className="bv-kind">{label}{b.num != null && !b.db ? ' ' + b.num : ''}</div>
                    <div className="bv-name">{v.name}</div>
                    {v.title && <div className="bv-title">{v.title}</div>}
                </div>
                <button type="button" className="s7-x" aria-label="Close" onClick={onClose}>✕</button>
            </div>
            <div className="bv-meta">
                {v.meta.map((m, i) => <span key={i}><u>{m.k}</u> {m.v}</span>)}
                {v.ret && <span><u>Returns</u> {v.ret}</span>}
                <span><u>Lines</u> {v.lines}</span>
                {v.nets.length > 0 && <span><u>Networks</u> {v.nets.length}</span>}
                <span><u>Comments</u> {v.comments}</span>
                {status && <span>{status}</span>}
            </div>
            {onLoad && <div className="s7-row" style={{ marginTop: 0 }}><button type="button" className="s7-btn wide" onClick={onLoad}><b>⤓</b>{'Load into editor / simulate'}</button></div>}
            <input className="s7-sel bv-filter" dir="ltr" placeholder={v.kind === 'DATA_BLOCK' ? 'Filter fields and comments' : 'Filter networks, code and comments'} aria-label="Filter" value={filter} onChange={e => { setFilter(e.target.value); setNetMax(25); setVarMax(150); }} />

            {v.sections.map((s, i) => (s.vars.length > 0) && <div className="bv-sec" key={i}>
                <div className="s7-h">{(SEC_LABEL[s.sec] || s.sec)}<span>{s.vars.length}</span></div>
                <VarTable vars={s.vars} filter={filter} max={varMax} />
            </div>)}

            {v.kind === 'DATA_BLOCK' && <div className="bv-sec">
                <div className="s7-h">{'Declaration'}<span>{v.struct.length} {'entries'}{layout ? ' | ' + layout.size + ' bytes' : ''}</span></div>
                <VarTable vars={v.struct} layout={layout} filter={filter} max={varMax} />
                {v.struct.length > varMax && !filter && <div className="s7-row"><button type="button" className="s7-chip" onClick={() => setVarMax(varMax + 300)}>{'Show more'}</button></div>}
                {v.initLines.length > 0 && <>
                    <div className="s7-h" style={{ marginTop: 10 }}>{'Initial values'}<span>{v.initLines.length}</span></div>
                    <div className="bv-code">{v.initLines.slice(0, 200).map((l, i) => <div key={i}><span className="ln">{l.line}</span><code>{tidy(l.code)}</code>{l.comment && <span className="cm">// {l.comment}</span>}</div>)}</div>
                </>}
            </div>}

            {nets.slice(0, netMax).map(n => <div className="bv-net" key={n.n}>
                <div className="bv-nh"><b>{'Network'} {n.n}</b>{n.title && <span>{n.title}</span>}<small>{'line'} {n.line}</small></div>
                {n.comment.length > 0 && <div className="bv-nc">{n.comment.map((c, i) => <div key={i}>{c || '\u00a0'}</div>)}</div>}
                <div className="bv-code">{n.code.map((l, i) => <div key={i}><span className="ln">{l.line}</span><code>{tidy(l.code) || '\u00a0'}</code>{l.comment && <span className="cm">// {l.comment}</span>}</div>)}</div>
            </div>)}
            {nets.length > netMax && <div className="s7-row"><button type="button" className="s7-chip" onClick={() => setNetMax(netMax + 40)}>{'Show more networks'} ({nets.length - netMax})</button></div>}
            {v.kind !== 'DATA_BLOCK' && nets.length === 0 && <div className="s7-hint">{'No networks found'}</div>}
        </div>
    </div>;
}
