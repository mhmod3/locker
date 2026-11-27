/**
 * ملف الضبط الموحّد للقفل الأول.
 * كل الأرقام القابلة للمعايرة في CONFIG، وكل النصوص في STRINGS.
 * لا يوجد نص عربي مكتوب خارج هذا الملف.
 */

export const CONFIG = Object.freeze({
  /** هندسة المسار — نسب من طول المسار (0 = أقصى اليسار، 1 = أقصى اليمين). */
  track: {
    start: 0.82, // نقطة سكون المزلاج
    targetCenter: 0.28, // مركز علامة الهدف
    targetHalfWidth: 0.06, // نصف عرض نطاق الثبات (النطاق الكامل 12% من المسار)
    minPosition: 0.04,
    maxPosition: 0.96,
  },

  /** نابض متابعة المزلاج: صلابة عالية وتخميد فوق الحرج — متابعة قريبة بلا تجاوز. */
  spring: {
    stiffness: 205,
    damping: 29,
  },

  input: {
    grabTolerance: 0.085,
    keyStep: 0.01,
  },

  /** كتم الاندفاع. */
  speed: {
    maxTrackPerSecond: 0.55,
    strainRate: 5,
    strainDecay: 2.4,
    recoilImpulse: 1.15,
    inputLockMs: 300,
  },

  /** الثبات عند الهدف. */
  hold: {
    durationMs: 2700,
    drainMs: 620,
    /** خروج متصل أطول من هذا يُفشل المحاولة (سماح قصير لردّ الفعل). */
    outsideToleranceMs: 320,
    /** سرعة انزلاق العلامة وتغيّر عرض النطاق (1/ث). */
    centerEase: 18,
    widthEase: 16,

    /**
     * استفزازات عشوائية لكل محاولة: الأوقات والأنواع والاتجاهات تُسحب من هنا،
     * فلا يمكن حفظ نمط المحاولة السابقة.
     */
    provocation: {
      count: 3,
      extraChance: 0.4,
      timing: {
        first: [380, 700], // أول استفزاز، بالمللي ثانية من بدء الثبات
        gap: [640, 840],
        latest: 2150,
        extra: [2300, 2500], // استفزاز بصري إضافي (باحتمال extraChance)
      },
      kinds: {
        shift: { offset: [0.016, 0.032], duration: [900, 1350], notice: 'provokeShift' },
        squeeze: { scale: [0.6, 0.72], duration: [620, 800], notice: 'provokeSqueeze' },
        shove: { impulse: [0.26, 0.44], notice: 'provokeShove' },
        decoy: { offset: [0.11, 0.18], duration: [420, 560], notice: 'provokeDecoy' },
        stall: { rate: 0.42, duration: [500, 680], notice: 'provokeStall' },
      },
    },
  },

  fail: {
    sarcasmAfter: 3,
    sarcasmEvery: 3,
  },

  notice: {
    lifeMs: 4200,
    hasteCooldownMs: 1500,
  },
});

/** كل نصوص الواجهة. استبدل القيم وحدها لتغيير النبرة. */
export const STRINGS = Object.freeze({
  gameTitle: 'الخزنة العنيدة',
  lockIndex: 'القفل ٠١',
  lockName: 'المزلاج الكتوم',

  guidance: 'أوصل المزلاج إلى العلامة واثبت حتى يكتمل القفل.',
  hint: 'سحب بطيء، ثم ثبات.',
  readout: 'الثبات',

  haste: 'الاندفاع لا يفتح الأقفال؛ تمهّل.',
  provoke: 'الآن فقط يبدأ الاختبار الحقيقي... لا تتحرك.',
  provokeShift: 'العلامة ليست وعداً.',
  provokeSqueeze: 'الخزنة تضيّق عليك.',
  provokeShove: 'دفعة صغيرة. اختبر ردّ فعلك.',
  provokeDecoy: 'هناك. أليس هناك؟',
  provokeStall: 'الوقت يتباطأ كلما اقتربت.',
  provokeLate: 'لحظة واحدة تفصلك. لا تُفسدها.',
  lostStillness: 'خنت الثبات في اللحظة الأخيرة.',
  impatience: 'العجلة من الخزنة... والصبر ليس من صفاتك بعد.',
  success: 'استجاب المزلاج على مضض.',

  completionTitle: 'فُتح القفل الأول',
  completionSubtitle: 'استجاب المزلاج على مضض.',
  nextLock: 'القفل الثاني قيد التصنيع.',
  replay: 'أعِد المحاولة',

  soundOn: 'الصوت مفتوح',
  soundOff: 'الصوت مكتوم',

  a11yLabel: 'مزلاج القفل الأول',
  a11yHelp:
    'اضغط مفتاح المسافة للإمساك بالمزلاج، ثم حرّكه بمفاتيح الأسهم يميناً ويساراً. ابقَ داخل الهدف حتى يكتمل عدّاد الثبات، ثم اضغط المسافة لإفلاته.',
  a11yIdle: 'المزلاج عند نقطة البداية.',
  a11yMoving: 'المزلاج خارج الهدف.',
  a11yDraining: 'خارج الهدف، عدّاد الثبات يتفرّغ.',
  a11yHolding: (percent) => `داخل الهدف، تقدّم الثبات ${percent} بالمئة.`,
  a11yOpen: 'القفل الأول مفتوح.',
});
