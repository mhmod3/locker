/**
 * طبقة العرض: تقرأ لقطة الحالة وتترجمها إلى SVG وواجهة.
 * لا تعرف شيئاً عن الفيزياء ولا عن اللمس.
 */

import { CONFIG, STRINGS } from './config.js';

/** هندسة المسار بوحدات الـ SVG (تطابق viewBox في index.html). */
export const GEOMETRY = Object.freeze({ x0: 100, width: 800, centerY: 170, ringRadius: 58 });

const RING_CIRCUMFERENCE = 2 * Math.PI * GEOMETRY.ringRadius;

export const fractionToX = (fraction) => GEOMETRY.x0 + fraction * GEOMETRY.width;

export function createRenderer(doc = document) {
  const app = doc.getElementById('app');
  const rig = doc.getElementById('rig');
  const svg = rig.querySelector('svg');
  const bolt = doc.getElementById('bolt');
  const ring = doc.getElementById('ring');
  const target = doc.getElementById('target');
  const ticks = doc.getElementById('ticks');
  const notice = doc.getElementById('notice');
  const noticeText = doc.getElementById('noticeText');
  const done = doc.getElementById('done');
  const replayBtn = doc.getElementById('replayBtn');
  const soundBtn = doc.getElementById('soundBtn');
  const rigHelp = doc.getElementById('rigHelp');

  /* النصوص كلها من STRINGS، لا نص محروق في الـ HTML. */
  for (const node of doc.querySelectorAll('[data-string]')) {
    const value = STRINGS[node.dataset.string];
    if (typeof value === 'string') node.textContent = value;
  }
  rig.setAttribute('aria-label', STRINGS.a11yLabel);
  rigHelp.textContent = STRINGS.a11yHelp;

  /* شُرَط المسار المحفورة */
  if (ticks) {
    const fragment = doc.createDocumentFragment();
    const count = 20;
    for (let i = 0; i <= count; i += 1) {
      const x = GEOMETRY.x0 + (i / count) * GEOMETRY.width;
      const line = doc.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(x));
      line.setAttribute('x2', String(x));
      line.setAttribute('y1', i % 5 === 0 ? '183' : '187');
      line.setAttribute('y2', '193');
      if (i % 5 === 0) line.classList.add('is-major');
      fragment.appendChild(line);
    }
    ticks.appendChild(fragment);
  }

  if (ring) {
    ring.style.strokeDasharray = `${RING_CIRCUMFERENCE.toFixed(2)}`;
    ring.style.strokeDashoffset = `${RING_CIRCUMFERENCE.toFixed(2)}`;
  }

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const background = [doc.querySelector('.masthead'), doc.querySelector('.rig-wrap'), doc.querySelector('.foot')];
  let lastAria = '';
  let noticeTimer = null;
  let completionTimer = null;

  function render(state) {
    const x = fractionToX(state.position);
    bolt.setAttribute('transform', `translate(${x.toFixed(2)} ${GEOMETRY.centerY})`);

    const progress = Math.min(1, Math.max(0, state.progress));
    if (ring) {
      ring.style.strokeDashoffset = (RING_CIRCUMFERENCE * (1 - progress)).toFixed(2);
    }

    const dx = (state.targetCenter - state.targetBase) * GEOMETRY.width;
    target.style.transform = `translateX(${dx.toFixed(2)}px)`;

    if (app.dataset.phase !== state.phase) app.dataset.phase = state.phase;
    const charging = progress > 0.003;
    app.classList.toggle('is-charging', charging);
    rig.classList.toggle('is-grabbed', state.grabbed);

    const strained = state.strain > 0.55;
    if (app.dataset.strain !== (strained ? 'on' : 'off')) {
      app.dataset.strain = strained ? 'on' : 'off';
    }

    const percent = Math.round(progress * 100);
    let valueText = STRINGS.a11yIdle;
    if (state.phase === 'open') {
      valueText = STRINGS.a11yOpen;
    } else if (state.phase === 'holding' || progress > 0.005) {
      valueText = STRINGS.a11yHolding(percent);
    } else if (state.phase === 'dragging') {
      valueText = STRINGS.a11yMoving;
    } else if (progress > 0) {
      valueText = STRINGS.a11yDraining;
    }

    if (valueText !== lastAria) {
      lastAria = valueText;
      rig.setAttribute('aria-valuenow', String(percent));
      rig.setAttribute('aria-valuetext', valueText);
    }
  }

  function knock() {
    if (reducedMotion?.matches) return;
    rig.classList.remove('is-knock');
    // إعادة تشغيل الحركة
    void rig.offsetWidth;
    rig.classList.add('is-knock');
    window.setTimeout(() => rig.classList.remove('is-knock'), 460);
  }

  function showNotice(text, tone = 'taunt', { life = CONFIG.notice.lifeMs } = {}) {
    if (!notice || !noticeText) return;
    window.clearTimeout(noticeTimer);
    noticeText.textContent = text;
    notice.classList.remove('notice--warn', 'notice--taunt', 'notice--success');
    notice.classList.add(`notice--${tone}`);

    if (!notice.classList.contains('is-on')) {
      void notice.offsetWidth;
      requestAnimationFrame(() => notice.classList.add('is-on'));
    }
    noticeTimer = window.setTimeout(() => hideNotice(), life);
  }

  function hideNotice() {
    window.clearTimeout(noticeTimer);
    notice?.classList.remove('is-on');
  }

  function showCompletion() {
    if (!done) return;
    done.hidden = false;
    for (const node of background) {
      if (node) node.inert = true;
    }
    void done.offsetWidth;
    requestAnimationFrame(() => done.classList.add('is-in'));
    completionTimer = window.setTimeout(() => replayBtn?.focus({ preventScroll: true }), 500);
  }

  function hideCompletion() {
    window.clearTimeout(completionTimer);
    if (!done) return;
    for (const node of background) {
      if (node) node.inert = false;
    }
    done.classList.remove('is-in');
    window.setTimeout(() => {
      done.hidden = true;
    }, reducedMotion?.matches ? 10 : 900);
  }

  function setSoundLabel(enabled) {
    if (!soundBtn) return;
    soundBtn.textContent = enabled ? STRINGS.soundOn : STRINGS.soundOff;
    soundBtn.setAttribute('aria-pressed', String(enabled));
  }

  function focusRig() {
    rig?.focus({ preventScroll: true });
  }

  return {
    render,
    knock,
    showNotice,
    hideNotice,
    showCompletion,
    hideCompletion,
    setSoundLabel,
    focusRig,
  };
}
