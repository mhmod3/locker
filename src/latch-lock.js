/**
 * منطق قفل المزلاج — خالٍ تماماً من العرض واللمس.
 * يستقبل الأوامر (التقاط، تحريك، إفلات، خطوة زمنية) ويُخرج لقطة حالة + أحداثاً.
 * كل الحركة هنا محاكاة نابض بسيطة، لذا فالسلوك حتمي وقابل للاختبار.
 */

import { CONFIG } from './config.js';

export const PHASE = Object.freeze({
  IDLE: 'idle',
  DRAGGING: 'dragging',
  HOLDING: 'holding',
  OPEN: 'open',
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function createLatchLock(config = CONFIG) {
  const track = config.track;
  const state = {
    phase: PHASE.IDLE,
    position: track.start,
    desired: track.start,
    velocity: 0,
    progress: 0,
    targetCenter: track.targetCenter,
    grabbed: false,
    strain: 0,
    failCount: 0,
    unlockCount: 0,
  };

  let pointerFraction = track.start;
  let grabOffset = 0;
  let lastDesired = track.start;
  let smoothedSpeed = 0;
  let inputLockLeft = 0;
  let graceLeft = 0;
  /** مراحل الاستفزاز التي أُطلقت في المحاولة الحالية. */
  let fired = new Set();

  function resetAttempt() {
    state.targetCenter = track.targetCenter;
    state.strain = 0;
    graceLeft = 0;
    fired = new Set();
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

  function fail(reason, events) {
    state.failCount += 1;
    state.grabbed = false;
    state.phase = PHASE.IDLE;
    state.desired = track.start;
    state.strain = 0;
    state.targetCenter = track.targetCenter;
    fired = new Set();
    graceLeft = 0;
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
    graceLeft = 0;
    events.push({ type: 'unlock', unlockCount: state.unlockCount });
  }

  function provoke(stage, events) {
    fired.add(stage);
    state.targetCenter = clamp(state.targetCenter + stage.shift, 0.12, 0.72);
    // دفعة ميكانيكية خفيفة تُزحزح المزلاج قليلاً؛ على اللاعب ألّا يردّ عليها باندفاع.
    state.velocity += stage.impulse;
    graceLeft = config.hold.graceMs / 1000;
    events.push({ type: 'provoke', notice: stage.notice });
  }

  function grab(fraction) {
    const events = [];
    if (state.phase === PHASE.OPEN) return events;
    if (inputLockLeft > 0) return events;
    if (Math.abs(fraction - state.position) > config.input.grabTolerance) return events;

    resetAttempt();
    state.grabbed = true;
    state.phase = PHASE.DRAGGING;
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
    fired = new Set();
    graceLeft = 0;

    if (wasHolding) {
      const events = [];
      fail('released', events);
      return events;
    }

    state.phase = PHASE.IDLE;
    return [{ type: 'release' }];
  }

  function tick(deltaSeconds) {
    const dt = clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, 0.05);
    const events = [];
    if (dt <= 0) return events;

    const wasLocked = inputLockLeft > 0;
    if (inputLockLeft > 0) inputLockLeft = Math.max(0, inputLockLeft - dt);
    if (graceLeft > 0) graceLeft = Math.max(0, graceLeft - dt);

    // سرعة أمر الدفع (لا سرعة المزلاج نفسه) — هي ما يعبّر عن اندفاع اللاعب.
    const speedNow = Math.abs(state.desired - lastDesired) / dt;
    smoothedSpeed += (speedNow - smoothedSpeed) * Math.min(1, dt * 14);
    lastDesired = state.desired;

    // النابض: خطوتان صغيرتان لثبات أفضل عند الـ fps المنخفض.
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

    // كتم الاندفاع: مقياس إجهاد يتراكم عند تجاوز الحد المسموح.
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

    const inZone = Math.abs(state.position - state.targetCenter) <= track.targetHalfWidth;

    if (state.phase === PHASE.OPEN) {
      // القفل مفتوح؛ لا عدّاد ولا فشل.
    } else if (state.grabbed && inZone) {
      if (state.phase !== PHASE.HOLDING) {
        state.phase = PHASE.HOLDING;
        events.push({ type: 'holdStart' });
      }

      state.progress = Math.min(1, state.progress + (dt * 1000) / config.hold.durationMs);

      for (const stage of config.hold.provocations) {
        if (!fired.has(stage) && state.progress >= stage.at) provoke(stage, events);
      }

      if (state.progress >= 1) unlock(events);
    } else if (state.phase === PHASE.HOLDING) {
      const coveredByGrace = state.grabbed && graceLeft > 0;
      if (!coveredByGrace) {
        fail(state.grabbed ? 'left' : 'released', events);
      }
    }

    // تفريغ هادئ للعدّاد خارج الثبات.
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
    state.targetCenter = track.targetCenter;
    state.grabbed = false;
    state.strain = 0;
    state.failCount = 0;
    state.unlockCount = 0;
    inputLockLeft = 0;
    graceLeft = 0;
    smoothedSpeed = 0;
    lastDesired = track.start;
    fired = new Set();
  }

  function snapshot() {
    return {
      phase: state.phase,
      position: state.position,
      desired: state.desired,
      progress: state.progress,
      targetCenter: state.targetCenter,
      targetBase: track.targetCenter,
      targetHalfWidth: track.targetHalfWidth,
      grabbed: state.grabbed,
      strain: state.strain,
      failCount: state.failCount,
      unlockCount: state.unlockCount,
      velocity: state.velocity,
    };
  }

  return { grab, move, nudge, release, tick, reset, snapshot };
}
