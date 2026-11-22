/* Original chiptune arrangements. Each phrase spans two 4/4 bars. */
(() => {
  const scores = {
    title: [116, "triangle", [48, 55, 57, 53, 50, 57, 53, 55], [
      "67 - 72 - 76 74 72 - 79 - 77 74 71 - - -",
      "72 76 81 - 84 - 81 76 77 - 76 72 69 - - -",
      "74 - 77 81 86 - 81 - 84 81 76 - 79 - 76 -",
      "77 81 84 - 81 77 76 - 74 - 71 74 79 - - -",
    ]],
    explore: [130, "triangle", [55, 52, 48, 50, 55, 47, 48, 50], [
      "74 71 - 74 79 - 78 76 76 - 71 67 69 71 - -",
      "72 76 - 79 81 79 76 - 74 - 69 74 78 - 76 -",
      "71 - 74 79 83 - 79 74 78 - 74 71 69 71 - -",
      "76 79 84 - 79 - 76 72 74 76 78 - 81 - 78 -",
    ]],
    town: [84, "sine", [48, 52, 53, 43, 45, 40, 50, 43], [
      "64 - 67 - 72 - - 71 67 - 64 67 71 - - -",
      "69 - 72 77 76 - 72 - 74 - 71 - 67 - - -",
      "72 - 76 - 81 - 79 76 71 - 67 - 64 - - -",
      "65 - 69 74 72 - 69 - 67 - 71 - 74 - - -",
    ]],
    battle: [174, "square", [43, 44, 46, 38, 43, 41, 44, 38], [
      "79 - 74 79 82 81 79 74 80 75 - 80 83 80 75 -",
      "82 77 82 86 85 - 82 77 81 - 78 74 78 81 84 -",
      "86 82 79 74 79 82 - 86 84 81 77 72 77 81 84 -",
      "83 80 - 75 80 83 87 - 86 84 81 78 74 - 78 -",
    ]],
    duel: [146, "square", [50, 48, 46, 45, 50, 43, 46, 45], [
      "74 - - 81 77 - 74 - 76 - 79 84 79 - 76 -",
      "77 - 82 - 86 - 82 77 76 81 - 85 88 - 85 -",
      "89 - 86 81 77 - 81 - 82 - 79 74 79 - 82 -",
      "86 - 82 77 82 - 86 - 85 81 76 - 73 - 76 -",
    ]],
    arcade: [166, "square", [48, 50, 53, 55, 48, 57, 50, 55], [
      "76 79 84 - 79 84 88 - 86 81 78 - 81 86 90 -",
      "89 84 81 84 89 - 84 81 83 86 91 - 86 83 79 -",
      "84 - 76 79 84 88 91 - 88 84 81 - 84 88 93 -",
      "90 86 81 78 81 86 90 - 91 - 86 83 79 83 86 -",
    ]],
    puzzle: [102, "sine", [50, 48, 53, 45, 50, 46, 55, 45], [
      "69 - 74 - - 77 76 - 67 - - 72 76 - 74 -",
      "69 - 77 - 81 - 77 - 76 - 72 - 69 - - -",
      "74 - - 77 81 - 79 77 70 - 74 - - 77 74 -",
      "71 - 74 79 - 77 74 - 73 - 76 - 81 - - -",
    ]],
    suspense: [76, "triangle", [47, 47, 48, 48, 47, 45, 48, 42], [
      "71 - - - - 77 - - 72 - - - - - 66 -",
      "72 - - - - 78 - - 73 - - - - - 67 -",
      "78 - - 77 - - - - 69 - - - 75 - - -",
      "72 - 78 - - - - - 70 - - - - 66 - -",
    ]],
    results: [110, "triangle", [53, 48, 50, 46, 53, 57, 46, 48], [
      "69 - 72 77 81 - 77 - 76 - 72 - 67 - - -",
      "69 - 74 77 81 - 84 - 82 - 77 - 74 - - -",
      "77 - 81 84 89 - 84 - 81 - 76 - 72 - - -",
      "74 - 77 82 81 - 77 - 76 - 79 - 84 - - -",
    ]],
    victory: [152, "triangle", [53, 53], ["77 - 81 84 89 - 84 89 93 - - - - - - -"]],
    defeat: [92, "sine", [45, 45], ["76 - 72 - 71 - 69 - - - - - - - - -"]],
    evolution: [135, "triangle", [53, 60], ["72 77 81 84 81 84 89 91 96 - - - - - - -"]],
  };
  const oneShots = new Set(["victory", "defeat", "evolution"]);
  const sampleRate = 22050;
  const buffers = new Map();
  let context, musicGain, effectsGain, source, playingScene, scene = "title";
  let preferences = { muted: false, music: 55, effects: 80 };
  try {
    preferences.muted = localStorage.getItem("auroraMute") === "1";
    for (const key of ["music", "effects"]) {
      const stored = localStorage.getItem("auroraVolume-" + key);
      const value = Number(stored);
      if (stored !== null && Number.isFinite(value))
        preferences[key] = Math.max(0, Math.min(100, value));
    }
  } catch {}

  function addNote(samples, at, duration, note, waveform, level) {
    const first = Math.round(at * sampleRate);
    const length = Math.min(Math.floor(duration * sampleRate), samples.length - first);
    const frequency = 440 * 2 ** ((note - 69) / 12);
    for (let index = 0; index < length; index++) {
      const phase = (index * frequency / sampleRate) % 1;
      const sine = Math.sin(phase * 2 * Math.PI);
      const wave = waveform === "square" ? .68 * sine + .22 * Math.sin(phase * 6 * Math.PI)
        : waveform === "triangle" ? 1 - 4 * Math.abs(phase - .5) : sine;
      const envelope = Math.min(index / 170, (length - index) / 650, 1);
      samples[first + index] += wave * level * envelope;
    }
  }

  function scoreBuffer(name) {
    if (buffers.has(name)) return buffers.get(name);
    const [tempo, waveform, roots, phrases] = scores[name];
    const step = 30 / tempo;
    const buffer = context.createBuffer(1, Math.round(phrases.length * 16 * step * sampleRate), sampleRate);
    const samples = buffer.getChannelData(0);
    const fast = ["arcade", "battle", "duel"].includes(name);
    const fanfare = oneShots.has(name);
    phrases.join(" ").split(" ").forEach((note, index, melody) => {
      const at = index * step;
      const root = roots[Math.floor(index / 8)];
      if (note !== "-") {
        let length = 1;
        while (melody[index + length] === "-") length++;
        addNote(samples, at, step * Math.min(length - .12, 3.6), Number(note), waveform, .22);
      }
      if (fanfare) return;
      if (index % (fast ? 2 : 4) === 0)
        addNote(samples, at, step * (fast ? .85 : 2.6), root - 12, "triangle", .19);
      if (index % 4 === 2)
        addNote(samples, at, step * .85, root + 7, "sine", .09);
      if (fast && index % 4 === 0)
        addNote(samples, at, .07, 30, "sine", .13);
    });
    buffers.set(name, buffer);
    return buffer;
  }

  function applyVolume() {
    if (!context) return;
    for (const [gain, value] of [[musicGain, preferences.music], [effectsGain, preferences.effects]]) {
      gain.gain.setTargetAtTime(preferences.muted ? 0 : value / 100, context.currentTime, .025);
    }
  }

  function startScene() {
    if (context?.state !== "running" || playingScene === scene) return;
    playingScene = scene;
    const now = context.currentTime;
    if (source) {
      source.gain.gain.setTargetAtTime(0, now, .055);
      source.player.stop(now + .32);
      source = null;
    }
    if (!scores[scene]) return;
    const player = context.createBufferSource();
    const gain = context.createGain();
    player.buffer = scoreBuffer(scene);
    player.loop = !oneShots.has(scene);
    gain.gain.setValueAtTime(0, now);
    gain.gain.setTargetAtTime(1, now, .055);
    player.connect(gain).connect(musicGain);
    player.onended = () => {
      if (source?.player === player) source = null;
      player.disconnect();
      gain.disconnect();
    };
    player.start();
    source = { player, gain };
  }

  let resumeRequest;
  function unlock() {
    if (preferences.muted) return;
    try {
      if (!context) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        context = new Audio();
        musicGain = context.createGain();
        effectsGain = context.createGain();
        musicGain.connect(context.destination);
        effectsGain.connect(context.destination);
        applyVolume();
      }
      if (context.state === "running") return startScene();
      if (resumeRequest) return;
      resumeRequest = context.resume().then(() => {
        startScene();
      }).catch(() => {}).finally(() => { resumeRequest = null; });
    } catch {}
  }

  function setScene(next) {
    if (next === scene) return;
    scene = next;
    startScene();
  }

  function update(key, value) {
    preferences[key] = value;
    applyVolume();
    try {
      if (key === "muted") localStorage.setItem("auroraMute", value ? "1" : "0");
      else localStorage.setItem("auroraVolume-" + key, String(value));
    } catch {}
    unlock();
  }

  function rhythmNote(frequency, index) {
    if (context?.state !== "running" || scene !== "rhythm" || preferences.muted) return;
    const time = context.currentTime;
    const bass = [48, 46, 53, 55][Math.floor(index / 4) % 4];
    for (const [pitch, type, volume, duration] of [
      [frequency, "triangle", .24, .15],
      [440 * 2 ** ((bass - 69) / 12), "triangle", .16, .22],
    ]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.value = pitch;
      gain.gain.setValueAtTime(.001, time);
      gain.gain.exponentialRampToValueAtTime(volume, time + .01);
      gain.gain.exponentialRampToValueAtTime(.001, time + duration);
      oscillator.connect(gain).connect(musicGain);
      oscillator.start(time);
      oscillator.stop(time + duration);
    }
  }

  window.AuroraAudio = {
    unlock, setScene, rhythmNote, update,
    get context() { return context; },
    get effects() { return effectsGain; },
    get preferences() { return { ...preferences }; },
  };
})();
