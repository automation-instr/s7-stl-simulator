/* eslint-disable */
import { Block, DbLayout, splitBlocks, dbLayouts, layoutDecls, parseSymList, parseSymText, detectMnem, parseSymInfo, parseBlockCatalog, parseBlockDates, parseCompiled, compInfo } from './engine';

export type Proj = {
    blocks: Block[]; symbols: Record<string, string>; dbs: Record<number, DbLayout>; udts?: Record<number, DbLayout>;
    mnem: 'en' | 'de'; files: string[]; warn: string[]; symCount: number;
    catalog?: { kind: string; num: number; name: string; comment: string; code?: number; iface?: number; comp?: any }[];
};

export function decodeText(buf: Uint8Array): string {
    let txt: string;
    if ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff)) txt = new TextDecoder(buf[0] === 0xff ? 'utf-16le' : 'utf-16be').decode(buf);
    else { try { txt = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { txt = new TextDecoder('windows-1252').decode(buf); } }
    return txt.replace(/^\uFEFF/, '');
}

// minimal ZIP reader (stored + deflate), no dependencies
export async function unzip(buf: Uint8Array, want: (name: string) => boolean): Promise<{ name: string; data: Uint8Array }[]> {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let e = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('Not a valid ZIP file');
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
    const out: { name: string; data: Uint8Array }[] = [];
    for (let k = 0; k < n; k++) {
        if (dv.getUint32(p, true) !== 0x02014b50) break;
        const method = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
        const flags = dv.getUint16(p + 8, true);
        const name = new TextDecoder(flags & 0x800 ? 'utf-8' : 'windows-1252').decode(buf.subarray(p + 46, p + 46 + nl));
        p += 46 + nl + xl + cl;
        if (name.endsWith('/') || !want(name)) continue;
        const lnl = dv.getUint16(lo + 26, true), lxl = dv.getUint16(lo + 28, true); const ds = lo + 30 + lnl + lxl;
        const raw = buf.subarray(ds, ds + csz);
        if (method === 0) out.push({ name, data: raw.slice() });
        else if (method === 8) {
            const stream = new Blob([raw]).stream().pipeThrough(new (window as any).DecompressionStream('deflate-raw'));
            out.push({ name, data: new Uint8Array(await new Response(stream).arrayBuffer()) });
        }
    }
    return out;
}

const isSrc = (n: string) => /\.(awl|stl|src|txt)$/i.test(n);
const SUBT: Record<string, number> = { UDT: 0, OB: 8, DB: 10, FC: 12, SFC: 13, FB: 14, SFB: 15, VAT: 27 };
const isCat = (n: string) => /ombstx[\\/]offline[\\/][^\\/]+[\\/]baustein\.dbf$/i.test(n);
const isSub = (n: string) => /ombstx[\\/]offline[\\/][^\\/]+[\\/]subblk\.(dbf|dbt)$/i.test(n);
const isSymFile = (n: string) => /symlist\.dbf$/i.test(n) || /\.(sdf|asc|sym|csv)$/i.test(n);

export type Loaded = { kind: 'program'; text: string; name: string } | { kind: 'project'; proj: Proj };

