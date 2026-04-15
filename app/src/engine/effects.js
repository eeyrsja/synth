import { clamp } from "./types.js";

/**
 * Generate an impulse response buffer for convolution reverb.
 */
export function generateIR(ctx, decay) {
  const len = Math.floor(ctx.sampleRate * clamp(decay, 0.1, 5));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  }
  return buf;
}

/**
 * Create the full effects chain (distortion, chorus, delay, reverb).
 * Returns an object of node groups keyed by effect ID.
 */
export function createEffectsChain(ctx) {
  // Reverb
  const reverbDry = ctx.createGain();  reverbDry.gain.value = 1;
  const reverbWet = ctx.createGain();  reverbWet.gain.value = 0;
  const convolver = ctx.createConvolver();
  convolver.buffer = generateIR(ctx, 2.0);
  const reverbIn = ctx.createGain();
  reverbIn.connect(reverbDry);  reverbIn.connect(convolver);
  convolver.connect(reverbWet);

  // Delay
  const delayDry = ctx.createGain();   delayDry.gain.value = 1;
  const delayWet = ctx.createGain();   delayWet.gain.value = 0;
  const delayNode = ctx.createDelay(2.0);
  delayNode.delayTime.value = 0.35;
  const delayFb = ctx.createGain();    delayFb.gain.value = 0.4;
  const delayIn = ctx.createGain();
  delayIn.connect(delayDry);  delayIn.connect(delayNode);
  delayNode.connect(delayFb);  delayFb.connect(delayNode);
  delayNode.connect(delayWet);

  // Chorus
  const chorusDry = ctx.createGain();  chorusDry.gain.value = 1;
  const chorusWet = ctx.createGain();  chorusWet.gain.value = 0;
  const chorusDl = ctx.createDelay(0.05);
  chorusDl.delayTime.value = 0.006;
  const chorusLfo = ctx.createOscillator();
  chorusLfo.type = "sine";  chorusLfo.frequency.value = 1.5;
  const chorusDepth = ctx.createGain();
  chorusDepth.gain.value = 0.003;
  chorusLfo.connect(chorusDepth);
  chorusDepth.connect(chorusDl.delayTime);
  chorusLfo.start();
  const chorusIn = ctx.createGain();
  chorusIn.connect(chorusDry);  chorusIn.connect(chorusDl);
  chorusDl.connect(chorusWet);

  // Distortion
  const distNode = ctx.createWaveShaper();
  distNode.oversample = "4x";
  const distDry = ctx.createGain();
  const distWet = ctx.createGain();
  distDry.gain.value = 1;
  distWet.gain.value = 0;
  const distFilter = ctx.createBiquadFilter();
  distFilter.type = "lowpass";
  distFilter.frequency.value = 20000;
  const distIn = ctx.createGain();
  distIn.connect(distDry);
  distIn.connect(distNode);
  distNode.connect(distFilter);
  distFilter.connect(distWet);

  return {
    distortion: { in: distIn, node: distNode, filter: distFilter, dry: distDry, wet: distWet },
    chorus:     { in: chorusIn, dry: chorusDry, wet: chorusWet, lfo: chorusLfo, depth: chorusDepth, dl: chorusDl },
    delay:      { in: delayIn, dry: delayDry, wet: delayWet, node: delayNode, fb: delayFb },
    reverb:     { in: reverbIn, dry: reverbDry, wet: reverbWet, conv: convolver },
  };
}

/**
 * Wire effects chain in the given order, connecting voiceFilter → effects → masterGain.
 */
export function rewireFxChain(fxNodes, order, masterGain, voiceFilter) {
  if (!fxNodes || !voiceFilter || !masterGain) return;
  const ids = ["distortion", "chorus", "delay", "reverb"];
  // Disconnect inter-effect wiring
  voiceFilter.disconnect();
  for (const id of ids) {
    fxNodes[id].dry.disconnect();
    fxNodes[id].wet.disconnect();
  }
  // Reconnect based on order
  voiceFilter.connect(fxNodes[order[0]].in);
  for (let i = 0; i < order.length - 1; i++) {
    fxNodes[order[i]].dry.connect(fxNodes[order[i + 1]].in);
    fxNodes[order[i]].wet.connect(fxNodes[order[i + 1]].in);
  }
  const last = order[order.length - 1];
  fxNodes[last].dry.connect(masterGain);
  fxNodes[last].wet.connect(masterGain);
}

/**
 * Sync effect parameter values to audio nodes.
 */
export function syncFxParams(fxNodes, fxParams) {
  if (!fxNodes) return;

  const dp = fxParams.distortion;
  if (dp.enabled) {
    const k = clamp(dp.drive, 1, 30);
    const n = 256;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      const xs = clamp(x + (dp.asym || 0) * (x * x - 0.33), -1.2, 1.2);
      const soft = Math.tanh(k * xs);
      const hard = (2 / Math.PI) * Math.atan((k * 1.8) * xs);
      curve[i] = clamp(soft * 0.72 + hard * 0.28, -1, 1);
    }
    fxNodes.distortion.node.curve = curve;
    fxNodes.distortion.filter.frequency.value = 350 + dp.tone * 18000;
    fxNodes.distortion.wet.gain.value = dp.mix;
    fxNodes.distortion.dry.gain.value = 1 - dp.mix;
  } else {
    fxNodes.distortion.node.curve = null;
    fxNodes.distortion.filter.frequency.value = 20000;
    fxNodes.distortion.wet.gain.value = 0;
    fxNodes.distortion.dry.gain.value = 1;
  }

  const cp = fxParams.chorus;
  fxNodes.chorus.wet.gain.value = cp.enabled ? cp.mix : 0;
  fxNodes.chorus.lfo.frequency.value = cp.rate;
  fxNodes.chorus.depth.gain.value = cp.depth;

  const dl = fxParams.delay;
  fxNodes.delay.wet.gain.value = dl.enabled ? dl.mix : 0;
  fxNodes.delay.node.delayTime.value = dl.time;
  fxNodes.delay.fb.gain.value = dl.feedback;

  const rp = fxParams.reverb;
  fxNodes.reverb.wet.gain.value = rp.enabled ? rp.mix : 0;
}

/**
 * Update the reverb impulse response when decay changes.
 */
export function updateReverbDecay(ctx, fxNodes, decay) {
  if (!ctx || !fxNodes) return;
  fxNodes.reverb.conv.buffer = generateIR(ctx, decay);
}
