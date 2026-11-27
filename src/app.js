/**
 * طبقة الربط: اللمس ولوحة المفاتيح ← منطق القفل ← العرض.
 *
 * مبدأ هذه الطبقة: كل حدث له سبب مفهوم. كل حيلة تُشرح في أول ظهور لها،
 * وكل فشل يُسمّى في جملة واحدة، وأول محاولة في الجلسة تكون بلا خدع.
 */

import { CONFIG, STRINGS } from './config.js';
import { createLatchLock, PHASE } from './latch-lock.js';
import { createRenderer, toArabicDigits } from './render.js';
import { createSound } from './sound.js';

/**
 * نسخة قابلة للتعديل من الضبط. المنطق يقرأ هذه القيم في كل خطوة،
 * لذلك يتغيّر نطاق الثبات مع اتجاه الشاشة دون إعادة بناء القفل.
 */
const params = {
  ...CONFIG,
  track: { ...CONFIG.track },
  hold: { ...CONFIG.hold, provocation: { ...CONFIG.hold.provocation } },
};

const sound = createSound();

const renderer = createRenderer(document, {
  onLayout(layout) {
    params.track.targetHalfWidth =
      layout === 'portrait'
        ? CONFIG.track.targetHalfWidth * CONFIG.track.touchZoneMultiplier
        : CONFIG.track.targetHalfWidth;
  },
});

/* التدريب: المحاولة الأولى في الجلسة بلا استفزازات إطلاقاً. */
params.hold.provocation.count = 0;
let training = Boolean(CONFIG.training.cleanAttempts);

const lock = createLatchLock(params);

const appEl = document.getElementById('app');
const rig = document.getElementById('rig');
const replayBtn = document.getElementById('replayBtn');
const soundBtn = document.getElementById('soundBtn');

/** شرح كل نوع في أول ظهور له في الجلسة. */
const TEACHING = {
  shift: 'teachShift',
  squeeze: 'teachSqueeze',
  shove: 'teachShove',
  decoy: 'teachDecoy',
  stall: 'teachStall',
};

const seenKinds = new Set();
let lastHasteAt = Number.NEGATIVE_INFINITY;
let completionEpoch = 0;
let lastTs = performance.now();
let lastProvokeKind = null;
let lastProvokeAt = Number.NEGATIVE_INFINITY;
let lastFailCause = null;
let lastZone = 'rest';
let lastZoneSoundAt = Number.NEGATIVE_INFINITY;

const now = () => performance.now();

/* --------------------------------------------------------------------------
   الفشل: اسم السبب قبل أي شيء آخر
   -------------------------------------------------------------------------- */

function failText(event) {
  if (event.reason === 'released') {
    const percent = Math.round((event.progress ?? 0) * 100);
    return percent > 0 ? STRINGS.failReleased(toArabicDigits(percent)) : STRINGS.failReleasedEarly;
  }

  const recent = now() - lastProvokeAt < 1800 ? lastProvokeKind : null;
  if (recent === 'shift') return STRINGS.failLeftShift;
  if (recent === 'squeeze') return STRINGS.failLeftSqueeze;
  return STRINGS.failLeft;
}

function endTraining({ announce = true } = {}) {
  if (!training) return;
  training = false;
  params.hold.provocation.count = CONFIG.hold.provocation.count;
  if (!announce) return;
  window.setTimeout(() => {
    renderer.showNotice(STRINGS.tricksBegin, 'warn', { life: 4200 });
  }, 1600);
}

function onFail(event) {
  sound.play('fail');
  lastHasteAt = now();

  const sarcastic =
    event.failCount >= CONFIG.fail.sarcasmAfter &&
    (event.failCount - CONFIG.fail.sarcasmAfter) % CONFIG.fail.sarcasmEvery === 0;

  renderer.showNotice(sarcastic ? STRINGS.impatience : STRINGS.lostStillness, 'taunt', {
    life: 3600,
  });
  renderer.announceGuide(failText(event), 5600);
  lastFailCause = event.reason;
  endTraining();
}

function completionReport(snapshot) {
  const attempts = snapshot.failCount + 1;
  const parts = [STRINGS.doneReportAttempts(toArabicDigits(attempts))];
  if (lastFailCause) {
    parts.push(
      STRINGS.doneReportReason(
        lastFailCause === 'left' ? STRINGS.reasonLeft : STRINGS.reasonReleased,
      ),
    );
  }
  return parts.join(' · ');
}

function onUnlock() {
  sound.play('unlock');
  renderer.showNotice(STRINGS.success, 'success', { life: 3200 });
  endTraining({ announce: false });

  const report = completionReport(lock.snapshot());
  const epoch = ++completionEpoch;
  window.setTimeout(() => {
    if (epoch !== completionEpoch) return;
    renderer.hideNotice();
    renderer.showCompletion(report);
  }, 1900);
}

