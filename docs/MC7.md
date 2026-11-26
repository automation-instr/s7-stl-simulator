# MC7 decode reference

MC7 is the bytecode SIMATIC Manager compiles STL (AWL) into. This document records everything
we have reverse-engineered about it, validated byte-for-byte against real compiled blocks.
It is the durable reference for the decoder in `src/mc7/` — any future program compiles to the
same encoding, so blocks from a new project decode on load with no re-cracking.

## Validation status

The Python reference decoder was validated against 6 ground-truth blocks from a real STEP 7
project (SIMATIC AWL sources as ground truth), all **100% byte-exact**:

| Block | Statements | Bytes | Jumps |
|-------|-----------|-------|-------|
| FC81  | 457/457   | 1748  | 2     |
| FC82  | 472/472   | 1878  |       |
| FC83  | 3286/3286 | 11810 | 65    |
| FC20  | 950/950   | 4712  | 17    |
| FC21  | 1276/1276 | 7024  |       |
| FC22  | 1276/1276 | 7024  |       |

Total: 7417 statements, 29652 bytes, 84 jump targets verified.
The TypeScript port (`src/mc7/`) is validated against the Python decoder by
`tests/mc7_golden.mts` (all 6 blocks, entry-for-entry identical, zero undecodable bytes).

Public cross-reference for the FB-call anatomy (matches our bytes exactly):
plctalk.net forum thread 134795, page 2 ("Siemens S7 Assembly Language").

## STEP 7 project storage

An offline project folder holds DBF databases (`ombstx/offline/<id>/`). Relevant tables:

- `BAUSTEIN`: one row per block. `_FLAGS` selects the block type. Code lives in
  `SUBBLK` rows keyed by the block's `_OID`, memo field, SUBBLK_TYP selects content:
  - 12 = FC code, 5 = FC interface
  - 14 = FB code, 4 = FB interface
  - 6 = DB declaration
  - 66 = instance DB data (memo starts with ASCII `FB<n>`/`SFB<n>` → instance→FB link)
- `SYMBOLE`: the symbol table (name, absolute address, comment).
- DBF v3 files are parsed by a minimal in-browser reader (`src/mc7/dbf.ts`), no dependencies.

The MC7 code section is the SUBBLK memo; the first bytes are a small header, code starts at
the first BLD/opcode after it (the decoder finds this boundary by construction).

## Instruction encoding

### BLD (listing pseudo-instructions)
`0x10 <n>` — BLD n. Produced by source `BLD` lines and around calls. BLD 103/1 precede a call
sequence; BLD 2 + NOP 0 terminate a `CALL FC` parameter list; BLD 3/4 bracket an FB call frame.

### Bit logic
- Short 2-byte forms (byte address ≤ 255): `op<<4 | bit` then address byte.
  M area: A=0x80, O=0x88, X=0x90, XN=0x98, AN=0xA0, ON=0xA8.
  I area: A=0xC0, O=0xC8, X=0xD0, XN=0xD8, AN=0xE0, ON=0xE8.
  `A T n` = 0xF8, `O T n` = 0xF9, `AN T n` = 0xFC, `ON T n` = 0xFD. Same nibbles for counters with base 0x84/0x85.
- Long 4-byte forms: word1 = `hi | area<<4 | bit`, word2 = byte address (big-endian).
  Area codes: I=0x10, Q=0x20, M=0x30, DB=0x40, DI=0x50, L=0x60.
  A: hi=0x00 (AN: low byte |= 0x80). `=`: hi=0x41.
- R/S: hi=0x09, low byte bit 7 set = R, clear = S. Short M forms: S=0x90+bit, R=0xB0+bit;
  short I forms: ==0xD8+bit, S=0xD0+bit, R=0xF0+bit (only after an OPN DI for I is actually DI).

### Load / transfer
- DB areas: `0x7e4<n>` / L areas `0x7e6<n>` / DI areas `0x7e5<n>`, nibble: 1=L byte, 2=L word,
  3=L dword, 5=T byte, 6=T word, 7=T dword. Second word = byte address.
- Short M forms: 0x0A = L MB, 0x1A = L MD, 0x13 = T MW, 0x1B = T MD.
- Constants: `0x30 0x03 <v16>` = L const16; `0x38 0x03 <v32>` = L const32/REAL;
  `0x30 0x0c <v16>` = L S5T#… (compiler picks the smallest timebase that fits).
- OPN DB: `0x20 <n>` (n ≤ 255) or `0xfb78 <n16>`.

