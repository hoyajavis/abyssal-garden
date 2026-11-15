// ============================================================================
// audio: procedural subterranean Descent synth & reactor ambience (no sample files)
// ============================================================================
// A fixed Web Audio graph driven by a 10 Hz timer:
// Layers: deep reactor core thrum, ventilation turbine wind, Pyro-GX thruster hum (follows ship speed),
// dark minor-key industrial synth pad, plasma recharge sparks, and distant robotic patrol telemetry.
let AC, OUT, muted = false;
const VOL = 0.78;
function mkSound(ac) {
  const sr = ac.sampleRate;
  const N = (C, o, ...to) => { const n = new C(ac, o); for (const d of to) n.connect(d); if (n.start) n.start(); return n; };
  const G = (gain, ...to) => N(GainNode, { gain }, ...to);
  const BQ = (type, frequency, Q, ...to) => N(BiquadFilterNode, { type, frequency, Q }, ...to);
  const lfo = (frequency, depth, to) => N(OscillatorNode, { frequency }, G(depth, to));
  const noise = (secs, f) => { const n = sr * secs | 0, b = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: sr }); f(b.getChannelData(0), n); f(b.getChannelData(1), n); return b; };
  const nb = noise(11, (d, n) => { for (let i = 0, b = 0; i < n + 4096; i++) { b = (b + 0.02 * (rnd() * 2 - 1)) / 1.02; if (i < n) d[i] = b * 3.5; else { const k = (i - n) / 4096; d[i - n] = d[i - n] * k + b * 3.5 * (1 - k); } } });
  const ir = noise(5, (d, n) => { for (let i = 0, b = 0; i < n; i++) { const t = i / sr; b += (rnd() * 2 - 1 - b) * (0.04 + 0.5 * exp(-t * 2)); d[i] = b * (1 - exp(-t * 30)) * exp(-t * 1.4) * (1 - i / n); } });

  const lim = N(DynamicsCompressorNode, { threshold: -6, knee: 6, ratio: 20, attack: 0.003, release: 0.3 }, ac.destination);
  const out = OUT = G(0, lim), wet = N(ConvolverNode, { buffer: ir }, out);
  const src = (playbackRate, ...to) => N(AudioBufferSourceNode, { buffer: nb, loop: true, playbackRate }, ...to);
  // Reactor Core Sub-Bass Thrum
  const rum = G(0.38, out); src(1, BQ('lowpass', 120, 1.2, rum)); lfo(0.45, 0.14, rum.gain); lfo(0.11, 0.08, rum.gain);
  // Subterranean Ventilation Draft + Pyro-GX Thruster Afterburner Rush
  const wash = G(0.22, out), wave = G(1, wash), rush = G(0, out), rushF = BQ('bandpass', 260, 1.4, rush);
  src(0.63, BQ('bandpass', 340, 0.8, wave), rushF); lfo(0.12, 0.25, wave.gain);
  // Dark Industrial Synth Drone (D Phrygian / Minor fifths, detuned sawtooth/triangle hybrid)
  const pad = G(1, out, G(1.6, wet));
  [55, 82.41, 110, 164.81, 220].forEach((f, i) => { const g = G(0.020 - i * 0.003, pad); N(OscillatorNode, { type: i < 2 ? 'triangle' : 'sine', frequency: f }, g); N(OscillatorNode, { frequency: f + rr(0.05, 0.18) }, g); });
  // Pooled synth voices: plasma sparks, metallic sonar pings, and robotic patrol chatter
  const pool = (n, send, type) => Array.from({ length: n }, () => { const p = N(StereoPannerNode, {}, out, G(send, wet)), g = G(0, p); return { p, g, o: N(OscillatorNode, { type }, g) }; });
  const bub = pool(4, 0.25, 'sawtooth'), chime = pool(3, 1.4, 'sine'), whale = pool(2, 2.2, 'square');
  const play = (vs, t, f0, f1, dur, vol, att) => {
    const v = vs.shift(), f = v.o.frequency, g = v.g.gain; vs.push(v);
    v.p.pan.setValueAtTime(rr(-0.75, 0.75), t);
    f.setValueAtTime(f0, t); f.exponentialRampToValueAtTime(f1, t + dur);
    g.setValueAtTime(0, t); g.linearRampToValueAtTime(vol, t + att); g.setTargetAtTime(0, t + att, (dur - att) / 5);
  };
  const NOTES = [0, 1, 3, 5, 7, 8, 10, 12, 15]; // Dark Sci-Fi Phrygian intervals
  let lt = ac.currentTime, tB = lt + 1.5, tC = lt + 4, tW = lt + 10, lx = F[CX], ly = F[CY], lz = F[CZ];
  out.gain.setTargetAtTime(VOL, lt, 1);
  return () => {
    const now = ac.currentTime, t = now + 0.05, dt = now - lt;
    if (dt <= 0) return;
    let v = hypot(F[CX] - lx, F[CY] - ly, F[CZ] - lz) / dt; if (v > 65) v = 0;
    lt = now; lx = F[CX]; ly = F[CY]; lz = F[CZ];
    rush.gain.setTargetAtTime(0.55 * pow(min(v / 28, 1), 1.15), t, 0.25); rushF.frequency.setTargetAtTime(160 + v * 16, t, 0.25);
    const coreProx = clamp(1 - hypot(lx, lz) / 60, 0, 1);
    wash.gain.setTargetAtTime(0.2 + 0.45 * coreProx, t, 0.5);
    if (t > tB) { // Plasma arc / Energy Center recharge crackle
      let tt = t;
      for (let n = 1 + rnd() * 4 | 0; n--;) { const f = rr(240, 980); play(bub, tt, f, f * rr(0.6, 1.8), 0.06 + 30 / f, rr(0.015, 0.04), 0.005); tt += rr(0.06, 0.16); }
      tB = tt + rr(0.8, 4.5);
    }
    if (t > tC) { const f = 220 * pow(2, NOTES[rnd() * 9 | 0] / 12); play(chime, t, f, f * 0.995, 4.5, rr(0.018, 0.035), 0.02); tC = t + rr(2.5, 8); }
    if (t > tW) { // Distant Mining Automaton telemetry / hull resonance
      let tt = t;
      for (let n = 2 + rnd() * 3 | 0; n--;) { const f = rr(110, 290), d = rr(0.4, 1.2); play(whale, tt, f, f * rr(0.7, 1.4), d, 0.025, d * 0.25); tt += d * 0.65; }
      tW = tt + rr(14, 35);
    }
  };
}
function sound() {
  if (!AC) { AC = new AudioContext({ latencyHint: 'playback' }); setInterval(mkSound(AC), 100); }
  if (AC.state === 'suspended' && !document.hidden) AC.resume();
}
const mute = () => { muted = !muted; OUT.gain.setTargetAtTime(muted ? 0 : VOL, AC.currentTime, 0.08); };
document.addEventListener('visibilitychange', () => { if (AC) document.hidden ? AC.suspend() : AC.resume(); });
