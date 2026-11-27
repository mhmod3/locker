/**
 * طبقة الربط: اللمس ولوحة المفاتيح ← منطق القفل ← العرض.
 */

import { CONFIG, STRINGS } from './config.js';
import { createLatchLock, PHASE } from './latch-lock.js';
import { createRenderer } from './render.js';
import { createSound } from './sound.js';

const renderer = createRenderer(document);
const lock = createLatchLock(CONFIG);
const sound = createSound();

const rig = document.getElementById('rig');
const replayBtn = document.getElementById('replayBtn');
const soundBtn = document.getElementById('soundBtn');

let lastHasteAt = Number.NEGATIVE_INFINITY;
let completionEpoch = 0;
let lastTs = performance.now();

const now = () => performance.now();

function onFail(event) {
  sound.play('fail');
  lastHasteAt = now();

  const sarcastic =
    event.failCount >= CONFIG.fail.sarcasmAfter &&
    (event.failCount - CONFIG.fail.sarcasmAfter) % CONFIG.fail.sarcasmEvery === 0;

  renderer.showNotice(sarcastic ? STRINGS.impatience : STRINGS.lostStillness, 'taunt');
}

function onUnlock() {
  sound.play('unlock');
  renderer.showNotice(STRINGS.success, 'success', { life: 3200 });

  const epoch = ++completionEpoch;
  window.setTimeout(() => {
    if (epoch !== completionEpoch) return;
    renderer.hideNotice();
    renderer.showCompletion();
  }, 1900);
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

      case 'provoke': {
        sound.play(event.kind);
        const text = STRINGS[event.notice];
        if (text) renderer.showNotice(text, 'taunt', { life: 3000 });
        break;
      }

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
  renderer.render(lock.snapshot());

  requestAnimationFrame(frame);
}

renderer.setSoundLabel(sound.enabled);
renderer.render(lock.snapshot());
requestAnimationFrame(frame);

document.addEventListener('visibilitychange', () => {
  lastTs = performance.now();
});
