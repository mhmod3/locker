import test from 'node:test';
import assert from 'node:assert/strict';

import { createLatchLock, PHASE } from '../src/latch-lock.js';
import { CONFIG } from '../src/config.js';

const DT = 1 / 60;

function tickFor(lock, seconds, { collect = true } = {}) {
  const events = [];
  let elapsed = 0;
  while (elapsed < seconds - 1e-9) {
    const step = Math.min(DT, seconds - elapsed);
    const frame = lock.tick(step);
    if (collect) events.push(...frame);
    elapsed += step;
  }
  return events;
}

/** سحب تدريجي بسرعة آمنة من نقطة إلى نقطة. */
function dragSlowly(lock, from, to, seconds) {
  const frames = Math.max(1, Math.round(seconds / DT));
  const events = [];
  for (let i = 1; i <= frames; i += 1) {
    const fraction = from + ((to - from) * i) / frames;
    events.push(...lock.move(fraction));
    events.push(...lock.tick(DT));
  }
  return events;
}

function startDrag(lock = createLatchLock()) {
  lock.grab(CONFIG.track.start);
  lock.tick(DT);
  return lock;
}

test('يبدأ المزلاج ساكناً عند نقطة البداية وعدّاد الثبات فارغ', () => {
  const lock = createLatchLock();
  const s = lock.snapshot();
  assert.equal(s.phase, PHASE.IDLE);
  assert.equal(s.position, CONFIG.track.start);
  assert.equal(s.progress, 0);
  assert.equal(s.grabbed, false);
});

test('الالتقاط لا يحدث بعيداً عن المزلاج', () => {
  const lock = createLatchLock();
  const events = lock.grab(CONFIG.track.targetCenter);
  assert.deepEqual(events, []);
  assert.equal(lock.snapshot().grabbed, false);
});

test('السحب الهادئ ثم الثبات يكمل القفل بلا ارتداد', () => {
  const lock = startDrag();
  const events = dragSlowly(lock, CONFIG.track.start, CONFIG.track.targetCenter, 1.8);

  assert.equal(events.some((e) => e.type === 'recoil'), false);
  assert.ok(lock.snapshot().progress > 0);
  assert.equal(lock.snapshot().phase, PHASE.HOLDING);

  const holdEvents = tickFor(lock, CONFIG.hold.durationMs / 1000 + 0.4);
  const unlock = holdEvents.find((e) => e.type === 'unlock');

  assert.ok(unlock, 'يجب أن يُفتح القفل بعد مدة الثبات');
  assert.equal(lock.snapshot().phase, PHASE.OPEN);
  assert.equal(lock.snapshot().progress, 1);
  assert.equal(lock.snapshot().unlockCount, 1);
});

test('استفزازان في المحاولة الواحدة: الأول بإشعار والثاني صامت', () => {
  const lock = startDrag();
  dragSlowly(lock, CONFIG.track.start, CONFIG.track.targetCenter, 1.8);
  const events = tickFor(lock, 2.9);
  const provocations = events.filter((e) => e.type === 'provoke');

  assert.equal(provocations.length, CONFIG.hold.provocations.length);
  assert.equal(provocations[0].notice, 'provoke');
  assert.equal(provocations[provocations.length - 1].notice, null);
});

test('السحب السريع يُنتج ارتداداً ميكانيكياً ولا يكمل القفل', () => {
  const lock = startDrag();
  let fraction = CONFIG.track.start;
  const events = [];

  for (let i = 0; i < 30; i += 1) {
    fraction -= 0.03; // 1.8 من المسار في الثانية — أسرع من الحد المسموح
    events.push(...lock.move(fraction));
    events.push(...lock.tick(DT));
  }

  assert.ok(events.some((e) => e.type === 'recoil'), 'يجب أن يرتد المزلاج عند التسرّع');
  assert.equal(events.some((e) => e.type === 'unlock'), false);
  assert.equal(lock.snapshot().phase, PHASE.DRAGGING);
  assert.ok(lock.snapshot().strain < 1);
});

