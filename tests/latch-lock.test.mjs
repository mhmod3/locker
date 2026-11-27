import test from 'node:test';
import assert from 'node:assert/strict';

import { createLatchLock, PHASE } from '../src/latch-lock.js';
import { CONFIG } from '../src/config.js';

const DT = 1 / 60;

/** مولّد عشوائي مثبّت كي تكون الاختبارات حتمية. */
function seeded(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function makeConfig({ count = 0, kinds = null, extraChance = 0, hold = {} } = {}) {
  return {
    ...CONFIG,
    hold: {
      ...CONFIG.hold,
      ...hold,
      provocation: {
        ...CONFIG.hold.provocation,
        count,
        extraChance,
        ...(kinds ? { kinds } : {}),
      },
    },
  };
}

function tickFor(lock, seconds) {
  const events = [];
  let elapsed = 0;
  while (elapsed < seconds - 1e-9) {
    const step = Math.min(DT, seconds - elapsed);
    events.push(...lock.tick(step));
    elapsed += step;
  }
  return events;
}

/** سحب تدريجي بسرعة آمنة من نقطة إلى نقطة. */
function dragSlowly(lock, from, to, seconds) {
  const frames = Math.max(1, Math.round(seconds / DT));
  const events = [];
  for (let i = 1; i <= frames; i += 1) {
    events.push(...lock.move(from + ((to - from) * i) / frames));
    events.push(...lock.tick(DT));
  }
  return events;
}

function startDrag(lock) {
  lock.grab(CONFIG.track.start);
  lock.tick(DT);
  return lock;
}

function reachTarget(lock) {
  return dragSlowly(lock, CONFIG.track.start, CONFIG.track.targetCenter, 1.8);
}

test('يبدأ المزلاج ساكناً عند نقطة البداية وعدّاد الثبات فارغ', () => {
  const lock = createLatchLock(makeConfig());
  const s = lock.snapshot();
  assert.equal(s.phase, PHASE.IDLE);
  assert.equal(s.position, CONFIG.track.start);
  assert.equal(s.progress, 0);
  assert.equal(s.grabbed, false);
  assert.equal(s.decoy, null);
});

test('الالتقاط لا يحدث بعيداً عن المزلاج', () => {
  const lock = createLatchLock(makeConfig());
  assert.deepEqual(lock.grab(CONFIG.track.targetCenter), []);
  assert.equal(lock.snapshot().grabbed, false);
});

test('السحب الهادئ ثم الثبات يكمل القفل بلا ارتداد', () => {
  const lock = startDrag(createLatchLock(makeConfig()));
  const events = reachTarget(lock);

  assert.equal(events.some((e) => e.type === 'recoil'), false);
  assert.equal(lock.snapshot().phase, PHASE.HOLDING);

  const holdEvents = tickFor(lock, CONFIG.hold.durationMs / 1000 + 0.4);
  assert.ok(holdEvents.some((e) => e.type === 'unlock'));
  assert.equal(lock.snapshot().phase, PHASE.OPEN);
  assert.equal(lock.snapshot().progress, 1);
});

test('الاستفزازات: ثلاثة أحداث متنوعة، أولها بالنص الافتتاحي', () => {
  const config = makeConfig({ count: 3, extraChance: 0 });
  const lock = startDrag(createLatchLock(config, { random: seeded(7) }));
  reachTarget(lock);

  const events = tickFor(lock, 2.6).filter((e) => e.type === 'provoke');
  assert.equal(events.length, 3);
  assert.equal(events[0].notice, 'provoke');

  const kinds = events.map((e) => e.kind);
  assert.equal(new Set(kinds).size, kinds.length, 'لا يتكرر نوع الاستفزاز في المحاولة');
  for (const kind of kinds) {
    assert.ok(['shift', 'squeeze', 'shove', 'decoy', 'stall'].includes(kind));
  }
  assert.equal(lock.snapshot().phase, PHASE.HOLDING);
});

test('زحزحة العلامة تحرّك المركز ثم تعيده بنعومة', () => {
  const kinds = { shift: { offset: [0.03, 0.03], duration: [900, 900], notice: 'provokeShift' } };
  const lock = startDrag(createLatchLock(makeConfig({ count: 1, kinds }), { random: seeded(3) }));
  reachTarget(lock);
  const base = CONFIG.track.targetCenter;

  tickFor(lock, 0.7);
  const moved = lock.snapshot().targetCenter;
  assert.ok(Math.abs(moved - base) > 0.02, 'يجب أن تُزاح العلامة');

  tickFor(lock, 1.0);
  assert.ok(Math.abs(lock.snapshot().targetCenter - base) < 0.004, 'ثم تعود إلى مركزها');
});

test('تضييق النطاق لا يُفشل لاعباً ثابتاً في المركز', () => {
  const kinds = { squeeze: { scale: [0.6, 0.6], duration: [700, 700], notice: 'provokeSqueeze' } };
  const lock = startDrag(createLatchLock(makeConfig({ count: 2, kinds }), { random: seeded(11) }));
  reachTarget(lock);

  tickFor(lock, 0.7);
  assert.ok(lock.snapshot().targetHalfWidth < CONFIG.track.targetHalfWidth);

  const events = tickFor(lock, 2.2);
  assert.ok(events.some((e) => e.type === 'unlock'));
  assert.equal(lock.snapshot().phase, PHASE.OPEN);
});

test('العلامة المضلِّلة تظهر ثم تختفي', () => {
  const kinds = { decoy: { offset: [0.14, 0.14], duration: [420, 420], notice: 'provokeDecoy' } };
  const lock = startDrag(createLatchLock(makeConfig({ count: 1, kinds }), { random: seeded(5) }));
  reachTarget(lock);

  let seen = false;
  for (let i = 0; i < 120; i += 1) {
    lock.tick(DT);
    if (lock.snapshot().decoy !== null) seen = true;
  }
  assert.ok(seen, 'يجب أن تظهر علامة مضلِّلة أثناء الثبات');
  assert.equal(lock.snapshot().decoy, null, 'ثم تختفي');
});

test('زحزحة العلامة توقف العدّاد ولا تُفشل لاعباً صار خارجها', () => {
  const kinds = { shift: { offset: [0.034, 0.034], duration: [1100, 1100], notice: 'provokeShift' } };
  const playerAt = CONFIG.track.targetCenter + 0.05;

  for (let seed = 1; seed <= 40; seed += 1) {
    const lock = startDrag(createLatchLock(makeConfig({ count: 1, kinds }), { random: seeded(seed) }));
    dragSlowly(lock, CONFIG.track.start, playerAt, 1.8);
    const events = tickFor(lock, 1.2);
    if (lock.snapshot().phase !== PHASE.HOLDING) continue;
    if (!events.some((e) => e.type === 'provoke')) continue;
    if (Math.abs(playerAt - lock.snapshot().targetCenter) <= CONFIG.track.targetHalfWidth) continue;

    assert.equal(lock.snapshot().phase, PHASE.HOLDING, 'لا فشل أثناء انزلاق العلامة');
    assert.equal(lock.snapshot().outsideMs, 0);

    tickFor(lock, 1.3);
    assert.equal(lock.snapshot().phase, PHASE.HOLDING, 'وبعد عودة العلامة يبقى داخل النطاق');
    return;
  }

  assert.fail('لم تُصب زحزحة بعيدة عن اللاعب في أي بذرة');
});

test('السحب السريع يُنتج ارتداداً ميكانيكياً ولا يكمل القفل', () => {
  const lock = startDrag(createLatchLock(makeConfig()));
  let fraction = CONFIG.track.start;
  const events = [];

  for (let i = 0; i < 30; i += 1) {
    fraction -= 0.03;
    events.push(...lock.move(fraction));
    events.push(...lock.tick(DT));
  }

  assert.ok(events.some((e) => e.type === 'recoil'));
  assert.equal(events.some((e) => e.type === 'unlock'), false);
  assert.equal(lock.snapshot().phase, PHASE.DRAGGING);
});

test('مغادرة النطاق تُفشل بعد مهلة السماح لا فوراً', () => {
  const lock = startDrag(createLatchLock(makeConfig()));
  reachTarget(lock);
  tickFor(lock, 0.5);
  assert.equal(lock.snapshot().phase, PHASE.HOLDING);

  dragSlowly(lock, CONFIG.track.targetCenter, CONFIG.track.targetCenter + 0.12, 0.4);

  tickFor(lock, 0.12);
  assert.equal(lock.snapshot().phase, PHASE.HOLDING, 'السماح القصير يمنع الفشل الفوري');

  const events = tickFor(lock, 0.4);
  const failure = events.find((e) => e.type === 'fail');
  assert.ok(failure);
  assert.equal(failure.reason, 'left');
  assert.equal(failure.failCount, 1);
});

test('العودة إلى النطاق قبل انتهاء السماح تُلغي الفشل', () => {
  const lock = startDrag(createLatchLock(makeConfig()));
  reachTarget(lock);
  tickFor(lock, 0.4);

  dragSlowly(lock, CONFIG.track.targetCenter, CONFIG.track.targetCenter + 0.08, 0.3);
  tickFor(lock, 0.1);
  assert.equal(lock.snapshot().phase, PHASE.HOLDING);

  dragSlowly(lock, CONFIG.track.targetCenter + 0.08, CONFIG.track.targetCenter, 0.3);
  tickFor(lock, 0.5);
  assert.equal(lock.snapshot().phase, PHASE.HOLDING);
  assert.equal(lock.snapshot().outsideMs, 0);
});

test('إفلات المزلاج داخل الهدف قبل الاكتمال فشلٌ', () => {
  const lock = startDrag(createLatchLock(makeConfig()));
  reachTarget(lock);
  tickFor(lock, 0.5);

  const events = lock.release();
  const failure = events.find((e) => e.type === 'fail');
  assert.ok(failure);
  assert.equal(failure.reason, 'released');
  assert.equal(lock.snapshot().phase, PHASE.IDLE);
});

test('العدّاد يتفرّغ بنعومة بعد الفشل', () => {
  const lock = startDrag(createLatchLock(makeConfig()));
  reachTarget(lock);
  tickFor(lock, 1.4);
  const charged = lock.snapshot().progress;
  assert.ok(charged > 0.4);

  lock.release();
  tickFor(lock, 0.18);
  const midway = lock.snapshot().progress;
  assert.ok(midway > 0 && midway < charged);

  tickFor(lock, CONFIG.hold.drainMs / 1000);
  assert.equal(lock.snapshot().progress, 0);

  tickFor(lock, 2.5);
  assert.ok(Math.abs(lock.snapshot().position - CONFIG.track.start) < 0.006);
});

test('تكرار الخطأ يتراكم في عدّاد الإخفاقات', () => {
  const lock = createLatchLock(makeConfig());

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    lock.grab(CONFIG.track.start);
    reachTarget(lock);
    tickFor(lock, 0.4);
    assert.ok(lock.release().some((e) => e.type === 'fail'));
    tickFor(lock, 2.4);
  }

  assert.equal(lock.snapshot().failCount, 3);
});

