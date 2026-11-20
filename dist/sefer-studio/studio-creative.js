(() => {
  'use strict';
  const api = 'https://akiva-publishing-kisvei-rav-tzadok.akivagutnicki.workers.dev/v1/';
  const endpoint = api + 'audio';
  const segmentWorker = new URL('./audio-segments.js', document.currentScript.src);
  const MAX_AUDIO_BYTES = 200_000_000;
  const INLINE_MIB = { sofer: 18, gemini: 12 };
  const find = (id) => document.getElementById(id);
  const formats = { m4a:'audio/m4a', mp4:'audio/m4a', mp3:'audio/mp3', wav:'audio/wav', ogg:'audio/ogg', webm:'audio/webm',
    flac:'audio/flac', aiff:'audio/aiff', aif:'audio/aiff', aac:'audio/aac', opus:'audio/opus', mpeg:'audio/mpeg' };
  const unpoint = (text) => text.replace(/[\u05b0-\u05bd\u05bf\u05c1\u05c2\u05c7]/g, '');
  const extension = (name) => name?.toLowerCase().split('.').pop();
  let file = null, previewUrl = '', recording = null, requestingMic = false, active = null, revision = 0;

  let accessKey = '', segmentedRun = null;
  function requireAccess() {
    if (!/^sfpro_[0-9a-f]{64}$/.test(accessKey)) throw new Error('Enter your SoferStudio access key under API Key.');
    return accessKey;
  }
  async function request(action, data, access, signal) {
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + access };
    const response = await fetch(endpoint, {
      method: 'POST', headers, body: JSON.stringify({ ...data, action }), signal,
      credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
    });
    let result;
    try { result = await response.json(); } catch { throw new Error('The transcription service is unreachable or returned an invalid response.'); }
    if (!response.ok) {
      const error = new Error(result.error || 'The provider could not complete the request.');
      error.status = response.status;
      throw error;
    }
    return result;
  }
  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(signal.reason); return; }
      const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
      function cancel() { clearTimeout(timer); reject(signal.reason); }
      signal.addEventListener('abort', cancel, { once: true });
    });
  }
  function encodeAudio(clip, signal) {
    const reader = new FileReader();
    const cancelled = () => reader.abort();
    return new Promise((resolve, reject) => {
      signal.throwIfAborted();
      reader.onload = () => resolve(String(reader.result).split(',', 2)[1]);
      reader.onerror = () => reject(new Error('The audio file could not be read.'));
      reader.onabort = () => reject(signal.reason);
      reader.onloadend = () => signal.removeEventListener('abort', cancelled);
      signal.addEventListener('abort', cancelled, { once: true });
      reader.readAsDataURL(clip);
    });
  }
  function download(blob, name) {
    const ref = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = ref; link.download = name;
    link.click(); setTimeout(() => URL.revokeObjectURL(ref), 30000);
  }
  function exportWordHtml(text, name) {
    const doc = document.implementation.createHTMLDocument(name);
    const style = doc.createElement('style');
    style.textContent = 'body{font-family:"Times New Roman",serif}p{white-space:pre-wrap}';
    doc.head.append(style);
    for (const line of text.split(/\r?\n/)) {
      const p = doc.createElement('p');
      const firstLetter = line.match(/\p{L}/u)?.[0] || '';
      p.dir = /[\p{Script=Hebrew}\p{Script=Arabic}]/u.test(firstLetter) ? 'rtl' : 'ltr';
      p.textContent = line || '\u00a0'; doc.body.append(p);
    }
    download(new Blob(['<!doctype html>\n', doc.documentElement.outerHTML], { type:'text/html;charset=utf-8' }), name + '.html');
  }
  function status(message) { find('studio-audio-status').textContent = message; }
  function editor() { return find('studio-audio-text'); }
  function updateCount() {
    const text = editor().value.trim();
    find('studio-audio-count').textContent = (text ? text.split(/\s+/).length : 0) + ' words';
  }
  function replaceText(text) { editor().value = text; revision++; updateCount(); }
  function setFile(clip) {
    if (active || recording) return;
    if (clip && (!formats[extension(clip.name)] || clip.size < 1 || clip.size > MAX_AUDIO_BYTES)) {
      status('Choose a supported audio file up to 200 MB. You can also use a Sofer.Ai link.'); return;
    }
    const audio = find('studio-audio-player');
    audio.pause(); audio.removeAttribute('src'); audio.load();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = clip ? URL.createObjectURL(clip) : '';
    if (file !== clip) segmentedRun = null;
    file = clip;
    find('studio-audio-preview').hidden = !clip;
    if (clip) {
      find('studio-audio-url').value = '';
      find('studio-audio-filename').textContent = clip.name;
      audio.src = previewUrl;
      status('Audio ready. Select an engine and run transcription.');
    }
    updateEngine();
  }
  function elapsed(start) {
    const seconds = Math.floor((performance.now() - start) / 1000);
    return [Math.floor(seconds / 60), seconds % 60].map(x => String(x).padStart(2, '0')).join(':');
  }
  function stopMic() {
    if (recording?.recorder.state === 'recording') recording.recorder.stop();
    recording?.stream.getTracks().forEach(track => track.stop());
  }
  function updateButtons() {
    find('studio-audio-run').disabled = !!active || !!recording || requestingMic;
    find('studio-audio-resume').disabled = !!active || !!recording || requestingMic;
    find('studio-audio-stop').hidden = !active;
    find('studio-audio-record').disabled = !!active || requestingMic;
    find('studio-audio-point').disabled = !!active;
  }
  async function record() {
    if (recording) { stopMic(); return; }
    if (requestingMic || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder !== 'function') {
      status('Use a supported HTTPS browser with microphone permission, or upload an audio file.'); return;
    }
    let stream;
    requestingMic = true; updateButtons();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      const take = { recorder, stream, parts: [], bytes: 0, start: performance.now(), timer: null, failed: false };
      recording = take;
      const recordLabel = find('studio-audio-record').querySelector('strong');
      const timer = find('studio-audio-timer');
      timer.textContent = '00:00';
      recorder.addEventListener('dataavailable', ({ data }) => {
        if (!data.size) return;
        if (take.bytes + data.size > MAX_AUDIO_BYTES) {
          take.limited = true; stopMic(); return;
        }
        take.bytes += data.size; take.parts.push(data);
      });
      recorder.addEventListener('error', () => { take.failed = true; stopMic(); });
      recorder.addEventListener('stop', () => {
        clearInterval(take.timer);
        stream.getTracks().forEach(track => track.stop());
        recording = null; recordLabel.textContent = 'Record Live Shiur'; updateButtons();
        if (take.failed || !take.parts.length) { status('No usable recording was captured. Check the microphone and try again.'); return; }
        const type = (recorder.mimeType || take.parts[0].type).split(';')[0];
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        setFile(new File(take.parts, 'Live shiur.' + ext, {type}));
        if (take.limited) status('Recording stopped at the upload limit. The captured portion is ready to preview.');
      }, { once: true });
      recorder.start(1000);
      take.timer = setInterval(() => { timer.textContent = elapsed(take.start); }, 500);
      recordLabel.textContent = 'Stop Recording';
      status('Recording from the microphone. Stop to preview the take.');
    } catch {
      stream?.getTracks().forEach(track => track.stop());
      if (recording) clearInterval(recording.timer);
      recording = null;
      status('The microphone could not be opened. Check browser permissions or upload a recording.');
    } finally { requestingMic = false; updateButtons(); }
  }
  function updateEngine() {
    const engine = find('studio-audio-engine');
    const linkMode = !!find('studio-audio-url').value.trim();
    if (linkMode) engine.value = 'sofer';
    engine.disabled = linkMode;
    find('studio-audio-engine-note').textContent = engine.value === 'hybrid'
      ? 'Sofer.Ai and Gemini Neon transcribe in parallel. Gemini Hydrogen reconciles their readings.'
      : engine.value === 'sofer' ? 'Sofer.Ai handles the audio. Nikkud and abbreviation expansion use Gemini Hydrogen.' : 'Gemini transcribes the audio using the selected language, script and timing options.';
  }
  function options() {
    return {
      language: find('studio-audio-language').value, format: find('studio-audio-format').value,
      speakers: find('studio-audio-speakers').checked, nikkud: find('studio-audio-nikkud').checked,
      expand: find('studio-audio-expand').checked,
    };
  }
  async function waitForSofer(id, config, access, signal, progress) {
    const end = Date.now() + 20 * 60 * 1000;
    while (Date.now() < end) {
      progress('Waiting for Sofer.Ai · job ' + id);
      let result;
      try { result = await request('sofer-poll', { id, speakers: config.speakers }, access, signal); }
      catch (error) { if (error.status !== 429) throw error; await wait(60000, signal); continue; }
      if (result.status === 'completed') return result;
      if (result.status === 'failed') {
        const error = new Error('Sofer.Ai reported a failed job. Job ID: ' + id);
        error.failedJob = true;
        throw error;
      }
      await wait(15000, signal);
    }
    throw new Error('Sofer.Ai is still processing. Use Retrieve Transcription with job ' + id + '.');
  }
  async function refine(text, config, access, signal) {
    if (config.expand) text = (await request('expand', { text }, access, signal)).text;
    if (config.nikkud) text = (await request('nikkud', { text }, access, signal)).text;
    return text;
  }
  function openSegmenter(signal) {
    const worker = new Worker(segmentWorker);
    return {
      close: () => worker.terminate(),
      request: (data) => new Promise((resolve, reject) => {
        signal.throwIfAborted();
        const finish = (result, failure) => {
          signal.removeEventListener('abort', cancel);
          worker.onmessage = worker.onerror = worker.onmessageerror = null;
          if (failure) reject(result); else resolve(result);
        };
        const cancel = () => finish(signal.reason, true);
        const unavailable = () => finish(new Error('The browser could not start the audio decoder.'), true);
        signal.addEventListener('abort', cancel, { once: true });
        worker.onmessage = ({ data: result }) => {
          if (result.error) finish(new Error(result.error), true); else finish(result, false);
        };
        worker.onerror = worker.onmessageerror = unavailable;
        try { worker.postMessage(data); } catch (error) { finish(error, true); }
      }),
    };
  }
  function offsetTimes(text, offset) {
    return text.replace(/^([ \t]*(?:[-*] )?)\[(?:(\d+):)?(\d+):([0-5]\d)\]/gm, (_, lead, hours, minutes, seconds) => {
      const time = offset + Number(hours || 0) * 3600 + Number(minutes) * 60 + Number(seconds);
      const stamp = [Math.floor(time / 3600), Math.floor(time / 60) % 60, time % 60]
        .map(value => String(value).padStart(2, '0')).join(':');
      return lead + '[' + stamp + ']';
    });
  }
  async function transcribePart(media, engine, config, access, signal, part, progress) {
    const runSofer = async () => {
      if (!part.jobId) part.jobId = (await request('sofer-start', { ...config, ...media }, access, signal)).id;
      const job = find('studio-audio-job');
      job.value = part.jobId;
      find('studio-audio-resume-box').open = true;
      try { return await waitForSofer(part.jobId, config, access, signal, progress); }
      catch (error) {
        if (error.failedJob) part.jobId = null;
        throw error;
      }
    };
    const runGemini = (model) => request('gemini', { ...config, ...media, model }, access, signal);
    if (engine === 'hybrid') {
      const [sofer, neon] = await Promise.allSettled([runSofer(), runGemini('gemini-4-neon')]);
      signal.throwIfAborted();
      if (sofer.status === 'fulfilled' && neon.status === 'fulfilled') {
        progress('Gemini Hydrogen is reconciling both transcripts…');
        try {
          return { text: (await request('reconcile', { ...config, sofer: sofer.value.text, neon: neon.value.text, ...media }, access, signal)).text };
        } catch (error) {
          signal.throwIfAborted();
          return { text: neon.value.text, warning: 'Hydrogen reconciliation did not finish. Showing the Gemini Neon draft.' };
        }
      }
      if (sofer.status === 'fulfilled') {
        return { text: sofer.value.text, warning: 'Gemini Neon did not finish. Showing the Sofer.Ai draft.' };
      }
      if (neon.status === 'fulfilled') {
        return { text: neon.value.text, warning: 'Sofer.Ai did not finish. Showing the Gemini Neon draft.' };
      }
      throw sofer.reason;
    }
    if (engine === 'sofer') {
      const result = await runSofer();
      let text = result.text;
      let warning = config.speakers && !result.labelsAvailable ? 'Sofer.Ai did not return usable timestamps.' : '';
      try { text = await refine(text, config, access, signal); }
      catch (error) {
        signal.throwIfAborted();
        warning = [warning, 'The Gemini text pass did not finish. Showing the Sofer.Ai transcript.'].filter(Boolean).join(' ');
      }
      return { text, warning };
    }
    progress('Gemini is transcribing the audio…');
    return runGemini(engine);
  }
  async function checkAudioAccess(access, engine, signal) {
    const response = await fetch(api + 'health', {
      headers: { Authorization: 'Bearer ' + access }, credentials: 'omit',
      cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal,
    });
    const result = await response.json();
    if (!response.ok || !result.authorized) throw new Error(result.error || 'The service could not verify your SoferStudio access key.');
    const { sofer, gemini } = result.providers;
    const ready = engine === 'hybrid' ? sofer || gemini : engine === 'sofer' ? sofer : gemini;
    if (!ready) throw new Error('The server operator still needs to configure provider credentials for this engine.');
  }
  async function transcribeLarge(clip, engine, config, access, signal, state) {
    await checkAudioAccess(access, engine, signal);
    status('Loading the local audio decoder…');
    const segmenter = openSegmenter(signal);
    try {
      await segmenter.request({ file: clip });
      while (!state.complete) {
        const index = state.completed.length;
        const progress = (message) => status('Part ' + (index + 1) + ' · ' + message);
        progress('Preparing audio on this device…');
        const { bytes, offset, last } = await segmenter.request({ index });
        if (bytes) {
          const media = { mime: 'audio/wav', audio: await encodeAudio(new Blob([bytes], { type: 'audio/wav' }), signal) };
          const result = await transcribePart(media, engine, config, access, signal, state.pending, progress);
          state.completed.push({ ...result, text: offsetTimes(result.text, offset) });
          state.pending = {};
        }
        state.complete = last;
      }
      if (!state.completed.length) throw new Error('The recording did not contain usable audio.');
    } finally { segmenter.close(); }
  }
  async function run(retrieve = false) {
    if (active || recording || requestingMic) return;
    let access;
    const config = options();
    const engine = retrieve ? 'sofer' : find('studio-audio-engine').value;
    const url = find('studio-audio-url').value.trim();
    const clip = !retrieve && !url ? file : null;
    const cap = engine === 'sofer' ? INLINE_MIB.sofer : INLINE_MIB.gemini;
    const large = clip && clip.size > cap * 1024 * 1024;
    const signature = JSON.stringify({ engine, ...config });
    try {
      if (retrieve && !find('studio-audio-job').value.trim()) throw new Error('Enter the Sofer.Ai job ID.');
      if (!retrieve && !clip && !url) throw new Error('Load a recording, record a shiur or paste a public audio link.');
      access = requireAccess();
    } catch (error) { status(error.message); return; }
    const snapshot = revision;
    const controller = active = new AbortController();
    const { signal } = controller;
    let state;
    updateButtons(); status('Preparing audio…');
    try {
      let results;
      if (large) {
        if (segmentedRun?.signature !== signature || segmentedRun?.access !== access || segmentedRun.complete) {
          segmentedRun = { signature, access, completed: [], pending: {}, complete: false };
        }
        state = segmentedRun;
        await transcribeLarge(clip, engine, config, access, signal, state);
        results = state.completed;
      } else {
        const media = retrieve ? {} : url ? { url } : { mime: formats[extension(clip.name)], audio: await encodeAudio(clip, signal) };
        const part = { jobId: retrieve ? find('studio-audio-job').value.trim() : null };
        results = [await transcribePart(media, engine, config, access, signal, part, status)];
      }
      signal.throwIfAborted();
      if (revision !== snapshot) throw new Error('The editor changed during transcription. Your edits were kept.');
      replaceText(results.map(part => part.text).join('\n\n'));
      const warnings = [...new Set(results.map(part => part.warning).filter(Boolean))];
      status(['Transcription ready. Review it against the audio.',
        large && config.speakers && results.length > 1 ? 'Speaker labels can restart in each part.' : '',
        ...warnings].filter(Boolean).join(' '));
    } catch (error) {
      const finished = state?.completed.length || 0;
      if (finished && revision === snapshot) replaceText(state.completed.map(part => part.text).join('\n\n'));
      if (state && !state.complete && (finished || state.pending.jobId)) {
        const result = finished ? finished + ' part(s) completed. ' : '';
        status((signal.aborted ? 'Stopped. ' : error.message + ' ') + result + 'Select Run Transcription to resume.');
      } else {
        status(signal.aborted ? 'Stopped. Retrieve a submitted Sofer.Ai job by ID when ready.' : error.message);
      }
    } finally { active = null; updateButtons(); }
  }
  async function textAction(action, text, signal, style = 'rabbinic') {
    return (await request(action, { text, style }, requireAccess(), signal)).text;
  }
  async function addNikkud() {
    const text = editor().value;
    if (!text.trim() || active) return;
    const snapshot = revision;
    const controller = active = new AbortController();
    updateButtons(); status('Adding nikkud with Gemini Hydrogen…');
    try {
      const result = await textAction('nikkud', text, controller.signal, find('studio-nikkud-style').value);
      if (revision !== snapshot) throw new Error('The editor changed. Your edits were kept.');
      replaceText(result); status('Nikkud added. Review the vocalization.');
    } catch (error) { status(controller.signal.aborted ? 'Nikkud stopped.' : error.message); }
    finally { active = null; updateButtons(); }
  }
  function bindDrop(target, input, receive) {
    target.addEventListener('click', () => input.click());
    target.addEventListener('dragover', (event) => { event.preventDefault(); event.stopPropagation(); target.dataset.over = 'true'; });
    target.addEventListener('dragleave', () => { delete target.dataset.over; });
    target.addEventListener('drop', (event) => {
      event.preventDefault(); event.stopPropagation(); delete target.dataset.over;
      const [item] = event.dataTransfer.files;
      if (item) receive(item);
    });
    input.addEventListener('change', () => { const [item] = input.files; input.value = ''; if (item) receive(item); });
  }
  function viewAudio(lab) {
    find('panel-audio').classList.toggle('studio-nikkud-lab', lab);
    find('studio-audio-editor-title').textContent = lab ? 'Nikkudot Lab' : 'Transcript Editor';
    for (const tab of document.querySelectorAll('[data-sofer-tab]')) {
      const on = tab.dataset.soferTab === (lab ? 'nikkud' : 'audio');
      if (on) tab.setAttribute('aria-current','page'); else tab.removeAttribute('aria-current');
    }
  }
  async function copy(text) {
    if (!text.trim()) throw new Error('There is no text to copy.');
    await navigator.clipboard.writeText(text);
  }
  function bindAudio() {
    const click = (id, fn) => find(id).addEventListener('click', fn);
    bindDrop(find('studio-audio-drop'), find('studio-audio-file'), setFile);
    click('studio-audio-clear', () => { setFile(null); status('Audio removed.'); });
    click('studio-audio-record', record);
    click('studio-audio-run', () => run());
    click('studio-audio-stop', () => active?.abort());
    click('studio-audio-resume', () => run(true));
    click('studio-audio-sample', async () => {
      const before = file, beforeUrl = find('studio-audio-url').value;
      status('Loading the published Noach Ois 4 shiur…');
      try {
        const response = await fetch('../library/audio/rabbi-moshe-teitelbaum-noach-ois-4.mp3');
        if (!response.ok || response.headers.get('Content-Type')?.includes('text/html')) throw new Error();
        const blob = await response.blob();
        if (file === before && find('studio-audio-url').value === beforeUrl && !recording) setFile(new File([blob], 'Noach Ois 4 sample.mp3',{type:'audio/mpeg'}));
      } catch { status('The sample recording is unavailable. Upload your own file.'); }
    });
    click('studio-audio-keys', () => {
      const panel = find('studio-audio-credentials');
      panel.hidden = !panel.hidden;
      find('studio-audio-keys').setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) find('studio-audio-access').focus();
    });
    click('studio-access-check', async () => {
      const result = find('studio-access-status');
      try {
        const access = requireAccess();
        const reply = await fetch(api + 'health', { headers: { Authorization: 'Bearer ' + access }, cache:'no-store', referrerPolicy:'no-referrer' });
        const data = await reply.json();
        if (!reply.ok || !data.authorized) throw new Error(data.error || 'The service could not verify access.');
        const names = Object.entries(data.providers).filter(([, ready]) => ready).map(([name]) => name === 'sofer' ? 'Sofer.Ai' : 'Gemini');
        result.textContent = names.length ? 'Access verified. Server credentials configured for ' + names.join(' and ') + '.' : 'Access verified. The server operator still needs to configure provider credentials.';
      } catch (error) { result.textContent = error.message; }
    });
    click('studio-audio-api', () => { const info = find('studio-audio-api-info'); info.hidden = !info.hidden; });
    click('studio-audio-install', () => find('btn-pwa-install').click());
    click('studio-audio-point', addNikkud);
    click('studio-audio-unpoint', () => { replaceText(unpoint(editor().value)); status('Vowel points removed.'); });
    click('studio-audio-copy', async () => { try { await copy(editor().value); status('Transcript copied.'); } catch (error) { status(error.message); } });
    click('studio-audio-md', () => { if (editor().value.trim()) download(new Blob([editor().value], {type:'text/markdown;charset=utf-8'}), 'transcript.md'); });
    click('studio-audio-word-html', () => { if (editor().value.trim()) exportWordHtml(editor().value, 'transcript'); });
    click('studio-audio-to-word', () => {
      if (!editor().value.trim()) return;
      window.WordStudioAPI.appendParagraphText(editor().value.trim());
      window.SuiteUI.switchWorkspace('word');
    });
    editor().addEventListener('input', () => { revision++; updateCount(); });
    find('studio-audio-url').addEventListener('input', () => { if (file) setFile(null); updateEngine(); });
    find('studio-audio-engine').addEventListener('change', updateEngine);
    addEventListener('pagehide', () => { stopMic(); active?.abort(); });
    updateEngine(); updateButtons();
  }

  function pdfLayout(focus) {
    const panel = find('panel-pdf');
    panel.classList.toggle('pdf-ocr-focus', focus);
    const button = find('studio-pdf-ocr-toggle');
    button.setAttribute('aria-pressed', String(focus));
    button.textContent = focus ? 'Return to PDF Viewer' : 'Hebrew & Rashi OCR';
  }
  let tiffDecoder;
  function script(src, integrity) {
    return new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = src; tag.integrity = integrity; tag.crossOrigin = 'anonymous';
      tag.addEventListener('load', resolve, { once:true });
      tag.addEventListener('error', reject, { once:true });
      document.head.append(tag);
    });
  }
  async function tiffPdf(file, name) {
    if (!tiffDecoder) {
      tiffDecoder = script('https://cdn.jsdelivr.net/npm/pako@1.0.11/dist/pako_inflate.min.js', 'sha384-eVEAceNXm4nXk77ToJFE5Yyd50iOqdwXwefI35sH/rqeSTw99+DhTt4CzWZU+xBz')
        .then(() => script('https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js', 'sha384-RyBmXHdfZ/Uon+ud+/AqSyWpUWnKYt2tkRG/P4gWoRUGDU+qIAV3tGBPNlYTBZEF'))
        .catch(() => { tiffDecoder = null; throw new Error('The TIFF decoder could not load. Connect to the internet or convert the scan to PDF.'); });
    }
    await tiffDecoder;
    const data = await file.arrayBuffer();
    const images = window.UTIF.decode(data).filter(image => image.t256 && image.t257);
    if (!images.length || images.length > 20) throw new Error('Open a TIFF with up to 20 pages, or convert it to PDF.');
    let totalPixels = 0;
    for (const image of images) {
      const pixels = Number(image.t256[0]) * Number(image.t257[0]);
      if (!Number.isSafeInteger(pixels) || pixels < 1 || pixels > 20_000_000) throw new Error('A TIFF page is too large. Downsize it or convert it to PDF.');
      totalPixels += pixels;
    }
    if (totalPixels > 48_000_000) throw new Error('This TIFF is too large to decode in the browser. Convert it to PDF.');
    const doc = await window.PDFLib.PDFDocument.create();
    for (const image of images) {
      window.UTIF.decodeImage(data,image);
      const rgba = window.UTIF.toRGBA8(image);
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba),image.width,image.height),0,0);
      await addCanvasPage(doc, canvas);
      canvas.width = canvas.height = 1;
      delete image.data;
    }
    await window.PdfStudioAPI.loadPdfBytes(await doc.save(), name, false);
  }
  async function imagePdf(blob, outputName) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(blob);
      if (bitmap.width * bitmap.height > 32_000_000) throw new Error('The page image is too large. Downsize it or open it as a PDF.');
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff'; context.fillRect(0,0,canvas.width,canvas.height);
      context.drawImage(bitmap,0,0);
      return await canvasPdf(canvas, outputName);
    } catch (error) {
      if (/too large/.test(error.message)) throw error;
      throw new Error('This browser could not decode the page image. Convert it to PDF, PNG or JPEG and try again.');
    } finally { bitmap?.close(); }
  }
  async function canvasPdf(canvas, name) {
    const doc = await window.PDFLib.PDFDocument.create();
    await addCanvasPage(doc, canvas);
    await window.PdfStudioAPI.loadPdfBytes(await doc.save(), name, false);
  }
  async function addCanvasPage(doc, canvas) {
    const image = await doc.embedPng(canvas.toDataURL('image/png'));
    const ratio = Math.min(612 / canvas.width, 792 / canvas.height, 1);
    const width = canvas.width * ratio, height = canvas.height * ratio;
    doc.addPage([width,height]).drawImage(image,{x:0,y:0,width,height});
  }
  async function openScan(item) {
    const note = find('studio-pdf-tools-status');
    try {
      if (item.size > 100 * 1024 * 1024) throw new Error('Choose a file under 100 MiB.');
      note.textContent = 'Opening ' + item.name + '…';
      if (extension(item.name) === 'pdf' || item.type === 'application/pdf') {
        await window.PdfStudioAPI.loadPdfBytes(new Uint8Array(await item.arrayBuffer()), item.name, false);
      } else {
        if (!['png','jpg','jpeg','webp','tif','tiff'].includes(extension(item.name))) throw new Error('Choose PDF, PNG, JPEG, WebP, or TIFF.');
        const name = item.name.replace(/\.[^.]+$/, '') + '.pdf';
        if (['tif','tiff'].includes(extension(item.name))) await tiffPdf(item, name);
        else await imagePdf(item, name);
      }
      note.textContent = item.name + ' · ready to scan.';
    } catch (error) { note.textContent = error.message; }
  }
  async function rashiSample() {
    const note = find('studio-pdf-tools-status');
    try {
      await document.fonts.load('42px "Noto Rashi Hebrew"', 'בראשית');
      if (!document.fonts.check('42px "Noto Rashi Hebrew"', 'בראשית')) throw new Error();
      const canvas = document.createElement('canvas');
      canvas.width = 1200; canvas.height = 800;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fcf8ed'; context.fillRect(0,0,1200,800);
      context.fillStyle = '#191611'; context.direction = 'rtl'; context.textAlign = 'right';
      context.font = 'bold 36px "Frank Ruhl Libre", serif'; context.fillText('בראשית א׳', 1100, 95);
      context.font = '42px "Frank Ruhl Libre", serif';
      ['בראשית ברא אלהים', 'את השמים ואת הארץ.', 'יהי אור ויהי אור.'].forEach((line,i) => context.fillText(line, 1100, 205+i*63));
      context.font = '42px "Noto Rashi Hebrew", serif';
      ['בראשית. אמר רבי יצחק', 'לא היה צריך להתחיל את', 'התורה אלא מהחדש הזה לכם,', 'שהיא מצוה ראשונה שנצטוו', 'בה ישראל.'].forEach((line,i) => context.fillText(line, 550, 205+i*63));
      await canvasPdf(canvas, 'Square Hebrew and Rashi sample.pdf');
      note.textContent = 'Sample opened. The square Hebrew column is on the right and the Rashi column on the left.';
    } catch { note.textContent = 'The Rashi sample could not load. Check the connection or open your own scan.'; }
  }
  function bindPdf() {
    const click = (id, fn) => find(id).addEventListener('click', fn);
    bindDrop(find('studio-pdf-drop'), find('studio-pdf-scan-file'), openScan);
    click('studio-pdf-sample', rashiSample);
    click('studio-pdf-ocr-toggle', () => {
      location.hash = find('panel-pdf').classList.contains('pdf-ocr-focus') ? '#/studio/pdf' : '#/studio/pdf/ocr';
    });
    const output = find('pdf-ocr-output');
    const note = find('studio-pdf-tools-status');
    click('studio-pdf-font', () => {
      const rashi = output.classList.toggle('studio-rashi-font');
      find('studio-pdf-font').textContent = rashi ? 'Font: Rashi Script' : 'Font: Square Hebrew';
    });
    click('studio-pdf-copy', async () => { try { await copy(output.value); note.textContent = 'Extracted text copied.'; } catch (error) { note.textContent = error.message; } });
    click('studio-pdf-word-html', () => { if (output.value.trim()) exportWordHtml(output.value, 'extracted-text'); });
    click('studio-pdf-point', async () => {
      const text = output.value;
      if (!text.trim() || output.readOnly) return;
      const guard = window.PdfStudioAPI.captureOcrText();
      const button = find('studio-pdf-point');
      button.disabled = true; note.textContent = 'Adding nikkud with Gemini Hydrogen…';
      try {
        const replacement = await textAction('nikkud',text,AbortSignal.timeout(180000));
        if (!window.PdfStudioAPI.applyOcrText(guard,replacement)) throw new Error('The source page or text changed during the request. Earlier text was kept.');
        note.textContent = 'Nikkud added. Review the vocalization.';
      } catch (error) { note.textContent = error.message; }
      finally { button.disabled = false; }
    });
  }
  window.StudioCreative = { viewAudio, pdfLayout, textAction, requireAccess };
  document.addEventListener('DOMContentLoaded', () => {
    const inputs = [...document.querySelectorAll('[data-studio-access]')];
    for (const input of inputs) input.addEventListener('input', () => {
      accessKey = input.value.trim();
      for (const other of inputs) if (other !== input) other.value = accessKey;
    });
    bindAudio(); bindPdf();
    window.launchQueue?.setConsumer(async ({ files }) => {
      if (!files?.length) return;
      try {
        const item = await files[0].getFile();
        if (extension(item.name) === 'pdf') {
          location.hash = '#/studio/pdf/ocr';
          await openScan(item);
        } else if (extension(item.name) === 'docx') {
          location.hash = '#/studio/word';
          await window.WordStudioApp.loadDocxArrayBuffer(await item.arrayBuffer(), item.name);
        } else if (formats[extension(item.name)]) {
          location.hash = '#/studio/audio';
          setFile(item);
        }
      } catch (error) { status(error.message || 'The file could not be opened.'); }
    });
  });
})();
