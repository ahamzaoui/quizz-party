/* ═══════════════════════════════════════════════════════════════════
   QUIZZ PARTY — Sound System (Web Audio API)
   No external files needed — all sounds are synthesized!
   ═══════════════════════════════════════════════════════════════════ */

const SoundFX = (() => {
  let ctx = null;
  let enabled = true;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function play(fn) {
    if (!enabled) return;
    try { fn(getCtx()); } catch(e) { /* silent fail */ }
  }

  // ── Correct answer: ascending happy tone ──
  function correct() {
    play(ctx => {
      [523, 659, 784].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.3);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.12);
        osc.stop(ctx.currentTime + i * 0.12 + 0.3);
      });
    });
  }

  // ── Wrong answer: descending buzz ──
  function wrong() {
    play(ctx => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(150, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.4);
    });
  }

  // ── Tick (timer warning) ──
  function tick() {
    play(ctx => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.connect(gain).connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.1);
    });
  }

  // ── Countdown beep ──
  function countdown() {
    play(ctx => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 660;
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.2);
    });
  }

  // ── New question whoosh ──
  function whoosh() {
    play(ctx => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(200, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.3);
    });
  }

  // ── Player joined bloop ──
  function join() {
    play(ctx => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.25);
    });
  }

  // ── Victory fanfare ──
  function victory() {
    play(ctx => {
      const notes = [523, 659, 784, 1047];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.18);
        osc.stop(ctx.currentTime + i * 0.18 + 0.5);
      });
    });
  }

  // ── Ambient tick loop for tension (returns stop function) ──
  function startTension(bpm = 120) {
    if (!enabled) return () => {};
    let running = true;
    const interval = 60000 / bpm;
    const id = setInterval(() => { if (running) tick(); }, interval);
    return () => { running = false; clearInterval(id); };
  }

  function toggle() { enabled = !enabled; return enabled; }
  function isEnabled() { return enabled; }

  // Insert sound toggle button in page
  function initToggle() {
    const btn = document.createElement('button');
    btn.className = 'sound-toggle';
    btn.textContent = '🔊';
    btn.title = 'Sons on/off';
    btn.addEventListener('click', () => {
      const on = toggle();
      btn.textContent = on ? '🔊' : '🔇';
    });
    document.body.appendChild(btn);
  }

  document.addEventListener('DOMContentLoaded', initToggle);

  return { correct, wrong, tick, countdown, whoosh, join, victory, startTension, toggle, isEnabled };
})();
