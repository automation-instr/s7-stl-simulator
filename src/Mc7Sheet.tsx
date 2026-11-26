import React, { useMemo } from 'react';
import { S7Project } from './mc7/project';
import { renderBlock, RenderCtx, RenderLine } from './mc7/render';

/**
 * Decoded STL view of a compiled-only block (no AWL source in the project).
 * The MC7 binary is decoded by src/mc7 (validated byte-exact against SIMATIC
 * ground truth; see docs/MC7.md). The binary is the ground truth; symbolic
 * names come from the project's current symbol table.
 */

const hex = (u: Uint8Array) => Array.from(u, b => b.toString(16).padStart(2, '0')).join('');

export function Mc7Stl({ proj, kind, num, comp }: { proj: any; kind: string; num: number; comp: any }) {
    const data = useMemo(() => {
        try {
            const blocks: Record<string, { code?: string; interface?: string }> = {};
            for (const c of proj.catalog ?? []) {
                if (!c.comp) continue;
                const e: { code?: string; interface?: string } = {};
                if (c.comp.code && c.comp.code.length) e.code = hex(c.comp.code);
                if (c.comp.decl) e.interface = c.comp.decl;
                if (e.code || e.interface) blocks[c.kind + c.num] = e;
            }
            const snap = { blocks, dbs: {}, symbols: proj.symbols ?? {} };
            const mc7proj = new S7Project(snap as any);
            const rev: Record<string, string> = {};
            for (const [n, a] of Object.entries(proj.symbols ?? {})) rev[(a as string).replace(/\s+/g, ' ').trim()] = n;
            const names = new Map<string, string>();
            for (const c of proj.catalog ?? []) if (c.name) names.set(`${c.kind} ${c.num}`, c.name);
            const ctx: RenderCtx = {
                symbolFor: a => rev[a] ?? null,
                blockName: (k, n) => names.get(`${k} ${n}`) ?? null,
                dbField: (db, byte, bit) => {
                    const lay = proj.dbs?.[db];
                    if (!lay) return null;
                    for (const [nm, f] of Object.entries<any>(lay.fields)) {
                        if (f.off !== byte) continue;
                        if (bit != null && f.bit === bit) return `DB${db}.${nm}`;
                        if (bit == null && f.bit == null) return `DB${db}.${nm}`;
                    }
                    return null;
                },
            };
            const key = kind + num;
            const code = comp.code as Uint8Array;
            const lines = renderBlock(code, mc7proj, ctx);
            const raws = lines.filter(l => l.cls === 'raw').length;
            return { lines, raws };
        } catch (e: any) {
            return { error: String(e?.message ?? e) };
        }
    }, [proj, kind, num, comp]);

    if ((data as any).error) return <div className="s7-hint">{'Decode failed: ' + (data as any).error}</div>;
    const { lines, raws } = data as { lines: RenderLine[]; raws: number };
    return <div>
        <div className="s7-hint" style={{ margin: '8px 0' }}>
            {'Compiled block decoded from the MC7 in the project (decoder validated against SIMATIC-compiled sources). The binary is the ground truth; symbolic names come from the current symbol table.'}
            {raws > 0 ? ` ${raws} instruction(s) are not decoded yet and show as raw hex; lines right after a raw entry may be misaligned, so treat them with care.` : ''}
        </div>
        <div className="mc7-stl" dir="ltr">
            {lines.map((l, i) => <div className={'mc7-line mc7-' + l.cls} key={i}>
                <span className="mc7-lab">{l.label ? l.label + ':' : ''}</span>
                <span className="mc7-tx">{l.text}</span>
                {l.comment && <span className="mc7-cm">{'// ' + l.comment}</span>}
            </div>)}
        </div>
    </div>;
}
