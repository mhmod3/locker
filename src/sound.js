/**
 * أصوات ميكانيكية قصيرة ومكتومة، مولّدة بالكامل عبر WebAudio (بلا ملفات).
 * لا تعمل إلا بعد أول لمسة من اللاعب (سياسة المتصفح) ويمكن كتمها بزر واحد.
 */

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
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function tone({ freq = 220, endFreq = freq, type = 'sine', dur = 0.2, gain = 0.05, delay = 0 }) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(24, endFreq), t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + Math.min(0.02, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  function noise({ dur = 0.12, gain = 0.04, freq = 1400, q = 0.8, type = 'bandpass', delay = 0 }) {
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
      noise({ dur: 0.05, gain: 0.03, freq: 2400, q: 1.6 });
      tone({ freq: 175, endFreq: 138, type: 'triangle', dur: 0.09, gain: 0.026 });
    },
    hold() {
      tone({ freq: 430, endFreq: 392, type: 'sine', dur: 0.1, gain: 0.016 });
    },
    recoil() {
      tone({ freq: 118, endFreq: 60, type: 'sine', dur: 0.36, gain: 0.065 });
      noise({ dur: 0.18, gain: 0.045, freq: 420, q: 0.6 });
    },
    provoke() {
      tone({ freq: 92, endFreq: 68, type: 'sine', dur: 0.55, gain: 0.03 });
    },
    fail() {
      tone({ freq: 84, endFreq: 46, type: 'sine', dur: 0.95, gain: 0.07 });
      noise({ dur: 0.42, gain: 0.04, freq: 300, q: 0.5 });
    },
    unlock() {
      tone({ freq: 523.25, type: 'sine', dur: 1.7, gain: 0.05 });
      tone({ freq: 784, type: 'sine', dur: 1.9, gain: 0.028, delay: 0.07 });
      noise({ dur: 0.5, gain: 0.016, freq: 3200, q: 2 });
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
