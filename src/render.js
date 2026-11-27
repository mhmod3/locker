/**
 * طبقة العرض: تقرأ لقطة الحالة وتترجمها إلى SVG وواجهة.
 * لا تعرف شيئاً عن الفيزياء ولا عن اللمس، ولا تشغّل أي حركة خاصة بها.
 */

import { CONFIG, STRINGS } from './config.js';

/** هندسة المسار بوحدات الـ SVG (تطابق viewBox في index.html). */
export const GEOMETRY = Object.freeze({ x0: 100, width: 800, centerY: 170, ringRadius: 54 });

const RING_CIRCUMFERENCE = 2 * Math.PI * GEOMETRY.ringRadius;
const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
const toArabicDigits = (value) => String(value).replace(/\d/g, (digit) => ARABIC_DIGITS[Number(digit)]);

export const fractionToX = (fraction) => GEOMETRY.x0 + fraction * GEOMETRY.width;

export function createRenderer(doc = document) {
  const app = doc.getElementById('app');
  const rig = doc.getElementById('rig');
  const bolt = doc.getElementById('bolt');
  const ring = doc.getElementById('ring');
  const targetFill = doc.getElementById('targetFill');
  const targetMarks = doc.getElementById('targetMarks');
  const decoy = doc.getElementById('decoy');
  const ticks = doc.getElementById('ticks');
  const knurl = doc.getElementById('knurl');
  const notice = doc.getElementById('notice');
  const noticeText = doc.getElementById('noticeText');
  const readoutValue = doc.getElementById('readoutValue');
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

  const svgNS = 'http://www.w3.org/2000/svg';

  /* شُرَط المسار المحفورة */
  if (ticks) {
    const fragment = doc.createDocumentFragment();
    for (let i = 0; i <= 20; i += 1) {
      const x = GEOMETRY.x0 + (i / 20) * GEOMETRY.width;
      const line = doc.createElementNS(svgNS, 'line');
      line.setAttribute('x1', String(x));
      line.setAttribute('x2', String(x));
      line.setAttribute('y1', i % 5 === 0 ? '184' : '187');
      line.setAttribute('y2', '192');
      if (i % 5 === 0) line.classList.add('is-major');
      fragment.appendChild(line);
    }
    ticks.appendChild(fragment);
  }

  /* نقش قبضة المزلاج */
  if (knurl) {
    const fragment = doc.createDocumentFragment();
    for (let i = -3; i <= 3; i += 1) {
      const line = doc.createElementNS(svgNS, 'line');
      line.setAttribute('x1', String(i * 4));
      line.setAttribute('x2', String(i * 4));
      line.setAttribute('y1', '-10');
      line.setAttribute('y2', '10');
      fragment.appendChild(line);
    }
    knurl.appendChild(fragment);
  }

  if (ring) {
    ring.style.strokeDasharray = `${RING_CIRCUMFERENCE.toFixed(2)}`;
    ring.style.strokeDashoffset = `${RING_CIRCUMFERENCE.toFixed(2)}`;
  }

  const background = [doc.querySelector('.topbar'), doc.querySelector('.lead'), doc.querySelector('.stage'), doc.querySelector('.foot')];
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let lastAria = '';
  let lastReadout = '';
  let noticeTimer = null;
  let completionTimer = null;

  function render(state) {
    const x = fractionToX(state.position);
    bolt.setAttribute('transform', `translate(${x.toFixed(2)} ${GEOMETRY.centerY})`);

    const centerX = fractionToX(state.targetCenter);
    const targetTransform = `translate(${centerX.toFixed(2)} ${GEOMETRY.centerY}) scale(${state.zoneScale.toFixed(4)} 1)`;
    targetFill.setAttribute('transform', targetTransform);
    targetMarks.setAttribute('transform', targetTransform);

    const decoyOn = state.decoy !== null && state.decoy !== undefined;
    if (decoyOn) {
      const decoyX = fractionToX(state.decoy);
      decoy.setAttribute('transform', `translate(${decoyX.toFixed(2)} ${GEOMETRY.centerY})`);
    }
    if (app.dataset.decoy !== (decoyOn ? 'on' : 'off')) {
      app.dataset.decoy = decoyOn ? 'on' : 'off';
    }

    const progress = Math.min(1, Math.max(0, state.progress));
    if (ring) {
      ring.style.strokeDashoffset = (RING_CIRCUMFERENCE * (1 - progress)).toFixed(2);
    }
    app.classList.toggle('is-charging', progress > 0.002);

    const percent = Math.round(progress * 100);
    if (readoutValue) {
      const text = `${toArabicDigits(percent)}٪`;
      if (text !== lastReadout) {
        lastReadout = text;
        readoutValue.textContent = text;
      }
    }

    if (app.dataset.phase !== state.phase) app.dataset.phase = state.phase;
    if (app.dataset.strain !== (state.strain > 0.55 ? 'on' : 'off')) {
      app.dataset.strain = state.strain > 0.55 ? 'on' : 'off';
    }
    rig.classList.toggle('is-grabbed', state.grabbed);

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

  function showNotice(text, tone = 'taunt', { life = CONFIG.notice.lifeMs } = {}) {
    if (!notice || !noticeText) return;
    window.clearTimeout(noticeTimer);
    noticeText.textContent = text;
    notice.className = `notice notice--${tone}`;

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

  function setBackgroundInert(value) {
    for (const node of background) {
      if (node) node.inert = value;
    }
  }

  function showCompletion() {
    if (!done) return;
    done.hidden = false;
    setBackgroundInert(true);
    void done.offsetWidth;
    requestAnimationFrame(() => done.classList.add('is-on'));
    completionTimer = window.setTimeout(() => replayBtn?.focus({ preventScroll: true }), 260);
  }

  function hideCompletion() {
    window.clearTimeout(completionTimer);
    if (!done) return;
    setBackgroundInert(false);
    done.classList.remove('is-on');
    window.setTimeout(
      () => {
        done.hidden = true;
      },
      reducedMotion?.matches ? 0 : 220,
    );
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
    showNotice,
    hideNotice,
    showCompletion,
    hideCompletion,
    setSoundLabel,
    focusRig,
  };
}