function onProvoke(event) {
  sound.play(event.kind);
  lastProvokeKind = event.kind;
  lastProvokeAt = now();

  const firstTime = !seenKinds.has(event.kind);
  seenKinds.add(event.kind);

  const key = firstTime ? TEACHING[event.kind] : event.notice;
  const text = STRINGS[key];
  if (text) renderer.showNotice(text, 'taunt', { life: firstTime ? 5600 : 3000 });
}

function handleEvents(events) {
  for (const event of events) {
    switch (event.type) {
      case 'holdStart':
        sound.play('hold');
        break;

      case 'recoil':
        sound.play('recoil');
        if (now() - lastHasteAt > CONFIG.notice.hasteCooldownMs) {
          lastHasteAt = now();
          renderer.showNotice(STRINGS.haste, 'warn', { life: 3200 });
        }
        break;

      case 'provoke':
        onProvoke(event);
        break;

      case 'fail':
        onFail(event);
        break;

      case 'unlock':
        onUnlock();
        break;

      default:
        break;
    }
  }
}

/** صوت خفيف عند الدخول والخروج من الإطار — نفس المعلومة التي يراها اللاعب. */
function watchZone(snapshot) {
  const zone = appEl.dataset.zone ?? 'rest';
  if (zone === lastZone) return;
  const changed = lastZone;
  lastZone = zone;

  if (!snapshot.grabbed || now() - lastZoneSoundAt < 220) return;
  if (zone === 'in' && changed !== 'rest') sound.play('zoneIn');
  else if (zone === 'out') sound.play('zoneOut');
  lastZoneSoundAt = now();
}

/* --------------------------------------------------------------------------
   اللمس والسحب
   -------------------------------------------------------------------------- */

rig.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  if (lock.snapshot().phase === PHASE.OPEN) return;

  const fraction = renderer.fractionFromClient(event.clientX, event.clientY);
  if (fraction === null) return;

  const events = lock.grab(fraction);
  if (!events.length) return;

  event.preventDefault();
  rig.focus({ preventScroll: true });
  try {
    rig.setPointerCapture(event.pointerId);
  } catch {
    /* بعض المتصفحات القديمة لا تدعم الالتقاط؛ السحب يبقى يعمل داخل العنصر. */
  }
  renderer.releaseGuide();
  sound.play('grab');
  handleEvents(events);
});

rig.addEventListener('pointermove', (event) => {
  if (!lock.snapshot().grabbed) return;
  const fraction = renderer.fractionFromClient(event.clientX, event.clientY);
  if (fraction === null) return;
  handleEvents(lock.move(fraction));
});

function endDrag() {
  if (!lock.snapshot().grabbed) return;
  rig.classList.remove('is-grabbed');
  handleEvents(lock.release());
}

rig.addEventListener('pointerup', endDrag);
rig.addEventListener('pointercancel', endDrag);
rig.addEventListener('contextmenu', (event) => event.preventDefault());
rig.addEventListener('dragstart', (event) => event.preventDefault());

/* --------------------------------------------------------------------------
   لوحة المفاتيح
   -------------------------------------------------------------------------- */

rig.addEventListener('keydown', (event) => {
  const state = lock.snapshot();

  if (event.key === ' ' || event.key === 'Enter' || event.key === 'Spacebar') {
    event.preventDefault();
    if (state.phase === PHASE.OPEN) return;
    if (state.grabbed) {
      handleEvents(lock.release());
      rig.classList.remove('is-grabbed');
    } else {
      handleEvents(lock.grab(state.position));
      renderer.releaseGuide();
      sound.play('grab');
    }
    return;
  }

  const isArrow = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key);
  if (!isArrow) return;
  event.preventDefault();
  if (!state.grabbed) return;

  // نحو الهدف: يسار/أعلى في المسار الأفقي والرأسي على السواء.
  const towardsTarget = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
  handleEvents(lock.nudge(towardsTarget ? -CONFIG.input.keyStep : CONFIG.input.keyStep));
});

/* --------------------------------------------------------------------------
   أزرار الواجهة
   -------------------------------------------------------------------------- */

replayBtn?.addEventListener('click', () => {
  completionEpoch += 1;
  renderer.hideCompletion();
  renderer.hideNotice();
  renderer.releaseGuide();
  lastFailCause = null;
  seenKinds.clear();
  lock.reset();
  renderer.render(lock.snapshot());
  renderer.focusRig();
});

document.getElementById('done')?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') replayBtn?.click();
});

soundBtn?.addEventListener('click', () => {
  renderer.setSoundLabel(sound.toggle());
});

/* --------------------------------------------------------------------------
   الحلقة الرئيسية
   -------------------------------------------------------------------------- */

function frame(timestamp) {
  const dt = Math.min(0.05, Math.max(0, (timestamp - lastTs) / 1000));
  lastTs = timestamp;

  handleEvents(lock.tick(dt));
  const snapshot = lock.snapshot();
  renderer.render(snapshot);
  watchZone(snapshot);

  requestAnimationFrame(frame);
}

renderer.setSoundLabel(sound.enabled);
renderer.render(lock.snapshot());
requestAnimationFrame(frame);

document.addEventListener('visibilitychange', () => {
  lastTs = performance.now();
});
