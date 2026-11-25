export const EXAMPLES = [
  { id: 'motor', name: 'ستارت / ستوب', hint: 'I0.0 ستارت، I0.1 ستوب، Q0.0 الموتور', code:
`// ستارت/ستوب مع Seal-in (التثبيت الذاتي)
// I0.0 = زر Start    I0.1 = زر Stop    Q0.0 = الموتور
// القوس بيجمع (Start أو Q0.0) الأول وبعدين AND مع Stop
      A(
      O     I0.0
      O     Q0.0
      )
      AN    I0.1
      =     Q0.0
` },
  { id: 'blink', name: 'وميض بتايمر', hint: 'I0.0 تشغيل. Q0.0 بيومض كل ثانية', code:
`// وميض: Q0.0 شغال ثانية وفاصل ثانية
// I0.0 = مفتاح التشغيل
      A     I0.0
      AN    T2
      L     S5T#1S
      SE    T1        // تأخير تشغيل 1 ثانية
      A     T1
      L     S5T#1S
      SE    T2        // T2 بيقطع T1 بعد ثانية تانية
      A     T1
      =     Q0.0
` },
  { id: 'count', name: 'عداد', hint: 'I0.0 زيادة، I0.1 نقصان، I0.2 تحميل 5، I0.3 ريست', code:
`// عداد C1
// I0.0 = ZV (زيادة)   I0.1 = ZR (نقصان)
// I0.2 = تحميل القيمة 5   I0.3 = ريست
      A     I0.0
      ZV    C1
      A     I0.1
      ZR    C1
      A     I0.2
      L     C#5
      S     C1
      A     I0.3
      R     C1
      A     C1        // C1 مش صفر
      =     Q0.0
      L     C1
      L     3
      >=I             // C1 >= 3 ؟
      =     Q0.1
` },
  { id: 'jump', name: 'قفز ومقارنة', hint: 'I0.0=1 يحمل 10 في MW10 وإلا 50', code:
`// قفز شرطي ومقارنة أعداد
// لو I0.0 = 1  ->  MW10 = 10    وإلا  MW10 = 50
// Q0.0 = (MW10 > 20)
      A     I0.0
      SPB   M001
      L     50
      T     MW10
      SPA   M002
M001: L     10
      T     MW10
M002: L     MW10
      L     20
      >I
      =     Q0.0
` },
  { id: 'ton', name: 'تأخير تشغيل SE', hint: 'I0.0 بيشغل Q0.0 بعد 5 ثواني. I0.1 ريست', code:
`// تأخير تشغيل (S_ODT) 5 ثواني
// I0.0 = دخل التايمر    I0.1 = ريست    Q0.0 = خرج بعد التأخير
      A     I0.0
      L     S5T#5S
      SE    T1
      A     T1
      =     Q0.0
      A     I0.1
      R     T1
` },
  { id: 'db', name: 'داتا بلوك DB', hint: 'I0.0 يزود DB1.DBW0 كل ضغطة. Q0.0 لما القيمة >= 3', code:
`// تخزين عداد في DB1
// كل مرة I0.0 تضغط، DB1.DBW0 يزيد 1
      OPN   DB1
      A     I0.0
      FP    M10.0
      SPBN  M001
      L     DBW0
      +     1
      T     DBW0
M001: L     DBW0
      L     3
      >=I
      =     Q0.0
      A     I0.1
      SPBN  M002
      L     0
      T     DBW0       // I0.1 = ريست
M002: NOP   0
` },
  { id: 'real', name: 'أعداد REAL', hint: 'MD2 = 100 / 3.0. Q0.0 لما النتيجة > 30.0', code:
`// حساب بالأعداد الحقيقية (REAL)
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
      >R              // 33.33 > 30.0 ؟
      =     Q0.0
` },
  { id: 'shift', name: 'إزاحة بتات', hint: 'MW20 = 1 إزاحة يسار 3، MW22 = 0xF0 إزاحة يمين 4', code:
`// إزاحة بتات
      L     1
      SLW   3
      T     MW20      // = 8
      L     W#16#00F0
      SRW   4
      T     MW22      // = 15 (0x0F)
      L     W#16#00F0
      L     W#16#003C
      AW              // AND بين ACCU1 وACCU2
      T     MW24
` },
];