test('المزلاج المفتوح يرفض الالتقاط، وإعادة الضبط تُرجع كل شيء', () => {
  const lock = startDrag(createLatchLock(makeConfig()));
  reachTarget(lock);
  tickFor(lock, CONFIG.hold.durationMs / 1000 + 0.4);
  assert.equal(lock.snapshot().phase, PHASE.OPEN);

  assert.deepEqual(lock.grab(lock.snapshot().position), []);
  assert.equal(lock.snapshot().phase, PHASE.OPEN);

  lock.reset();
  const s = lock.snapshot();
  assert.equal(s.phase, PHASE.IDLE);
  assert.equal(s.position, CONFIG.track.start);
  assert.equal(s.progress, 0);
  assert.equal(s.targetCenter, CONFIG.track.targetCenter);
  assert.equal(s.decoy, null);
  assert.equal(s.unlockCount, 0);
  assert.equal(s.failCount, 0);
});

test('خطوات لوحة المفاتيح بطيئة بما يكفي ولا تُطلق الارتداد', () => {
  const lock = startDrag(createLatchLock(makeConfig()));
  const events = [];
  for (let i = 0; i < 60; i += 1) {
    events.push(...lock.nudge(-CONFIG.input.keyStep));
    events.push(...lock.tick(DT));
  }
  assert.equal(events.some((e) => e.type === 'recoil'), false);
  assert.ok(lock.snapshot().desired < CONFIG.track.start);
});
