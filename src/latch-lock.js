/**
 * منطق قفل المزلاج — خالٍ تماماً من العرض واللمس.
 * يستقبل الأوامر (التقاط، تحريك، إفلات، خطوة زمنية) ويُخرج لقطة حالة + أحداثاً.
 *
 * الاستفزازات تُولَّد لكل محاولة بشكل عشوائي (الوقت، النوع، الاتجاه، المقدار)،
 * ويمكن تثبيت العشوائية بحقن `random` في الاختبارات.
 */

import { CONFIG } from './config.js';

export const PHASE = Object.freeze({
  IDLE: 'idle',
  DRAGGING: 'dragging',
  HOLDING: 'holding',
  OPEN: 'open',
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const range = (random, [min, max]) => min + random() * (max - min);
const coin = (random) => (random() < 0.5 ? -1 : 1);

export function createLatchLock(config = CONFIG, options = {}) {
  const random = options.random ?? Math.random;
  const track = config.track;
  const prov = config.hold.provocation;
  const provKinds = Object.keys(prov.kinds);

  const state = {
    phase: PHASE.IDLE,
    position: track.start,
    desired: track.start,
    velocity: 0,
    progress: 0,
    targetCenter: track.targetCenter,
    targetGoal: track.targetCenter,
    zoneScale: 1,
    zoneGoal: 1,
    decoy: null,
    grabbed: false,
    strain: 0,
    outsideMs: 0,
    failCount: 0,
    unlockCount: 0,
  };

  let pointerFraction = track.start;
  let grabOffset = 0;
  let lastDesired = track.start;
  let smoothedSpeed = 0;
  let inputLockLeft = 0;
  let clock = 0;

  let plan = [];
  let nextEvent = 0;
  let shiftReturnAt = Infinity;
  let squeezeUntil = Infinity;
  let decoyUntil = Infinity;
  let stallUntil = Infinity;
  let stallRate = 1;

  /* ------------------------------------------------------------------
     توليد خطة الاستفزاز لهذه المحاولة
     ------------------------------------------------------------------ */

  function makeParams(kind) {
    const spec = prov.kinds[kind];
    switch (kind) {
      case 'shift':
        return { offset: range(random, spec.offset) * coin(random), durationMs: range(random, spec.duration) };
      case 'squeeze':
        return { scale: range(random, spec.scale), durationMs: range(random, spec.duration) };
      case 'shove':
        return { impulse: range(random, spec.impulse) * coin(random) };
      case 'decoy':
        return {
          offset: range(random, spec.offset) * coin(random),
          durationMs: range(random, spec.duration),
        };
      case 'stall':
        return { rate: spec.rate, durationMs: range(random, spec.duration) };
      default:
        return {};
    }
  }

  function buildPlan() {
    const times = [];
    let at = range(random, prov.timing.first);
    while (times.length < prov.count && at <= prov.timing.latest) {
      times.push(at);
      at += range(random, prov.timing.gap);
    }

    const pool = [...provKinds];
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    const events = times.map((ms, index) => {
      const kind = pool[index % pool.length];
      return {
        at: ms / config.hold.durationMs,
        kind,
        params: makeParams(kind),
        notice: index === 0 ? 'provoke' : prov.kinds[kind].notice,
      };
    });

    if (events.length > 0 && random() < prov.extraChance) {
      events.push({
        at: range(random, prov.timing.extra) / config.hold.durationMs,
        kind: 'decoy',
        params: makeParams('decoy'),
        notice: 'provokeLate',
      });
    }

    events.sort((a, b) => a.at - b.at);
    return events;
  }

  function resetAttempt() {
    state.targetCenter = track.targetCenter;
    state.targetGoal = track.targetCenter;
    state.zoneScale = 1;
    state.zoneGoal = 1;
    state.decoy = null;
    state.outsideMs = 0;
    state.strain = 0;
    clock = 0;
    nextEvent = 0;
    shiftReturnAt = Infinity;
    squeezeUntil = Infinity;
    decoyUntil = Infinity;
    stallUntil = Infinity;
    stallRate = 1;
    plan = buildPlan();
  }

  /* ------------------------------------------------------------------
     أحداث داخلية
     ------------------------------------------------------------------ */

  function fire(event, events) {
    const params = event.params;
    events.push({ type: 'provoke', kind: event.kind, notice: event.notice });

    switch (event.kind) {
      case 'shift': {
        const span = prov.kinds.shift.offset[1] + 0.008;
        state.targetGoal = clamp(
          track.targetCenter + params.offset,
          track.targetCenter - span,
          track.targetCenter + span,
        );
        shiftReturnAt = clock + params.durationMs / 1000;
        break;
      }
      case 'squeeze':
        state.zoneGoal = params.scale;
        squeezeUntil = clock + params.durationMs / 1000;
        break;
      case 'shove':
        state.velocity += params.impulse;
        break;
      case 'decoy':
        state.decoy = clamp(track.targetCenter + params.offset, 0.08, 0.92);
        decoyUntil = clock + params.durationMs / 1000;
        break;
      case 'stall':
        stallRate = params.rate;
        stallUntil = clock + params.durationMs / 1000;
        break;
      default:
        break;
    }
  }

  function startRecoil(events) {
    const direction = Math.sign(state.desired - lastDesired) || Math.sign(state.velocity) || -1;
    state.velocity = -direction * config.speed.recoilImpulse;
    state.desired = state.position;
    lastDesired = state.desired;
    smoothedSpeed = 0;
    state.strain = 0;
    inputLockLeft = config.speed.inputLockMs / 1000;
    events.push({ type: 'recoil' });
  }

  /** ينهي آثار الاستفزاز ويترك العلامة تعود بسلاسة إلى مركزها. */
  function clearEffects() {
    state.targetGoal = track.targetCenter;
    state.zoneGoal = 1;
    state.decoy = null;
    shiftReturnAt = Infinity;
    squeezeUntil = Infinity;
    decoyUntil = Infinity;
    stallUntil = Infinity;
    stallRate = 1;
  }

  function fail(reason, events) {
    state.failCount += 1;
    state.grabbed = false;
    state.phase = PHASE.IDLE;
    state.desired = track.start;
    state.strain = 0;
    state.outsideMs = 0;
    clearEffects();
    events.push({ type: 'fail', reason, failCount: state.failCount, progress: state.progress });
  }

  function unlock(events) {
    state.phase = PHASE.OPEN;
    state.grabbed = false;
    state.progress = 1;
    state.unlockCount += 1;
    state.desired = clamp(state.targetCenter - 0.055, track.minPosition, track.maxPosition);
    lastDesired = state.desired;
    state.strain = 0;
    state.outsideMs = 0;
    clearEffects();
    events.push({ type: 'unlock', unlockCount: state.unlockCount });
  }

  /* ------------------------------------------------------------------
     الأوامر
     ------------------------------------------------------------------ */

  function grab(fraction) {
    const events = [];
    if (state.phase === PHASE.OPEN) return events;
    if (inputLockLeft > 0) return events;
    if (Math.abs(fraction - state.position) > config.input.grabTolerance) return events;

    resetAttempt();
    state.grabbed = true;
    state.phase = PHASE.DRAGGING;
    state.outsideMs = 0;
    pointerFraction = fraction;
    grabOffset = state.position - fraction;
    state.desired = state.position;
    lastDesired = state.desired;
    smoothedSpeed = 0;
    events.push({ type: 'grab' });
    return events;
  }

  function move(fraction) {
    if (!state.grabbed) return [];
    pointerFraction = fraction;
    if (inputLockLeft > 0) return [];
    state.desired = clamp(fraction + grabOffset, track.minPosition, track.maxPosition);
    return [];
  }

  function nudge(delta) {
    if (!state.grabbed || inputLockLeft > 0) return [];
    state.desired = clamp(state.desired + delta, track.minPosition, track.maxPosition);
    return [];
  }

  function release() {
    if (!state.grabbed) return [];
    const wasHolding = state.phase === PHASE.HOLDING;
    state.grabbed = false;
    state.desired = track.start;
    state.strain = 0;
    state.outsideMs = 0;

    if (wasHolding) {
      const events = [];
      fail('released', events);
      return events;
    }

    state.phase = PHASE.IDLE;
    clearEffects();
    return [{ type: 'release' }];
  }

  function tick(deltaSeconds) {
    const dt = clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, 0.05);
    const events = [];
    if (dt <= 0) return events;

    clock += dt;

    const wasLocked = inputLockLeft > 0;
    if (inputLockLeft > 0) inputLockLeft = Math.max(0, inputLockLeft - dt);

    // انتهاء آثار الاستفزازات
    if (clock >= shiftReturnAt) {
      state.targetGoal = track.targetCenter;
      shiftReturnAt = Infinity;
    }
    if (clock >= squeezeUntil) {
      state.zoneGoal = 1;
      squeezeUntil = Infinity;
    }
    if (clock >= decoyUntil) {
      state.decoy = null;
      decoyUntil = Infinity;
    }
    if (clock >= stallUntil) {
      stallRate = 1;
      stallUntil = Infinity;
    }

    // انزلاق العلامة وتغيّر اتساع النطاق (الحركة هنا، لا في CSS)
    const centerK = 1 - Math.exp(-config.hold.centerEase * dt);
    state.targetCenter += (state.targetGoal - state.targetCenter) * centerK;
    const widthK = 1 - Math.exp(-config.hold.widthEase * dt);
    state.zoneScale += (state.zoneGoal - state.zoneScale) * widthK;

    // سرعة أمر الدفع — مقياس اندفاع اللاعب
    const speedNow = Math.abs(state.desired - lastDesired) / dt;
    smoothedSpeed += (speedNow - smoothedSpeed) * Math.min(1, dt * 14);
    lastDesired = state.desired;

    // النابض
    const h = dt / 2;
    for (let i = 0; i < 2; i += 1) {
      const accel =
        config.spring.stiffness * (state.desired - state.position) -
        config.spring.damping * state.velocity;
      state.velocity += accel * h;
      state.position += state.velocity * h;
    }
    if (state.position < track.minPosition || state.position > track.maxPosition) {
      state.position = clamp(state.position, track.minPosition, track.maxPosition);
      state.velocity = 0;
    }

    // بعد انتهاء قفل الإدخال، أعِد ربط أمر الإصبع بالوضع الحالي حتى لا يقفز المزلاج.
    if (wasLocked && inputLockLeft <= 0 && state.grabbed) {
      grabOffset = state.desired - pointerFraction;
      lastDesired = state.desired;
      smoothedSpeed = 0;
    }

    // كتم الاندفاع
    if (state.grabbed && state.phase !== PHASE.OPEN && inputLockLeft <= 0) {
      const limit = config.speed.maxTrackPerSecond;
      if (smoothedSpeed > limit) {
        const excess = smoothedSpeed / limit - 1;
        state.strain = clamp(state.strain + excess * config.speed.strainRate * dt, 0, 1.6);
      } else {
        state.strain = Math.max(0, state.strain - config.speed.strainDecay * dt);
      }
      if (state.strain >= 1) startRecoil(events);
    } else if (state.strain > 0) {
      state.strain = Math.max(0, state.strain - config.speed.strainDecay * dt);
    }

    const halfWidth = track.targetHalfWidth * state.zoneScale;
    const inZone = Math.abs(state.position - state.targetCenter) <= halfWidth;

    if (state.phase === PHASE.OPEN) {
      // القفل مفتوح.
    } else if (state.grabbed && inZone) {
      if (state.phase !== PHASE.HOLDING) {
        state.phase = PHASE.HOLDING;
        events.push({ type: 'holdStart' });
      }
      state.outsideMs = 0;

      state.progress = Math.min(
        1,
        state.progress + ((dt * 1000) / config.hold.durationMs) * stallRate,
      );

      while (nextEvent < plan.length && state.progress >= plan[nextEvent].at) {
        fire(plan[nextEvent], events);
        nextEvent += 1;
      }

      if (state.progress >= 1) unlock(events);
    } else if (state.phase === PHASE.HOLDING) {
      if (!state.grabbed) {
        fail('released', events);
      } else if (shiftReturnAt !== Infinity) {
        // العلامة تتحرك الآن: إرباك لا عقاب. يبقى العدّاد متوقفاً لكن لا فشل.
        state.outsideMs = 0;
      } else {
        state.outsideMs += dt * 1000;
        if (state.outsideMs >= config.hold.outsideToleranceMs) fail('left', events);
      }
    }

    // تفريغ هادئ للعدّاد خارج الثبات
    if (state.phase !== PHASE.HOLDING && state.phase !== PHASE.OPEN) {
      state.progress = Math.max(0, state.progress - (dt * 1000) / config.hold.drainMs);
    }

    return events;
  }

  function reset() {
    state.phase = PHASE.IDLE;
    state.position = track.start;
    state.desired = track.start;
    state.velocity = 0;
    state.progress = 0;
    state.grabbed = false;
    state.strain = 0;
    state.outsideMs = 0;
    state.failCount = 0;
    state.unlockCount = 0;
    inputLockLeft = 0;
    smoothedSpeed = 0;
    lastDesired = track.start;
    clock = 0;
    resetAttempt();
  }

  function snapshot() {
    return {
      phase: state.phase,
      position: state.position,
      desired: state.desired,
      velocity: state.velocity,
      progress: state.progress,
      targetCenter: state.targetCenter,
      targetBase: track.targetCenter,
      targetHalfWidth: track.targetHalfWidth * state.zoneScale,
      zoneScale: state.zoneScale,
      decoy: state.decoy,
      grabbed: state.grabbed,
      strain: state.strain,
      outsideMs: state.outsideMs,
      failCount: state.failCount,
      unlockCount: state.unlockCount,
    };
  }

  return { grab, move, nudge, release, tick, reset, snapshot };
}
