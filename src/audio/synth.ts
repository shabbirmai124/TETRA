// Procedural Web Audio API synthesizer — zero external audio files, minimal memory footprint.

export type SoundEvent =
  | 'move'
  | 'rotate'
  | 'softDrop'
  | 'hardDrop'
  | 'hold'
  | 'line1'
  | 'line2'
  | 'line3'
  | 'quad'
  | 'tspin'
  | 'levelUp'
  | 'gameOver'
  | 'victory';

class SoundSynth {
  private ctx: AudioContext | null = null;
  private muted = false;
  private volume = 0.35;

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
  }

  public play(event: SoundEvent): void {
    const ctx = this.ensureContext();
    if (!ctx || this.volume <= 0.001) return;

    const now = ctx.currentTime;
    const masterGain = this.volume;

    switch (event) {
      case 'move':
        this.tone(ctx, 220, 200, 0.035, 'triangle', 0.14 * masterGain, now);
        break;
      case 'rotate':
        this.tone(ctx, 340, 480, 0.05, 'sine', 0.18 * masterGain, now);
        break;
      case 'softDrop':
        this.tone(ctx, 160, 140, 0.025, 'sine', 0.1 * masterGain, now);
        break;
      case 'hardDrop':
        this.tone(ctx, 150, 58, 0.09, 'triangle', 0.35 * masterGain, now);
        this.tone(ctx, 90, 42, 0.1, 'square', 0.12 * masterGain, now);
        break;
      case 'hold':
        this.tone(ctx, 392, 523.25, 0.06, 'sine', 0.2 * masterGain, now);
        break;
      case 'line1':
        this.tone(ctx, 523.25, 659.25, 0.14, 'triangle', 0.28 * masterGain, now);
        break;
      case 'line2':
        this.tone(ctx, 523.25, 659.25, 0.11, 'triangle', 0.26 * masterGain, now);
        this.tone(ctx, 659.25, 783.99, 0.14, 'triangle', 0.28 * masterGain, now + 0.06);
        break;
      case 'line3':
        this.tone(ctx, 523.25, 659.25, 0.1, 'triangle', 0.26 * masterGain, now);
        this.tone(ctx, 659.25, 783.99, 0.1, 'triangle', 0.28 * masterGain, now + 0.05);
        this.tone(ctx, 783.99, 987.77, 0.16, 'triangle', 0.3 * masterGain, now + 0.1);
        break;
      case 'quad':
        this.tone(ctx, 523.25, 523.25, 0.09, 'square', 0.2 * masterGain, now);
        this.tone(ctx, 659.25, 659.25, 0.09, 'square', 0.2 * masterGain, now + 0.06);
        this.tone(ctx, 783.99, 783.99, 0.09, 'square', 0.22 * masterGain, now + 0.12);
        this.tone(ctx, 1046.5, 1046.5, 0.26, 'triangle', 0.34 * masterGain, now + 0.18);
        break;
      case 'tspin':
        this.tone(ctx, 440, 880, 0.12, 'sawtooth', 0.18 * masterGain, now);
        this.tone(ctx, 659.25, 1318.5, 0.18, 'triangle', 0.26 * masterGain, now + 0.07);
        break;
      case 'levelUp':
        this.tone(ctx, 587.33, 587.33, 0.08, 'triangle', 0.25 * masterGain, now);
        this.tone(ctx, 739.99, 739.99, 0.08, 'triangle', 0.25 * masterGain, now + 0.08);
        this.tone(ctx, 880, 1174.66, 0.2, 'triangle', 0.3 * masterGain, now + 0.16);
        break;
      case 'victory':
        this.tone(ctx, 523.25, 523.25, 0.1, 'triangle', 0.28 * masterGain, now);
        this.tone(ctx, 659.25, 659.25, 0.1, 'triangle', 0.28 * masterGain, now + 0.1);
        this.tone(ctx, 783.99, 783.99, 0.1, 'triangle', 0.28 * masterGain, now + 0.2);
        this.tone(ctx, 1046.5, 1046.5, 0.35, 'triangle', 0.35 * masterGain, now + 0.3);
        break;
      case 'gameOver':
        this.tone(ctx, 330, 261.63, 0.16, 'sawtooth', 0.2 * masterGain, now);
        this.tone(ctx, 261.63, 196, 0.18, 'sawtooth', 0.2 * masterGain, now + 0.15);
        this.tone(ctx, 196, 130.81, 0.34, 'triangle', 0.28 * masterGain, now + 0.32);
        break;
    }
  }

  private tone(
    ctx: AudioContext,
    startFreq: number,
    endFreq: number,
    duration: number,
    type: OscillatorType,
    peakGain: number,
    startTime: number,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, startTime);
    if (endFreq !== startFreq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), startTime + duration);
    }

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.015);
  }
}

export const soundSynth = new SoundSynth();
