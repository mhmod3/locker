/**
 * أصوات ميكانيكية قصيرة ومكتومة، مولّدة بالكامل عبر WebAudio (بلا ملفات).
 * لا تعمل إلا بعد أول لمسة من اللاعب (سياسة المتصفح) ويمكن كتمها بزر واحد.
 */

import { CONFIG } from './config.js';

export function createSound() {
  let ctx = null;
  let master = null;
  let enabled = true;

  function ensure() {
    if (!enabled) return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!ctx) {
      ctx = new AudioCtx();
      // ضاغط خفيف: يرفع الحضور دون أن تصبح الذروات مؤذية.
      const settings = CONFIG.audio;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = settings.compressor.threshold;
      compressor.knee.value = settings.compressor.knee;
      compressor.ratio.value = settings.compressor.ratio;
      compressor.attack.value = settings.compressor.attack;
      compressor.release.value = settings.compressor.release;

      master = ctx.createGain();
      master.gain.value = settings.master;
      master.connect(compressor).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function tone({ freq = 220, endFreq = freq, type = 'sine', dur = 0.16, gain = 0.05, delay = 0 }) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(24, endFreq), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + Math.min(0.012, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise({ dur = 0.06, gain = 0.03, freq = 1800, q = 1, type = 'bandpass', delay = 0 }) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + delay;
    const length = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    source.connect(filter).connect(g).connect(master);
    source.start(t0);
    source.stop(t0 + dur + 0.02);
  }

  const voices = {
    grab() {
      noise({ dur: 0.04, gain: 0.06, freq: 2600, q: 1.8 });
      tone({ freq: 168, endFreq: 132, type: 'triangle', dur: 0.07, gain: 0.045 });
    },
    hold() {
      tone({ freq: 380, endFreq: 340, type: 'sine', dur: 0.08, gain: 0.03 });
      noise({ dur: 0.03, gain: 0.024, freq: 1200, q: 2 });
    },
    recoil() {
      tone({ freq: 112, endFreq: 58, type: 'sine', dur: 0.34, gain: 0.12 });
      noise({ dur: 0.14, gain: 0.08, freq: 420, q: 0.7 });
    },
    shift() {
      noise({ dur: 0.035, gain: 0.06, freq: 3400, q: 2 });
      tone({ freq: 640, endFreq: 520, type: 'square', dur: 0.045, gain: 0.024 });
    },
    squeeze() {
      tone({ freq: 128, endFreq: 74, type: 'sawtooth', dur: 0.5, gain: 0.03 });
      noise({ dur: 0.4, gain: 0.026, freq: 260, q: 0.6 });
    },
    shove() {
      tone({ freq: 92, endFreq: 48, type: 'sine', dur: 0.26, gain: 0.11 });
      noise({ dur: 0.1, gain: 0.06, freq: 320, q: 0.7 });
    },
    decoy() {
      // نقرة كاذبة تشبه تعشيق المزلاج
      noise({ dur: 0.03, gain: 0.06, freq: 2400, q: 2 });
      noise({ dur: 0.03, gain: 0.05, freq: 2400, q: 2, delay: 0.09 });
    },
    zoneIn() {
      noise({ dur: 0.02, gain: 0.05, freq: 3200, q: 2.4 });
      tone({ freq: 720, endFreq: 690, type: 'sine', dur: 0.035, gain: 0.02 });
    },

    zoneOut() {
      tone({ freq: 240, endFreq: 168, type: 'sine', dur: 0.09, gain: 0.05 });
      noise({ dur: 0.03, gain: 0.035, freq: 900, q: 1.4 });
    },

    stall() {
      tone({ freq: 72, endFreq: 66, type: 'sine', dur: 0.18, gain: 0.055 });
    },
    fail() {
      tone({ freq: 80, endFreq: 44, type: 'sine', dur: 0.8, gain: 0.12 });
      noise({ dur: 0.3, gain: 0.07, freq: 280, q: 0.5 });
    },
    unlock() {
      // ثقل معدني قصير، لا نغمة موسيقية
      tone({ freq: 118, endFreq: 52, type: 'sine', dur: 0.5, gain: 0.14 });
      noise({ dur: 0.16, gain: 0.06, freq: 500, q: 0.6 });
      tone({ freq: 744, endFreq: 700, type: 'triangle', dur: 0.22, gain: 0.032, delay: 0.04 });
    },
  };

  function play(name) {
    if (!enabled) return;
    const voice = voices[name];
    if (!voice) return;
    if (!ensure()) return;
    try {
      voice();
    } catch {
      /* الصوت رفاهية؛ لا يُسقط اللعبة. */
    }
  }

  function toggle() {
    enabled = !enabled;
    if (enabled) play('hold');
    return enabled;
  }

  return {
    play,
    toggle,
    get enabled() {
      return enabled;
    },
  };
}
