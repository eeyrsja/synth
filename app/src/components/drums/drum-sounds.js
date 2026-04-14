import { T } from "../../engine";

export const DRUM_SOUNDS = [
  { id: "po", label: "Po", desc: "Bass · 30ms", color: T.accent },
  { id: "pi", label: "Pi", desc: "Click · 20ms", color: T.green },
  { id: "sha", label: "Sha", desc: "Noise · 160ms", color: T.amber },
];

export function triggerDrumSound(ctx, dest, time, type, params, noiseBuf) {
  if (type === "po") {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(params.pitch * 2, time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(params.pitch, 20), time + 0.015);
    g.gain.setValueAtTime(params.volume, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + Math.max(params.decay, 0.005));
    osc.connect(g); g.connect(dest);
    osc.start(time); osc.stop(time + params.decay + 0.05);
  } else if (type === "pi") {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(params.pitch, time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(params.pitch * 0.5, 20), time + Math.max(params.decay, 0.005));
    g.gain.setValueAtTime(params.volume * 0.3, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + Math.max(params.decay, 0.005));
    osc.connect(g); g.connect(dest);
    osc.start(time); osc.stop(time + params.decay + 0.05);
  } else if (type === "sha") {
    if (!noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bpf = ctx.createBiquadFilter();
    bpf.type = "bandpass";
    bpf.frequency.value = params.pitch;
    bpf.Q.value = 1.0;
    const g = ctx.createGain();
    g.gain.setValueAtTime(params.volume * 0.4, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + Math.max(params.decay, 0.005));
    src.connect(bpf); bpf.connect(g); g.connect(dest);
    src.start(time); src.stop(time + params.decay + 0.05);
  }
}

export const PO32_SOUNDS = [
  { id: 0,  name: "Kick 1",    short: "KK1", ch: 1, color: "#ff5544" },
  { id: 1,  name: "Snare 1",   short: "SN1", ch: 1, color: "#ff8844" },
  { id: 2,  name: "Shaker",    short: "SHK", ch: 1, color: "#ffaa33" },
  { id: 3,  name: "Zap",       short: "ZAP", ch: 1, color: "#ffcc22" },
  { id: 4,  name: "Kick 2",    short: "KK2", ch: 2, color: "#44ff66" },
  { id: 5,  name: "Snare 2",   short: "SN2", ch: 2, color: "#33ddaa" },
  { id: 6,  name: "Hi-Hat C",  short: "HHC", ch: 2, color: "#33ccdd" },
  { id: 7,  name: "Hi-Hat O",  short: "HHO", ch: 2, color: "#44aaff" },
  { id: 8,  name: "Low Tom",   short: "LTM", ch: 3, color: "#8866ff" },
  { id: 9,  name: "Rimshot",   short: "RIM", ch: 3, color: "#aa55ff" },
  { id: 10, name: "Tamb",      short: "TMB", ch: 3, color: "#cc44ee" },
  { id: 11, name: "Clap",      short: "CLP", ch: 3, color: "#ff44cc" },
  { id: 12, name: "Bass",      short: "BAS", ch: 4, color: "#ff4488" },
  { id: 13, name: "FM",        short: "FM ", ch: 4, color: "#ff6666" },
  { id: 14, name: "Synth",     short: "SYN", ch: 4, color: "#ee8844" },
  { id: 15, name: "Noise",     short: "NOI", ch: 4, color: "#ddaa33" },
];

export const PO32_TEMPO_PRESETS = [
  { name: "Hip Hop", bpm: 80 },
  { name: "Disco", bpm: 120 },
  { name: "Techno", bpm: 140 },
];

export function triggerPO32Sound(ctx, dest, time, soundId, params, noiseBuf) {
  const pitch = params.pitch;
  const morph = params.morph;

  switch (soundId) {
    case 0: case 4: {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      const basePitch = soundId === 0 ? pitch * 80 : pitch * 60;
      osc.frequency.setValueAtTime(basePitch * 3, time);
      osc.frequency.exponentialRampToValueAtTime(Math.max(basePitch, 20), time + 0.04 + morph * 0.06);
      const decay = 0.15 + morph * 0.25;
      g.gain.setValueAtTime(0.9, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + decay);
      osc.connect(g); g.connect(dest);
      osc.start(time); osc.stop(time + decay + 0.05);
      const click = ctx.createOscillator();
      const cg = ctx.createGain();
      click.type = "sine";
      click.frequency.value = basePitch * 1.5;
      cg.gain.setValueAtTime(0.3, time);
      cg.gain.exponentialRampToValueAtTime(0.001, time + 0.01);
      click.connect(cg); cg.connect(dest);
      click.start(time); click.stop(time + 0.05);
      break;
    }
    case 1: case 5: {
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(pitch * 200, time);
      osc.frequency.exponentialRampToValueAtTime(Math.max(pitch * 120, 20), time + 0.05);
      const decay = 0.12 + morph * 0.15;
      og.gain.setValueAtTime(0.5, time);
      og.gain.exponentialRampToValueAtTime(0.001, time + decay);
      osc.connect(og); og.connect(dest);
      osc.start(time); osc.stop(time + decay + 0.05);
      if (noiseBuf) {
        const ns = ctx.createBufferSource(); ns.buffer = noiseBuf;
        const nf = ctx.createBiquadFilter(); nf.type = "highpass";
        nf.frequency.value = soundId === 1 ? 3000 + morph * 4000 : 5000 + morph * 3000;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.6, time);
        ng.gain.exponentialRampToValueAtTime(0.001, time + decay * 1.2);
        ns.connect(nf); nf.connect(ng); ng.connect(dest);
        ns.start(time); ns.stop(time + decay * 1.2 + 0.05);
      }
      break;
    }
    case 2: {
      if (!noiseBuf) break;
      const ns = ctx.createBufferSource(); ns.buffer = noiseBuf;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass";
      bp.frequency.value = 6000 + pitch * 4000; bp.Q.value = 1 + morph * 3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.4, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.06 + morph * 0.1);
      ns.connect(bp); bp.connect(g); g.connect(dest);
      ns.start(time); ns.stop(time + 0.2);
      break;
    }
    case 3: {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(pitch * 2000, time);
      osc.frequency.exponentialRampToValueAtTime(Math.max(pitch * 100, 20), time + 0.05 + morph * 0.15);
      g.gain.setValueAtTime(0.4, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.08 + morph * 0.12);
      osc.connect(g); g.connect(dest);
      osc.start(time); osc.stop(time + 0.3);
      break;
    }
    case 6: case 7: {
      if (!noiseBuf) break;
      const ns = ctx.createBufferSource(); ns.buffer = noiseBuf;
      const hp = ctx.createBiquadFilter(); hp.type = "highpass";
      hp.frequency.value = 7000 + pitch * 3000;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass";
      bp.frequency.value = 10000; bp.Q.value = 2;
      const g = ctx.createGain();
      const decay = soundId === 6 ? 0.04 + morph * 0.04 : 0.15 + morph * 0.3;
      g.gain.setValueAtTime(0.35, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + decay);
      ns.connect(hp); hp.connect(bp); bp.connect(g); g.connect(dest);
      ns.start(time); ns.stop(time + decay + 0.05);
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 4000 + pitch * 2000;
      og.gain.setValueAtTime(0.08, time);
      og.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.5);
      osc.connect(og); og.connect(dest);
      osc.start(time); osc.stop(time + decay + 0.05);
      break;
    }
    case 8: {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(pitch * 150, time);
      osc.frequency.exponentialRampToValueAtTime(Math.max(pitch * 60, 20), time + 0.1);
      const decay = 0.2 + morph * 0.3;
      g.gain.setValueAtTime(0.7, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + decay);
      osc.connect(g); g.connect(dest);
      osc.start(time); osc.stop(time + decay + 0.05);
      break;
    }
    case 9: {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = pitch * 800;
      g.gain.setValueAtTime(0.5, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.03 + morph * 0.02);
      osc.connect(g); g.connect(dest);
      osc.start(time); osc.stop(time + 0.1);
      if (noiseBuf) {
        const ns = ctx.createBufferSource(); ns.buffer = noiseBuf;
        const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 6000;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.3, time);
        ng.gain.exponentialRampToValueAtTime(0.001, time + 0.02);
        ns.connect(hp); hp.connect(ng); ng.connect(dest);
        ns.start(time); ns.stop(time + 0.08);
      }
      break;
    }
    case 10: {
      if (!noiseBuf) break;
      const ns = ctx.createBufferSource(); ns.buffer = noiseBuf;
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 8000 + pitch * 2000;
      const g = ctx.createGain();
      const decay = 0.08 + morph * 0.15;
      g.gain.setValueAtTime(0.35, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + decay);
      ns.connect(hp); hp.connect(g); g.connect(dest);
      ns.start(time); ns.stop(time + decay + 0.05);
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 5000 + pitch * 1000;
      og.gain.setValueAtTime(0.05, time);
      og.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.3);
      osc.connect(og); og.connect(dest);
      osc.start(time); osc.stop(time + decay + 0.05);
      break;
    }
    case 11: {
      if (!noiseBuf) break;
      for (let j = 0; j < 3; j++) {
        const ns = ctx.createBufferSource(); ns.buffer = noiseBuf;
        const bp = ctx.createBiquadFilter(); bp.type = "bandpass";
        bp.frequency.value = 1500 + pitch * 1500; bp.Q.value = 1;
        const g = ctx.createGain();
        const t = time + j * 0.012;
        g.gain.setValueAtTime(0.4, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
        ns.connect(bp); bp.connect(g); g.connect(dest);
        ns.start(t); ns.stop(t + 0.06);
      }
      const tail = ctx.createBufferSource(); tail.buffer = noiseBuf;
      const tbp = ctx.createBiquadFilter(); tbp.type = "bandpass";
      tbp.frequency.value = 1500 + pitch * 1500; tbp.Q.value = 1;
      const tg = ctx.createGain();
      const decay = 0.1 + morph * 0.2;
      tg.gain.setValueAtTime(0.5, time + 0.04);
      tg.gain.exponentialRampToValueAtTime(0.001, time + 0.04 + decay);
      tail.connect(tbp); tbp.connect(tg); tg.connect(dest);
      tail.start(time + 0.04); tail.stop(time + 0.04 + decay + 0.05);
      break;
    }
    case 12: {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = morph > 0.5 ? "sawtooth" : "sine";
      osc.frequency.setValueAtTime(pitch * 55, time);
      const decay = 0.2 + morph * 0.4;
      g.gain.setValueAtTime(0.7, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + decay);
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass";
      lp.frequency.setValueAtTime(400 + morph * 2000, time);
      lp.frequency.exponentialRampToValueAtTime(Math.max(100, 100 + morph * 200), time + decay);
      osc.connect(lp); lp.connect(g); g.connect(dest);
      osc.start(time); osc.stop(time + decay + 0.05);
      break;
    }
    case 13: {
      const carrier = ctx.createOscillator();
      const mod = ctx.createOscillator();
      const modGain = ctx.createGain();
      const g = ctx.createGain();
      carrier.type = "sine";
      mod.type = "sine";
      carrier.frequency.value = pitch * 200;
      mod.frequency.value = pitch * 200 * (1 + morph * 6);
      modGain.gain.setValueAtTime(pitch * 400 * morph, time);
      modGain.gain.exponentialRampToValueAtTime(1, time + 0.15 + morph * 0.1);
      const decay = 0.1 + morph * 0.2;
      g.gain.setValueAtTime(0.5, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + decay);
      mod.connect(modGain); modGain.connect(carrier.frequency);
      carrier.connect(g); g.connect(dest);
      mod.start(time); carrier.start(time);
      mod.stop(time + decay + 0.1); carrier.stop(time + decay + 0.1);
      break;
    }
    case 14: {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = pitch * 220;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass";
      lp.frequency.setValueAtTime(800 + morph * 6000, time);
      lp.frequency.exponentialRampToValueAtTime(Math.max(200, 200 + morph * 400), time + 0.15);
      lp.Q.value = 2 + morph * 6;
      const decay = 0.1 + morph * 0.2;
      g.gain.setValueAtTime(0.45, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + decay);
      osc.connect(lp); lp.connect(g); g.connect(dest);
      osc.start(time); osc.stop(time + decay + 0.05);
      break;
    }
    case 15: {
      if (!noiseBuf) break;
      const ns = ctx.createBufferSource(); ns.buffer = noiseBuf;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass";
      lp.frequency.value = 2000 + pitch * 8000;
      const g = ctx.createGain();
      const decay = 0.05 + morph * 0.3;
      g.gain.setValueAtTime(0.45, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + decay);
      ns.connect(lp); lp.connect(g); g.connect(dest);
      ns.start(time); ns.stop(time + decay + 0.05);
      break;
    }
    default: break;
  }
}