export async function loadFiles(files: { name: string; data: Uint8Array }[]): Promise<Loaded> {
    let all: { name: string; data: Uint8Array }[] = [];
    for (const f of files) {
        if (/\.zip$/i.test(f.name) || (f.data[0] === 0x50 && f.data[1] === 0x4b)) all.push(...await unzip(f.data, n => isSrc(n) || isSymFile(n) || isCat(n) || isSub(n)));
        else all.push(f);
    }
    const blocks: Block[] = []; let symbols: Record<string, string> = {}; const used: string[] = []; const warn: string[] = []; const srcs: string[] = [];
    let single = ''; let nBin = 0, nSrc = 0; const cats: { kind: string; num: number; id: number; dir: string }[] = []; const dates: Record<string, any> = {}; const comps: Record<string, any> = {}; const subf: Record<string, Uint8Array> = {}; let info: Record<string, { name: string; comment: string }> = {};
    for (const f of all) {
        if (isCat(f.name)) { try { const dir = f.name.replace(/[^\\/]+$/, '').toLowerCase(); cats.push(...parseBlockCatalog(f.data).map(c => ({ ...c, dir }))); } catch { } continue; }
        if (isSub(f.name)) { subf[f.name.toLowerCase()] = f.data; continue; }
        if (isSymFile(f.name)) {
            if (!/\.dbf$/i.test(f.name) && all.some(x => /symlist\.dbf$/i.test(x.name))) continue; // a real symbol table is present
            try {
                if (/symlist\.dbf$/i.test(f.name)) { try { Object.assign(info, parseSymInfo(f.data)); } catch { } }
                const s = /\.dbf$/i.test(f.name) ? parseSymList(f.data) : parseSymText(decodeText(f.data));
                const c = Object.keys(s).length; if (c) { Object.assign(symbols, s); used.push('Symbol table: ' + f.name.split('/').pop() + ' (' + c + ' symbols)'); }
            } catch (e: any) { warn.push(f.name + ': ' + e.message); }
        } else if (isSrc(f.name)) {
            if (f.data.indexOf(0) >= 0 && !(f.data[0] === 0xff || f.data[0] === 0xfe)) { nBin++; continue; }
            const t = decodeText(f.data); srcs.push(t); single = t;
            const b = splitBlocks(t); b.forEach(x => blocks.push(x)); if (b.length) nSrc++;
        }
    }
    if (nSrc) used.unshift(nSrc + ' AWL files (' + blocks.length + ' blocks)');
    if (nBin) warn.push(nBin + ' file(s) skipped because they are binary');
    const nSym = Object.keys(symbols).length;
    if (blocks.length === 0 && nSym === 0) {
        if (!single) throw new Error('No AWL file or symbol table found in the selection');
        return { kind: 'program', text: single, name: files[0].name };
    }
    if (blocks.length === 0 && nSym > 0 && cats.length === 0) {
        return { kind: 'project', proj: { blocks: [], symbols, dbs: {}, mnem: 'en', files: used, warn, symCount: nSym } };
    }
    const KL: Record<string, string> = { FUNCTION: 'FC', FUNCTION_BLOCK: 'FB', ORGANIZATION_BLOCK: 'OB', DATA_BLOCK: 'DB', TYPE: 'UDT' };
    for (const b of blocks) { if (b.db) { b.num = b.db; continue; } const m = /^(FC|FB|OB|UDT)\s*(\d+)$/i.exec(b.name) || /^(FC|FB|OB|UDT)\s*(\d+)$/i.exec(symbols[b.name.toUpperCase()] || ''); if (m) b.num = +m[2]; else { const a = Object.keys(info).find(k => info[k].name.toUpperCase() === b.name.toUpperCase() && k.startsWith(KL[b.kind] || '??')); if (a) b.num = +a.replace(/\D/g, ''); } }
    for (const k of Object.keys(subf)) { if (!/dbf$/.test(k)) continue; const dir = k.replace(/[^\\/]+$/, ''); try { dates[dir] = parseBlockDates(subf[k]); const dbt = subf[k.replace(/dbf$/, 'dbt')]; if (dbt) comps[dir] = parseCompiled(subf[k], dbt); } catch { } }
    const seenC = new Set<string>(); const catalog = cats.filter(c => { const k = c.kind + c.num; if (seenC.has(k)) return false; seenC.add(k); return true; }).map(c => ({ kind: c.kind, num: c.num, name: (info[c.kind + c.num] || { name: '' }).name, comment: (info[c.kind + c.num] || { comment: '' }).comment, ...(() => { const d = dates[c.dir] && dates[c.dir][c.id] && dates[c.dir][c.id][SUBT[c.kind]]; return d ? { code: d.code || undefined, iface: d.iface || undefined } : {}; })(), comp: (() => { try { return compInfo(c.kind, comps[c.dir] && comps[c.dir][c.id]); } catch { return undefined; } })() }));
    // blocks that appear twice (same name): keep the last one
    const seen = new Map<string, number>(); blocks.forEach((b, i) => seen.set(b.kind + ':' + b.name, i));
    const uniq = blocks.filter((b, i) => seen.get(b.kind + ':' + b.name) === i);
    // UDT layouts from the stored UDT declarations (iterative: UDTs may nest)
    const udtDecls: Record<number, string> = {};
    for (const c of catalog) if (c.kind === 'UDT' && c.comp && c.comp.decl) udtDecls[c.num] = c.comp.decl;
    const udtLayouts: Record<number, DbLayout> = {};
    for (let pass = 0; pass < 8 && Object.keys(udtLayouts).length < Object.keys(udtDecls).length; pass++) {
        for (const k of Object.keys(udtDecls)) {
            const n = +k; if (udtLayouts[n]) continue;
            const ls = udtDecls[n].split('\n'); const a = ls.findIndex(l => /^\s*STRUCT\b/i.test(l)); let z = -1; for (let i = ls.length - 1; i > a && a >= 0; i--) if (/^\s*END_STRUCT\b/i.test(ls[i])) { z = i; break; }
            if (a < 0 || z < 0) { udtLayouts[n] = { size: 0, fields: {} }; continue; }
            const r = layoutDecls(ls.slice(a + 1, z), udtLayouts);
            // wait for nested UDTs that are not resolved yet (error names one)
            if (r.errors.some(e => e.startsWith('Unknown UDT'))) continue;
            udtLayouts[n] = { size: r.size, fields: r.fields };
        }
    }
    const { dbs, warn: w2 } = dbLayouts(blocks, udtLayouts);
    // layouts for compiled-only DBs: synthesize an AWL DB from the stored declaration text
    const synth: Block[] = [];
    for (const c of catalog) {
        if (c.kind !== 'DB' || !c.comp || !c.comp.decl || dbs[c.num]) continue;
        synth.push({ kind: 'DATA_BLOCK', name: 'DB' + c.num, num: c.num, db: c.num, text: 'DATA_BLOCK DB ' + c.num + '\n' + c.comp.decl + '\nBEGIN\nEND_DATA_BLOCK' } as Block);
    }
    if (synth.length) { const r = dbLayouts(synth, udtLayouts); for (const k of Object.keys(r.dbs)) dbs[+k] = r.dbs[+k]; }
    return { kind: 'project', proj: { blocks: uniq, symbols, dbs, udts: Object.keys(udtLayouts).length ? udtLayouts : undefined, mnem: detectMnem(srcs.join('\n')), files: used, warn: warn.concat(w2), symCount: nSym, catalog: catalog.length ? catalog : undefined } };
}

// ---- IndexedDB persistence for the (large) project
const DB = 's7stl', ST = 'kv';
const idb = (): Promise<IDBDatabase> => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(ST); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
export async function idbPut(k: string, v: any) { try { const d = await idb(); await new Promise<void>((res, rej) => { const t = d.transaction(ST, 'readwrite'); t.objectStore(ST).put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); return true; } catch { return false; } }
export async function idbGet(k: string): Promise<any> { try { const d = await idb(); return await new Promise(res => { const r = d.transaction(ST).objectStore(ST).get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(undefined); }); } catch { return undefined; } }
export async function idbDel(k: string) { try { const d = await idb(); d.transaction(ST, 'readwrite').objectStore(ST).delete(k); } catch { } }
