// Plays an alert beep using Web Audio API when scraping stalls.
// Runs in an offscreen document (service workers cannot play audio).

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'PLAY_BEEP') return;

  const ctx = new AudioContext();

  // Three ascending tones: 440Hz → 554Hz → 659Hz (A4 → C#5 → E5)
  const tones = [440, 554, 659];
  tones.forEach((freq, i) => {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.value = freq;

    const start = ctx.currentTime + i * 0.35;
    const end   = start + 0.25;

    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.4, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, end);

    osc.start(start);
    osc.stop(end);
  });

  // Play the 3-tone sequence twice for more urgency
  tones.forEach((freq, i) => {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.value = freq;

    const start = ctx.currentTime + 1.2 + i * 0.35;
    const end   = start + 0.25;

    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.4, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, end);

    osc.start(start);
    osc.stop(end);
  });

  setTimeout(() => ctx.close(), 3000);
});
