/* Direct MP3 playback for the Akiva Publishing reader. */
(() => {
  'use strict';

  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5];
  const TRACKS = {
    'Peri Tzadik, Noach 2': {
      key: 'teitelbaum-noach-2',
      label: 'Noach · Ois Beis (2) · אות ב׳',
      src: 'audio/rabbi-moshe-teitelbaum-noach-ois-2.mp3',
      duration: '35:36', bytes: '12.7 MB'
    },
    'Peri Tzadik, Noach 4': {
      key: 'teitelbaum-noach-4',
      label: 'Noach · Ois Daled (4) · אות ד׳',
      src: 'audio/rabbi-moshe-teitelbaum-noach-ois-4.mp3',
      duration: '27:01', bytes: '9.7 MB'
    },
    'Peri Tzadik, Noach 6': {
      key: 'noach-ois-vav-6',
      label: 'Noach · Ois Vav (6) · אות ו׳',
      speaker: 'Pri Tzaddik shiur recording',
      src: 'audio/pri-tzaddik-noach-ois-6.m4a',
      format: 'M4A',
      duration: '55:15', bytes: '20.8 MB'
    },
    'Peri Tzadik, Noach 8': {
      key: 'teitelbaum-noach-8',
      label: 'Noach · Ois Ches (8) · אות ח׳',
      src: 'audio/rabbi-moshe-teitelbaum-noach-ois-4.mp3',
      duration: '27:01', bytes: '9.7 MB'
    }
  };
  const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const time = seconds => {
    const n = Math.max(0, Math.floor(seconds));
    return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  };
  const read = key => {
    try {
      const value = JSON.parse(localStorage.getItem('rtl.audio.' + key));
      return value && typeof value === 'object' ? value : {};
    } catch { return {}; }
  };

  function render(ref) {
    const track = TRACKS[ref];
    if (!track) return '';
    return `<aside class="shiur-audio" data-shiur-key="${track.key}" aria-label="Listen to the Noach shiur">
      <h3>🎧 Listen to the Shiur · ${escape(track.label)}</h3>
      <p class="shiur-audio-meta">${escape(track.speaker || 'Rabbi Moshe Teitelbaum')} · Pri Tzaddik, Parshas Noach · ${track.duration} · ${track.format || 'MP3'} (${track.bytes})</p>
      <audio controls preload="none" src="${escape(track.src)}" aria-label="${escape(track.speaker || 'Rabbi Moshe Teitelbaum')}, ${escape(track.label)}"></audio>
      <div class="shiur-audio-controls">
        <label>Speed <select class="shiur-speed" aria-label="Playback speed">${SPEEDS.map(speed => `<option value="${speed}"${speed === 1 ? ' selected' : ''}>${speed}×${speed === 1 ? ' (normal)' : ''}</option>`).join('')}</select></label>
        <label>Volume boost <select class="shiur-boost" aria-label="Volume boost"><option value="1">Normal</option><option value="1.5">1.5×</option><option value="2">2×</option><option value="3">3×</option></select></label>
        <button class="btn shiur-resume" type="button" hidden>Resume</button>
        <button class="btn shiur-restart" type="button">Start over</button>
      </div>
      <p class="shiur-audio-status" role="status" aria-live="polite">Your place is saved automatically in this browser.</p>
      <div class="shiur-audio-actions">
        <button class="btn shiur-retry" type="button" hidden>Retry audio</button>
        <a class="btn primary" href="${escape(track.src)}" download="${track.key}.${(track.format||'mp3').toLowerCase()}">↓ Download ${escape(track.format || 'MP3')}</a>
        <a class="btn" href="${escape(track.src)}" target="_blank" rel="noopener noreferrer">Open audio ↗</a>
      </div>
    </aside>`;
  }

  function mount(section) {
    const card = section.querySelector('.shiur-audio');
    if (!card) return null;
    const audio = card.querySelector('audio');
    const speed = card.querySelector('.shiur-speed');
    const boost = card.querySelector('.shiur-boost');
    const resume = card.querySelector('.shiur-resume');
    const restart = card.querySelector('.shiur-restart');
    const retry = card.querySelector('.shiur-retry');
    const status = card.querySelector('.shiur-audio-status');
    const key = card.dataset.shiurKey;
    const saved = read(key);
    const settings = read('settings');
    let position = Number.isFinite(saved.position) && saved.position >= 0 ? saved.position : 0;
    let pendingResume = position;
    let disposed = false, graph = null, preparingGraph = null, lastSave = 0;
    const listeners = [];
    const on = (target, event, fn) => {
      target.addEventListener(event, fn);
      listeners.push(() => target.removeEventListener(event, fn));
    };
    const write = (storageKey, value) => {
      try { localStorage.setItem('rtl.audio.' + storageKey, JSON.stringify(value)); }
      catch { status.textContent = 'Automatic resume is unavailable in this browser.'; }
    };
    const showResume = () => {
      resume.hidden = position < 1;
      resume.textContent = `Resume from ${time(position)}`;
    };
    const save = (force = false) => {
      if (disposed || (!force && Date.now() - lastSave < 5000)) return;
      lastSave = Date.now();
      // Leaving an unplayed card must not erase a previously saved position.
      const current = pendingResume !== null && audio.readyState === 0 ? pendingResume : audio.currentTime;
      if (!Number.isFinite(current)) return;
      position = audio.ended ? 0 : Math.max(0, current);
      write(key, {position, updatedAt: Date.now()});
      showResume();
    };
    const play = () => audio.play().catch(() => {
      if (!disposed && !audio.error) status.textContent = 'Press play to continue listening.';
    });
    const restorePosition = () => {
      if (pendingResume === null || !Number.isFinite(audio.duration)) return;
      const requested = pendingResume;
      pendingResume = null;
      position = requested >= audio.duration - 1 ? 0 : Math.min(requested, audio.duration - 0.25);
      audio.currentTime = Math.max(0, position);
      showResume();
      retry.hidden = true;
      if (position > 0) status.textContent = `Resuming from ${time(position)}. Your place is saved automatically.`;
    };

    speed.value = String(SPEEDS.includes(settings.speed) ? settings.speed : 1);
    audio.defaultPlaybackRate = audio.playbackRate = Number(speed.value);
    audio.preservesPitch = true;
    if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = true;
    showResume();
    if (position > 0) status.textContent = `Press play to resume from ${time(position)}.`;
    on(audio, 'loadedmetadata', restorePosition);
    if (audio.readyState >= 1) restorePosition();
    on(speed, 'change', () => {
      audio.defaultPlaybackRate = audio.playbackRate = Number(speed.value);
      write('settings', {speed: audio.playbackRate});
    });
    on(audio, 'ratechange', () => {
      if (SPEEDS.includes(audio.playbackRate)) {
        speed.value = String(audio.playbackRate);
        write('settings', {speed: audio.playbackRate});
      }
    });
    on(resume, 'click', () => {
      if (audio.readyState >= 1) audio.currentTime = position;
      else pendingResume = position;
      play();
    });
    on(restart, 'click', () => {
      pendingResume = 0; position = 0;
      if (audio.readyState >= 1) { audio.currentTime = 0; pendingResume = null; }
      write(key, {position: 0, updatedAt: Date.now()});
      showResume();
      status.textContent = 'Starting from the beginning.';
    });
    on(retry, 'click', () => {
      pendingResume = position;
      status.textContent = 'Loading audio…';
      audio.load();
      play();
    });
    on(audio, 'error', () => {
      status.textContent = 'Audio could not load. Retry or download the MP3.';
      retry.hidden = false;
    });
    on(audio, 'canplay', () => { retry.hidden = true; });
    on(audio, 'timeupdate', () => save());
    on(audio, 'seeked', () => save(true));
    on(audio, 'pause', () => save(true));
    on(audio, 'ended', () => {
      save(true);
      status.textContent = 'Finished. Press play to listen again.';
    });
    on(window, 'pagehide', () => save(true));
    on(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') save(true); });

    // Create the boost graph only after a user requests it. Ordinary playback
    // keeps the browser's native audio path, including on mobile Safari.
    const ensureGraph = async () => {
      if (graph) {
        if (graph.context.state === 'suspended') await graph.context.resume();
        return graph;
      }
      if (preparingGraph) return preparingGraph;
      preparingGraph = (async () => {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) throw new Error('Boost unavailable');
        const context = new Context();
        try {
          await context.resume();
          if (disposed || context.state !== 'running') throw new Error('Boost unavailable');
          const gain = context.createGain();
          const limiter = context.createDynamicsCompressor();
          limiter.threshold.value = -3;
          limiter.knee.value = 0;
          limiter.ratio.value = 20;
          limiter.attack.value = 0.003;
          limiter.release.value = 0.25;
          const source = context.createMediaElementSource(audio);
          source.connect(gain); gain.connect(limiter); limiter.connect(context.destination);
          graph = {context, gain};
          return graph;
        } catch (error) {
          context.close().catch(() => {});
          throw error;
        }
      })();
      try { return await preparingGraph; }
      finally { preparingGraph = null; }
    };
    on(boost, 'change', async () => {
      if (Number(boost.value) === 1 && !graph) return;
      try {
        const {context, gain} = await ensureGraph();
        if (!disposed) {
          gain.gain.setTargetAtTime(Number(boost.value), context.currentTime, 0.025);
          status.textContent = Number(boost.value) === 1 ? 'Normal volume.' : `Volume boost: ${boost.value}×.`;
        }
      } catch {
        if (disposed) return;
        boost.value = '1';
        boost.disabled = true;
        status.textContent = 'Volume boost is unavailable here. The normal player volume still works.';
      }
    });
    on(audio, 'play', () => {
      document.querySelectorAll('.shiur-audio audio').forEach(other => { if (other !== audio) other.pause(); });
      if (graph && graph.context.state === 'suspended') graph.context.resume().catch(() => {});
    });

    return () => {
      save(true);
      disposed = true;
      listeners.forEach(remove => remove());
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      if (graph) graph.context.close().catch(() => {});
    };
  }

  window.AkivaShiurPlayer = {render, mount};
})();
