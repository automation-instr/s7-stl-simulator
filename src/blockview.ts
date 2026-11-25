// STEP 7-style structured view of one AWL block source (no execution semantics).
export type BVar = { name: string; type: string; init: string; comment: string; raw?: boolean; indent: number };
export type BLine = { line: number; code: string; comment: string };
export type BNet = { n: number; line: number; title: string; comment: string[]; code: BLine[] };
export type BlockView = {
    kind: string; name: string; title: string; ret: string; meta: { k: string; v: string }[];
    sections: { sec: string; vars: BVar[] }[]; struct: BVar[]; nets: BNet[]; initLines: BLine[]; lines: number; comments: number;
};
// split "code // comment" outside of double quotes
export function splitComment(s: string): [string, string] {
    let q = false;
    for (let i = 0; i < s.length - 1; i++) {
        const c = s[i];
        if (c === '"') q = !q;
        else if (!q && c === '/' && s[i + 1] === '/') return [s.slice(0, i), s.slice(i + 2).trim()];
    }
    return [s, ''];
}
const VAR_SECS = ['VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_TEMP', 'VAR'];
function parseVar(raw: string, depth: number): BVar | null {
    const [code, comment] = splitComment(raw);
    const t = code.trim().replace(/;\s*$/, '');
    if (!t && !comment) return null;
    const m = /^([^:]+?)\s*:\s*(.*?)(?:\s*:=\s*(.*))?$/.exec(t);
    if (!m) return { name: t, type: '', init: '', comment, raw: true, indent: depth };
    return { name: m[1].trim(), type: m[2].trim(), init: (m[3] || '').trim(), comment, indent: depth };
}
export function parseBlockView(text: string): BlockView {
    const L = text.replace(/\r/g, '').split('\n');
    const bv: BlockView = { kind: '', name: '', title: '', ret: '', meta: [], sections: [], struct: [], nets: [], initLines: [], lines: L.length, comments: 0 };
    let i = 0;
    const h = /^\s*(FUNCTION_BLOCK|FUNCTION|ORGANIZATION_BLOCK|DATA_BLOCK|TYPE)\s+("[^"]+"|\w+)\s*(?::\s*(.*))?$/i.exec(L[0] || '');
    if (h) { bv.kind = h[1].toUpperCase(); bv.name = h[2].replace(/"/g, ''); bv.ret = (h[3] || '').trim(); i = 1; }
    // header until VAR/STRUCT/BEGIN
    for (; i < L.length; i++) {
        const t = L[i].trim();
        if (/^(VAR\w*|STRUCT|BEGIN)\b/i.test(t)) break;
        if (!t) continue;
        if (/^TITLE\s*=/i.test(t)) { bv.title = t.replace(/^TITLE\s*=\s*/i, '').trim(); continue; }
        if (t.startsWith('//')) { bv.meta.push({ k: 'Comment', v: t.slice(2).trim() }); bv.comments++; continue; }
        if (t.startsWith('{')) continue;
        const m = /^(\w+)\s*:\s*(.*)$/.exec(t);
        if (m) bv.meta.push({ k: m[1], v: m[2].trim() });
    }
    // interface sections and struct
    while (i < L.length) {
        const t = L[i].trim();
        const sec = VAR_SECS.find(s => new RegExp('^' + s + '\\b', 'i').test(t) && !/^VAR_\w+/i.test(t.replace(/^VAR\b/i, 'VAR_X')) ) || (/^VAR(_INPUT|_OUTPUT|_IN_OUT|_TEMP)?\b/i.test(t) ? t.split(/\s/)[0].toUpperCase() : '');
        if (sec) {
            const vars: BVar[] = []; let depth = 0; i++;
            for (; i < L.length && !/^END_VAR\b/i.test(L[i].trim()); i++) {
                const tt = L[i].trim();
                if (/^END_STRUCT\b/i.test(tt)) { depth = Math.max(0, depth - 1); continue; }
                const v = parseVar(L[i], depth); if (!v) continue;
                if (v.comment) bv.comments++;
                vars.push(v);
                if (/\bSTRUCT\s*$/i.test(v.type) || /^STRUCT\b/i.test(tt)) depth++;
            }
            bv.sections.push({ sec, vars }); i++; continue;
        }
        if (/^STRUCT\b/i.test(t)) {
            let depth = 0; i++;
            for (; i < L.length; i++) {
                const tt = L[i].trim();
                if (/^BEGIN\b/i.test(tt)) break;
                if (/^END_STRUCT\b/i.test(tt)) { if (depth === 0) { i++; break; } depth--; continue; }
                const v = parseVar(L[i], depth); if (!v) continue;
                if (v.comment) bv.comments++;
                bv.struct.push(v);
                if (/\bSTRUCT\s*$/i.test(v.type)) depth++;
            }
            continue;
        }
        if (/^BEGIN\b/i.test(t)) { i++; break; }
        i++;
    }
    // body
    const isDb = bv.kind === 'DATA_BLOCK';
    let net: BNet | null = null; let inHead = false;
    for (; i < L.length; i++) {
        const raw = L[i]; const t = raw.trim();
        if (/^END_(FUNCTION_BLOCK|FUNCTION|ORGANIZATION_BLOCK|DATA_BLOCK|TYPE)\b/i.test(t)) break;
        if (isDb) { const [c, cm] = splitComment(raw); if (c.trim() || cm) { bv.initLines.push({ line: i + 1, code: c.trim(), comment: cm }); if (cm) bv.comments++; } continue; }
        if (/^NETWORK\b/i.test(t)) { net = { n: bv.nets.length + 1, line: i + 1, title: '', comment: [], code: [] }; bv.nets.push(net); inHead = true; continue; }
        if (!net) { net = { n: 1, line: i + 1, title: '', comment: [], code: [] }; bv.nets.push(net); inHead = false; }
        if (inHead && /^TITLE\s*=/i.test(t)) { net.title = t.replace(/^TITLE\s*=\s*/i, '').trim(); continue; }
        if (inHead && t.startsWith('//')) { net.comment.push(t.slice(2)); bv.comments++; continue; }
        if (inHead && !t) continue;
        if (t.startsWith('{')) continue;
        inHead = false;
        const [c, cm] = splitComment(raw);
        if (!c.trim() && !cm) { continue; }
        if (cm) bv.comments++;
        net.code.push({ line: i + 1, code: c.replace(/\s+$/, ''), comment: cm });
    }
    return bv;
}
