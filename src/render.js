/**
 * طبقة العرض: تقرأ لقطة الحالة وتترجمها إلى SVG وواجهة.
 * لا تعرف شيئاً عن الفيزياء ولا عن اللمس.
 *
 * هناك مسارَان مرسومان مسبقاً: أفقي للشاشات العريضة، ورأسي للهاتف
 * (المزلاج أكبر وأسهل للإبهام). المنطق واحد، والفرق في الهندسة فقط.
 */

import { CONFIG, STRINGS } from './config.js';

export const LAYOUTS = Object.freeze({
  landscape: { axis: 'x', origin: 100, length: 800, cross: 170, ringRadius: 54 },
  portrait: { axis: 'y', origin: 56, length: 400, cross: 170, ringRadius: 52 },
});

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
export const toArabicDigits = (value) =>
  String(value).replace(/\d/g, (digit) => ARABIC_DIGITS[Number(digit)]);
const svgNS = 'http://www.w3.org/2000/svg';

export function createRenderer(doc = document, options = {}) {
  const onLayout = options.onLayout ?? null;
  const app = doc.getElementById('app');
  const rig = doc.getElementById('rig');
  const notice = doc.getElementById('notice');
  const noticeText = doc.getElementById('noticeText');
  const readoutValue = doc.getElementById('readoutValue');
  const readoutLabel = doc.getElementById('readoutLabel');
  const guidance = doc.getElementById('guidance');
  const doneReport = doc.getElementById('doneReport');
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

  /* ------------------------------------------------------------------
     ربط المسارين
     ------------------------------------------------------------------ */

  const views = [...rig.querySelectorAll('.rig__svg')].map((svg) => {
    const layout = LAYOUTS[svg.dataset.orientation] ?? LAYOUTS.landscape;
    const view = {
      svg,
      layout,
      bolt: svg.querySelector('.bolt'),
      ring: svg.querySelector('.bolt__ring'),
      targetFill: svg.querySelector('.target-fill'),
      targetMarks: svg.querySelector('.target-marks'),
      decoy: svg.querySelector('.decoy'),
      ticks: svg.querySelector('.ticks'),
      knurl: svg.querySelector('.bolt__knurl'),
      circumference: 2 * Math.PI * layout.ringRadius,
    };
    buildDecoration(view);
    return view;
  });

  function buildDecoration(view) {
    const { layout } = view;

    if (view.ticks) {
      const fragment = doc.createDocumentFragment();
      for (let i = 0; i <= 20; i += 1) {
        const ratio = i / 20;
        const line = doc.createElementNS(svgNS, 'line');
        if (layout.axis === 'x') {
          const x = layout.origin + ratio * layout.length;
          line.setAttribute('x1', String(x));
          line.setAttribute('x2', String(x));
          line.setAttribute('y1', i % 5 === 0 ? '184' : '187');
          line.setAttribute('y2', '192');
        } else {
          const y = layout.origin + ratio * layout.length;
          line.setAttribute('y1', String(y));
          line.setAttribute('y2', String(y));
          line.setAttribute('x1', i % 5 === 0 ? '188' : '191');
          line.setAttribute('x2', '196');
        }
        if (i % 5 === 0) line.classList.add('is-major');
        fragment.appendChild(line);
      }
      view.ticks.appendChild(fragment);
    }

    if (view.knurl) {
      const fragment = doc.createDocumentFragment();
      for (let i = -3; i <= 3; i += 1) {
        const line = doc.createElementNS(svgNS, 'line');
        line.setAttribute('x1', layout.axis === 'x' ? String(i * 4) : '-14');
        line.setAttribute('x2', layout.axis === 'x' ? String(i * 4) : '14');
        line.setAttribute('y1', layout.axis === 'x' ? '-10' : String(i * 4));
        line.setAttribute('y2', layout.axis === 'x' ? '10' : String(i * 4));
        fragment.appendChild(line);
      }
      view.knurl.appendChild(fragment);
    }

    if (view.ring) {
      view.ring.style.strokeDasharray = `${view.circumference.toFixed(2)}`;
      view.ring.style.strokeDashoffset = `${view.circumference.toFixed(2)}`;
    }
  }

  /* ------------------------------------------------------------------
     اختيار المسار بحسب الشاشة
     ------------------------------------------------------------------ */

  const layoutQuery = window.matchMedia?.('(max-width: 720px) and (orientation: portrait)');

  function syncLayout() {
    const portrait = Boolean(layoutQuery?.matches);
    app.dataset.layout = portrait ? 'portrait' : 'landscape';
    rig.setAttribute('aria-orientation', portrait ? 'vertical' : 'horizontal');
    if (onLayout) onLayout(portrait ? 'portrait' : 'landscape');
  }

  syncLayout();
  if (layoutQuery?.addEventListener) layoutQuery.addEventListener('change', syncLayout);
  else if (layoutQuery?.addListener) layoutQuery.addListener(syncLayout);

  function activeView() {
    return app.dataset.layout === 'portrait' && views[1] ? views[1] : views[0];
  }

  /** تحويل نقطة على الشاشة إلى نسبة على المسار النشط. */
  function fractionFromClient(clientX, clientY) {
    const view = activeView();
    if (!view?.svg?.getScreenCTM) return null;
    const ctm = view.svg.getScreenCTM();
    if (!ctm) return null;
    const point = view.svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const local = point.matrixTransform(ctm.inverse());
    const value = view.layout.axis === 'x' ? local.x : local.y;
    return (value - view.layout.origin) / view.layout.length;
  }

  /* ------------------------------------------------------------------
     الحالة → الرسم
     ------------------------------------------------------------------ */

  const background = [
    doc.querySelector('.topbar'),
    doc.querySelector('.lead'),
    doc.querySelector('.stage'),
    doc.querySelector('.foot'),
  ];
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let lastAria = '';
  let lastReadout = '';
  let lastLabel = '';
  let lastGuide = '';
  let guideIsReason = false;
  /** رسالة سبب الفشل تبقى على الشاشة مدةً قبل أن يعود السطر إلى التوجيه العادي. */
  let guideLockUntil = 0;

  /**
   * سطر واحد يشرح الوضع الحالي: أين الهدف، هل أنت داخله، وماذا تفعل الآن.
   * القاعدة: نصّ إرشادي واحد في كل لحظة، لا أكثر.
   */
  function contextualGuide(state) {
    const inZone = Math.abs(state.position - state.targetCenter) <= state.targetHalfWidth;
    if (state.phase === 'open') return STRINGS.guideOpen;
    if (state.phase === 'holding') return inZone ? STRINGS.guideHold : STRINGS.guideOut;
    if (state.progress > 0.002 && !inZone) return STRINGS.guideDrain;
    if (state.grabbed) return inZone ? STRINGS.guideEnter : STRINGS.guideApproach;
    if (state.progress > 0.002) return STRINGS.guideDrain;
    return state.failCount > 0 ? STRINGS.guideRest : STRINGS.guideIdle;
  }

  function setGuide(text, { reason = false } = {}) {
    if (!guidance || !text) return;
    if (text === lastGuide && reason === guideIsReason) return;
    lastGuide = text;
    guideIsReason = reason;
    guidance.textContent = text;
    guidance.classList.toggle('is-reason', reason);
  }

  /** يعلّق سطر الشرح على سبب الفشل ثم يعيده إلى التوجيه اللحظي. */
  function announceGuide(text, holdMs = 4200) {
    if (!guidance) return;
    guideLockUntil = performance.now() + holdMs;
    setGuide(text, { reason: true });
  }

  /** إمساك المزلاج من جديد يلغي بقية رسالة السبب. */
  function releaseGuide() {
    guideLockUntil = 0;
  }
  let noticeTimer = null;
  let completionTimer = null;

  function render(state) {
    const progress = Math.min(1, Math.max(0, state.progress));
    const decoyOn = state.decoy !== null && state.decoy !== undefined;

    for (const view of views) {
      const { axis, origin, length, cross } = view.layout;
      const position = origin + state.position * length;
      const center = origin + state.targetCenter * length;
      const decoy = decoyOn ? origin + state.decoy * length : null;

      if (axis === 'x') {
        view.bolt.setAttribute('transform', `translate(${position.toFixed(2)} ${cross})`);
        const targetTransform = `translate(${center.toFixed(2)} ${cross}) scale(${state.zoneScale.toFixed(4)} 1)`;
        view.targetFill.setAttribute('transform', targetTransform);
        view.targetMarks.setAttribute('transform', targetTransform);
        if (decoy !== null) {
          view.decoy.setAttribute('transform', `translate(${decoy.toFixed(2)} ${cross})`);
        }
      } else {
        view.bolt.setAttribute('transform', `translate(${cross} ${position.toFixed(2)})`);
        const targetTransform = `translate(${cross} ${center.toFixed(2)}) scale(1 ${state.zoneScale.toFixed(4)})`;
        view.targetFill.setAttribute('transform', targetTransform);
        view.targetMarks.setAttribute('transform', targetTransform);
        if (decoy !== null) {
          view.decoy.setAttribute('transform', `translate(${cross} ${decoy.toFixed(2)})`);
        }
      }

      view.ring.style.strokeDashoffset = (view.circumference * (1 - progress)).toFixed(2);
    }

    if (app.dataset.decoy !== (decoyOn ? 'on' : 'off')) {
      app.dataset.decoy = decoyOn ? 'on' : 'off';
    }
    app.classList.toggle('is-charging', progress > 0.002);

    /* داخل الإطار أم خارجه؟ قراءة صريحة، لا تُترك للتخمين. */
    const inZone = Math.abs(state.position - state.targetCenter) <= state.targetHalfWidth;
    const tracking = state.grabbed || state.phase === 'holding' || progress > 0.002;
    const zone = tracking ? (inZone ? 'in' : 'out') : 'rest';
    if (app.dataset.zone !== zone) app.dataset.zone = zone;

    if (readoutLabel) {
      const label = tracking && !inZone ? STRINGS.readoutOut : STRINGS.readout;
      if (label !== lastLabel) {
        lastLabel = label;
        readoutLabel.textContent = label;
      }
    }

    /* التوجيه اللحظي: يتوقف عند رسالة سبب، ثم يعود من تلقاء نفسه. */
    if (performance.now() >= guideLockUntil) {
      setGuide(contextualGuide(state));
    }

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
    } else if (state.phase === 'holding' && !inZone) {
      valueText = STRINGS.a11yOut;
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

  function showCompletion(report = '') {
    if (!done) return;
    if (doneReport) doneReport.textContent = report;
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
    fractionFromClient,
    announceGuide,
    releaseGuide,
    showNotice,
    hideNotice,
    showCompletion,
    hideCompletion,
    setSoundLabel,
    focusRig,
  };
}