test('مغادرة نطاق الهدف أثناء الثبات تُفشل المحاولة وتُعيد المزلاج إلى البداية', () => {
  const lock = startDrag();
  dragSlowly(lock, CONFIG.track.start, CONFIG.track.targetCenter, 1.8);
  tickFor(lock, 0.45);
  assert.equal(lock.snapshot().phase, PHASE.HOLDING);

  const events = dragSlowly(lock, CONFIG.track.targetCenter, CONFIG.track.targetCenter + 0.11, 0.6);
  const failure = events.find((e) => e.type === 'fail');

  assert.ok(failure, 'يجب أن تُحتسب مغادرة النطاق فشلاً');
  assert.equal(failure.reason, 'left');
  assert.equal(failure.failCount, 1);
  assert.equal(lock.snapshot().targetCenter, CONFIG.track.targetCenter);
  assert.equal(lock.snapshot().grabbed, false);

  tickFor(lock, CONFIG.hold.drainMs / 1000 + 0.2);
  assert.equal(lock.snapshot().progress, 0);

  tickFor(lock, 2.5);
  assert.ok(Math.abs(lock.snapshot().position - CONFIG.track.start) < 0.005);
});

test('إفلات المزلاج داخل الهدف قبل الاكتمال فشلٌ أيضاً', () => {
  const lock = startDrag();
  dragSlowly(lock, CONFIG.track.start, CONFIG.track.targetCenter, 1.8);
  tickFor(lock, 0.5);

  const events = lock.release();
  const failure = events.find((e) => e.type === 'fail');

  assert.ok(failure);
  assert.equal(failure.reason, 'released');
  assert.equal(lock.snapshot().phase, PHASE.IDLE);
});

test('الإفلات خارج نطاق الهدف لا يُحتسب فشلاً', () => {
  const lock = startDrag();
  dragSlowly(lock, CONFIG.track.start, CONFIG.track.targetCenter + 0.12, 1.2);
  assert.equal(lock.snapshot().phase, PHASE.DRAGGING);

  const events = lock.release();
  assert.equal(events.some((e) => e.type === 'fail'), false);
  assert.equal(lock.snapshot().phase, PHASE.IDLE);
});

test('العدّاد يتفرّغ بنعومة بعد الفشل لا بقفزة', () => {
  const lock = startDrag();
  dragSlowly(lock, CONFIG.track.start, CONFIG.track.targetCenter, 1.8);
  tickFor(lock, 1.4);
  const charged = lock.snapshot().progress;
  assert.ok(charged > 0.4);

  const events = lock.release();
  assert.ok(events.some((e) => e.type === 'fail'));

  tickFor(lock, 0.18);
  const midway = lock.snapshot().progress;
  assert.ok(midway > 0 && midway < charged, 'يجب أن ينخفض التدريج لا أن يقفز إلى الصفر');

  tickFor(lock, CONFIG.hold.drainMs / 1000);
  assert.equal(lock.snapshot().progress, 0);
});

test('تكرار الخطأ يتراكم في عدّاد الإخفاقات', () => {
  const lock = createLatchLock();

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    lock.grab(CONFIG.track.start);
    dragSlowly(lock, CONFIG.track.start, CONFIG.track.targetCenter, 1.8);
    tickFor(lock, 0.4);
    const events = lock.release();
    assert.ok(events.some((e) => e.type === 'fail'));
    tickFor(lock, 2.4);
  }

  assert.equal(lock.snapshot().failCount, 3);
});

test('المزلاج المفتوح يرفض أي التقاط جديد، وإعادة الضبط تُرجع كل شيء', () => {
  const lock = startDrag();
  dragSlowly(lock, CONFIG.track.start, CONFIG.track.targetCenter, 1.8);
  tickFor(lock, CONFIG.hold.durationMs / 1000 + 0.4);
  assert.equal(lock.snapshot().phase, PHASE.OPEN);

  assert.deepEqual(lock.grab(lock.snapshot().position), []);
  assert.equal(lock.snapshot().phase, PHASE.OPEN);

  lock.reset();
  const s = lock.snapshot();
  assert.equal(s.phase, PHASE.IDLE);
  assert.equal(s.position, CONFIG.track.start);
  assert.equal(s.progress, 0);
  assert.equal(s.unlockCount, 0);
  assert.equal(s.failCount, 0);
});

test('خطوات لوحة المفاتيح بطيئة بما يكفي ولا تُطلق الارتداد', () => {
  const lock = startDrag();
  const events = [];
  for (let i = 0; i < 60; i += 1) {
    events.push(...lock.nudge(-CONFIG.input.keyStep));
    events.push(...lock.tick(DT));
  }
  assert.equal(events.some((e) => e.type === 'recoil'), false);
  assert.ok(lock.snapshot().desired < CONFIG.track.start);
});
