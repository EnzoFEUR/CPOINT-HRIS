// Enterprise Singleton Web Audio API Notification Synthesizer
let sharedAudioCtx = null;

export const playNotificationChime = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    if (!sharedAudioCtx) {
      sharedAudioCtx = new AudioContext();
    }

    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }

    const now = sharedAudioCtx.currentTime;

    // Note 1: D5 (587.33 Hz)
    const osc1 = sharedAudioCtx.createOscillator();
    const gain1 = sharedAudioCtx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(sharedAudioCtx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Note 2: A5 (880.00 Hz)
    const osc2 = sharedAudioCtx.createOscillator();
    const gain2 = sharedAudioCtx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.08);
    gain2.gain.setValueAtTime(0.18, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc2.connect(gain2);
    gain2.connect(sharedAudioCtx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.55);
  } catch {
    // Audio autostart might be blocked if user has not interacted with DOM yet
  }
};
