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
- Jumps: 4-byte, target = instruction start + 2×operand (words). 0x7008 LOOP, 0x7009 JL,
  0x700B JU, 0xFF08 JOS, 0xFF18 JO, 0xFF28 JP, 0xFF48 JM, 0xFF58 JUO, 0xFF68 JN,
  0xFF78 JNBI, 0xFF88 JZ, 0xFF98 JNB, 0xFFB8 JCN, 0xFFD8 JCB, 0xFFE8 JBI, 0xFFF8 JC.
- Status-bit logic (2B): 0xFF <status><op>: status nibble 0x00 OS, 0x10 OV, 0x20 >0, 0x40 <0,
  0x50 UO, 0x60 <>0, 0x80 ==0, 0xE0 BR; op low nibble 0-5 = A/AN/O/ON/X/XN.
- A( = 0xBA00, O( = 0xB800, ) = 0xBF00, bare O = 0xFB00.
- NOP 0 = 0x0000, NOP 1 = 0xFFFF, BE = 0x6500, BEU = 0x6501, BEC = 0x0500, SET = 0x681D,
  NOT = 0x682D, CLR = 0x681C, SAVE = 0x682C, TAK = 0x7002.
- Compares: 0x21xx INT, 0x39xx DINT, 0x31xx REAL, low byte 0x20/0x40/0x60/0x80/0xA0/0xC0 =
  > / >= / <> / == / < / <=.
- Accu logic: AW = 0x4100, OW = 0x4900, XOD = 0x6857; NEGI = 0x0900, NEGD = 0x6807,
  NEGR = 0x6006, INVI = 0x0100, INVD = 0x680D.
- Arith: +I = 0x7900, -I = 0x5900, *I = 0x6004, /I = 0x6000, +D = 0x600D, -D = 0x6009,
  *D = 0x600A, /D = 0x600E, +R = 0x600F, -R = 0x600B, *R = 0x6007, /R = 0x6003, MOD = 0x6001,
  ABS = 0x6002, ENT = 0x6008; float fns SIN/COS/TAN/LN/SQRT/ASIN/ACOS/ATAN/EXP/SQR =
  0x6010-0x601C; RND/RND-/RND+/TRUNC = 0x685C-0x685F.
- Convert/shift: ITD = 0x681E, DTR = 0x6806, ITB = 0x6808, DTB = 0x680A, BTI = 0x680C,
  BTD = 0x680E, CAW = 0x681A, CAD = 0x681B, SLW = 0x6812, SLD = 0x6813, SRW = 0x6822,
  SRD = 0x6823, SSI = 0x6824, SSD = 0x6825, RLD = 0x6817, RLDA = 0x6818.
- AR1/AR2: LAR1 = 0xFE04, LAR2 = 0xFE0C, TAR1 = 0xFE05, TAR2 = 0xFE0D, CAR = 0xFE08,
  +AR1 = 0xFE06, +AR2 = 0xFE0E, LAR1 AR2 = 0xFE01, TAR1 AR2 = 0xFE09,
  LAR1/TAR1 LD n = 0xFE63/0xFE67, LAR2/TAR2 LD n = 0xFE6B/0xFE6F.
- Timers: SD T = 0x24<t8> (+ family); 16-bit timer/counter numbers (T256+/C256+):
  0xFB Ex (timers) / 0xFB Fx (counters): A/AN/O/ON/X/XN/L/FR/LC + SF/SE/SD/SS/SP or CD/S/CU, R.
- PARAMETER access (inside blocks with an interface): 0xFB 80-D8, operand = 2×(param index+1)
  over the non-TEMP params in text order: 80-85 A/AN/O/ON/X/XN, 90 S, 91 R, 92 =, 94 FP, 95 FN,
  A0-AF timer ops, B0-BF counter ops, C1/C2/C3 L B/W/D, C5/C6/C7 T B/W/D,
  D0 UC BLOCK_FC, D2 UC BLOCK_FB, D8 OPN BLOCK_DB. Renders as `#name` from the stored interface.

### Register-indirect addressing (16-bit pointer operand, byte = arg>>3, bit = arg&7)
- 0x79xx bit ops: low-nibble-high group 1-6 = A/AN/O/ON/X/XN (op = lo&7), areas
  I/Q/M/DBX/DIX/L; group 9-14 = S/R/=/FP/FN same areas; bit 0x08 = AR2 (else AR1).
- 0xBExx L/T: area by hi nibble (1=I,2=Q,3=M,4=DB,5=DI,6=L, 0 = area-less pointer),
  size/op by lo&7 (1/2/3 = L B/W/D, 5/6/7 = T B/W/D), bit 3 = AR2.
- 0xFB 01-0F: L/T B/W/D [ARn,P#X] area-less; 0xFB 10-1D / 20-2D: bit ops [ARn,P#X].
- 0xFB 68/69: OPN DB/DI [LW n]; UC/CC FC/FB [MW/DBW/DIW/LW n] = 0xFB 30-33/41/43/51/53/60-63.
- Literals: 0x38 04 <area8><bitaddr24> = L P# literal; 0x38 01 REAL, 0x38 02 binary32,
  0x38 06 B#(x,x,x,x), 0x38 07 DW#16#, 0x38 09 T#, 0x38 0B TOD#;
  0x30 02 binary16, 0x30 05 CHAR, 0x30 06 B#(x,x), 0x30 07 W#16#, 0x30 08 C#, 0x30 0A D#.
- 0xFB CB <ptr16> = L P# (16-bit pointer literal). Context-inferred (always feeds LAR1/+AR1
  in the ground-truth project), not in the public reference.
- UC FC/FB n8 = 0x3D/0x75; CC FC/FB n8 = 0x1D/0x55.

### Calls
- `CALL FC n` = `0xfb70 <n16>`, or short `0x3d <n8>`.
- `CALL SFC n` = `0xfb74 <n16>`; `CALL SFB n` = `0xfb76 <n16>`; `UC FB n` = `0x75 <n8>`.
- Frames also appear WITHOUT the scratch preamble (starts directly at fb70/fb74); the
  stream decoder folds those too (same JU-operand parameter count).

**CALL FC/SFC parameter block** (after the CALL opcode):
header `70 0b 00 <NN>` is literally `JU +NN words` jumping over the descriptor block, with
NN = 2×nparams + 2. SFC calls (and FC calls whose interface subblock is missing) fold
generically from NN alone; FC calls with a stored interface use its parameter names.
Then one 4-byte descriptor per interface parameter, in interface order:
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