### Logic control / misc
- JNB = 0xFF98, target = instruction start + 2×operand. JU/JC/JCN same scheme (0xFF10/0xFF98 family).
- A( = 0xBA00, O( = 0xB800, ) = 0xBF00, bare O = 0xFB00.
- NOP 0 = 0x0000, BE = 0x6500, SET = 0x681D, NOT = 0x682D.
- Compares: ==I = 0x2180, >=I = 0x21A0 (+ rest of 0x21xx family).
- Arith: +I = 0x7900, -I = 0x5900, +R = 0x600F.
- Timers: SD T = 0x24<t8> (+ family).

### Calls
- `CALL FC n` = `0xfb70 <n16>`, or short `0x3d <n8>`.
- `CALL SFC n` = `0xfb74 <n16>`; `CALL SFB n` = `0xfb76 <n16>`; `UC FB n` = `0x75 <n8>`.

**CALL FC parameter block** (after the CALL opcode):
header `70 0b 00 <NN>` where NN = caller local-temp scratch base (byte), then one 4-byte
descriptor per interface parameter, in interface order:
- `BLOCK_DB`: `00 <DB#> 00 00`; `TIMER`: `00 <T#> 00 00`.
- IN scalar materialized constant: `87 00 <bitaddr16>` pointing into V (caller L) area;
  the value was stored to the scratch area before the call (`T LW/LD` at base+2…).
- IN BOOL M/I: `83/81 00 <bitaddr16>`; IN_OUT/OUT: pointer to the actual argument.
- OUT scalar actuals: compiler allocates scratch (BOOL bits from scratch.1 up, scalars from
  scratch+1 byte), descriptor `87`-style, and copies scratch back to the actual after the call.
- OUT BOOL L actual: direct `87` pointer, no copy-back.
- Terminated by BLD 2 (0x10 02) then NOP 0.
Preamble: BLD 103 and/or BLD 1; `= L <s>.0` preserves RLO into scratch bit s.0.

**CALL FB with instance DB** frame:
1. BLD 3
2. `= L s.0` (RLO to scratch)
3. `0xfb7c` = CDB (swap DB/DI)
4. `0xfb79 <db16>` = OPN DI
5. `0xfe6f <lw16>` = TAR2 LD n (save AR2)
6. Parameter moves into instance data: `41 5n` = `= DIX bit`, `0x7e5n` = L/T DIB/DIW/DID.
7. `0xfe0b 84000000` = LAR2 P#DBX0.0
8. `0x75 <n8>` = UC FB n
9. `0xfe6b <lw16>` = LAR2 LD n (restore AR2)
10. OUT/IN_OUT read-backs from instance to actuals
11. `0xfb7c` = CDB; BLD 4

## Interfaces

- FC interface (SUBBLK type 5) and FB interface (SUBBLK type 4) are little binary structures:
  6-byte header, then per-parameter records: 2-byte type code, name (fixed width), then for
  FBs the instance-data offset. Parsed by `parseFcInterface` / `parseFbInterface` in
  `src/mc7/project.ts`.
- FB instance layout: IN/OUT/IN_OUT/STAT in declaration order; BOOLs bit-packed, everything
  else word-aligned; REAL/TIME/DWORD take 4 bytes; STRUCT members word-aligned.

## Divergence policy

The compiler output is the ground truth for execution, the AWL source for display. Where a
project's symbol table was edited after a block was compiled, the binary still refers to the
old absolute addresses (observed: 44 symbol edits in the ground-truth project — symbols now
named `GD11E12+REM11/12-Q*` at Q100.x/Q101.x while the binary uses I228.x/I229.x, plus two
logic simplifications in FC83/FC20). The decoder trusts the binary and records divergences as
informational notes; nothing is shown as "decompiled" unless it matches a known source exactly.

## Code map

- `src/mc7/decode.ts` — instruction-level decoder (opcode table above).
- `src/mc7/project.ts` — project model: blocks, interfaces, DBs, symbols; snapshot JSON shape.
- `src/mc7/stream.ts` — source-free stream decoder: walks a code section, folds call frames
  into CALL/CALLFB entries, everything else stays instructions. This is what the viewer runs.
- `src/mc7/dbf.ts` — in-browser DBF/DBT reader (imports an offline project folder/zip).
- `src/mc7/render.ts` — stream entries → display STL with symbol/DB-field resolution.
- `tests/mc7_golden.mts` — golden test vs the Python-validated fixtures in `tests/fixtures/`.
