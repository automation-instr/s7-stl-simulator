export const EXAMPLES = [
  { id: 'motor', name: 'Start / Stop', hint: 'I0.0 start, I0.1 stop, Q0.0 motor', code:
`// Start/Stop with seal-in (self-holding)
// I0.0 = Start button    I0.1 = Stop button    Q0.0 = Motor
// The bracket ORs (Start or Q0.0) first, then ANDs with Stop
      A(
      O     I0.0
      O     Q0.0
      )
      AN    I0.1
      =     Q0.0
` },
  { id: 'blink', name: 'Timer blinker', hint: 'I0.0 enable. Q0.0 blinks every second', code:
`// Blinker: Q0.0 on for 1 s, off for 1 s
// I0.0 = Enable switch
      A     I0.0
      AN    T2
      L     S5T#1S
      SD    T1        // on-delay 1 s
      A     T1
      L     S5T#1S
      SD    T2        // T2 breaks T1 after another second
      A     T1
      =     Q0.0
` },
  { id: 'count', name: 'Counter', hint: 'I0.0 count up, I0.1 count down, I0.2 preset 5, I0.3 reset', code:
`// Counter C1
// I0.0 = CU (count up)   I0.1 = CD (count down)
// I0.2 = preset value 5   I0.3 = reset
      A     I0.0
      CU    C1
      A     I0.1
      CD    C1
      A     I0.2
      L     C#5
      S     C1
      A     I0.3
      R     C1
      A     C1        // C1 is not zero
      =     Q0.0
      L     C1
      L     3
      >=I             // C1 >= 3 ?
      =     Q0.1
` },
  { id: 'jump', name: 'Jump and compare', hint: 'I0.0=1 loads 10 into MW10, otherwise 50', code:
`// Conditional jump and integer compare
// If I0.0 = 1  ->  MW10 = 10    else  MW10 = 50
// Q0.0 = (MW10 > 20)
      A     I0.0
      JC   M001
      L     50
      T     MW10
      JU   M002
M001: L     10
      T     MW10
M002: L     MW10
      L     20
      >I
      =     Q0.0
` },
  { id: 'ton', name: 'On-delay timer (S_ODT)', hint: 'I0.0 turns Q0.0 on after 5 s. I0.1 resets', code:
`// On-delay (S_ODT) 5 seconds
// I0.0 = timer input    I0.1 = reset    Q0.0 = output after the delay
      A     I0.0
      L     S5T#5S
      SD    T1
      A     T1
      =     Q0.0
      A     I0.1
      R     T1
` },
  { id: 'db', name: 'Data block (DB)', hint: 'Each I0.0 press adds 1 to DB1.DBW0. Q0.0 when value >= 3', code:
`// Store a counter in DB1
// Each time I0.0 is pressed, DB1.DBW0 increases by 1
      OPN   DB1
      A     I0.0
      FP    M10.0
      JCN  M001
      L     DBW0
      +     1
      T     DBW0
M001: L     DBW0
      L     3
      >=I
      =     Q0.0
      A     I0.1
      JCN  M002
      L     0
      T     DBW0       // I0.1 = reset
M002: NOP   0
` },
  { id: 'real', name: 'REAL math', hint: 'MD2 = 100 / 3.0. Q0.0 when result > 30.0', code:
`// Floating-point (REAL) calculation
      L     100
      T     MW10
      L     MW10
      ITD             // INT -> DINT
      DTR             // DINT -> REAL
      L     3.0
      /R              // 100.0 / 3.0
      T     MD2
      L     MD2
      L     30.0
      >R              // 33.33 > 30.0 ?
      =     Q0.0
` },
  { id: 'shift', name: 'Bit shifts', hint: 'MW20 = 1 shifted left 3, MW22 = 0xF0 shifted right 4', code:
`// Bit shifts
      L     1
      SLW   3
      T     MW20      // = 8
      L     W#16#00F0
      SRW   4
      T     MW22      // = 15 (0x0F)
      L     W#16#00F0
      L     W#16#003C
      AW              // AND of ACCU1 and ACCU2
      T     MW24
` },
];
