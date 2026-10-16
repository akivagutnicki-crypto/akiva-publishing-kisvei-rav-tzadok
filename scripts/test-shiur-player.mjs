import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync('dist/library/shiur-player.js', 'utf8');
const storage = new Map();
const win = new EventTarget();
const doc = new EventTarget();
const audios = [];
doc.visibilityState = 'visible';
doc.querySelectorAll = () => audios;
const localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value)
};
vm.runInNewContext(script, {window: win, document: doc, localStorage, console});
const player = win.AkivaShiurPlayer;
const event = (target, type) => target.dispatchEvent(new Event(type));
const saved = key => JSON.parse(storage.get('rtl.audio.' + key));
const tick = () => new Promise(resolve => setImmediate(resolve));

function section(key, ready = 0) {
  const audio = new EventTarget();
  Object.assign(audio, {readyState: ready, duration: 2135.844, currentTime: 0, ended: false, paused: true, error: null, playbackRate: 1});
  audio.play = () => { audio.paused = false; event(audio, 'play'); return Promise.resolve(); };
  audio.pause = () => { if (!audio.paused) { audio.paused = true; event(audio, 'pause'); } };
  audio.load = () => { audio.readyState = 0; };
  audio.removeAttribute = () => {};
  audios.push(audio);
  const controls = Object.fromEntries(['.shiur-speed', '.shiur-boost', '.shiur-resume', '.shiur-restart', '.shiur-retry', '.shiur-audio-status'].map(selector => [selector, Object.assign(new EventTarget(), {value: '1', hidden: true, textContent: '', disabled: false})]));
  const card = {dataset: {shiurKey: key}, querySelector: selector => selector === 'audio' ? audio : controls[selector]};
  return {audio, controls, querySelector: selector => selector === '.shiur-audio' ? card : null};
}

assert.match(player.render('Peri Tzadik, Noach 2'), /audio\/rabbi-moshe-teitelbaum-noach-ois-2\.mp3/);
assert.match(player.render('Peri Tzadik, Noach 4'), /audio\/rabbi-moshe-teitelbaum-noach-ois-4\.mp3/);
assert.match(player.render('Peri Tzadik, Noach 6'), /noach-ois-vav-6/);
assert.match(player.render('Peri Tzadik, Noach 6'), /55:15/);
assert.match(player.render('Peri Tzadik, Noach 6'), /M4A/);
assert.ok(player.render('Peri Tzadik, Noach 6').includes('audio/pri-tzaddik-noach-ois-6.m4a'));
assert.match(player.render('Peri Tzadik, Noach 6'), /Download M4A/);
assert.equal(player.render('Peri Tzadik, Noach 8'), '', 'Ois Ches must not render an audio player.');
assert.match(player.render('Peri Tzadik, Noach 6'), /value="2.5">2.5×/);
assert.equal(player.render('Peri Tzadik, Noach 1'), '');
assert.equal(player.render('Peri Tzadik, Noach 9'), '');
assert.match(player.render('Peri Tzadik, Noach 2'), /value="2">2×/);
assert.match(player.render('Peri Tzadik, Noach 2'), /value="2.5">2.5×/);
assert.doesNotMatch(player.render('Peri Tzadik, Noach 2'), /iframe|drive\.google/);

storage.set('rtl.audio.teitelbaum-noach-2', JSON.stringify({position: 125.5}));
storage.set('rtl.audio.settings', JSON.stringify({speed: 2}));
let sec = section('teitelbaum-noach-2');
let dispose = player.mount(sec);
assert.equal(sec.audio.playbackRate, 2);
dispose();
assert.equal(saved('teitelbaum-noach-2').position, 125.5, 'Opening and leaving without loading preserves the listening position.');

sec = section('teitelbaum-noach-2');
dispose = player.mount(sec);
assert.equal(sec.controls['.shiur-resume'].hidden, false);
event(sec.controls['.shiur-resume'], 'click');
sec.audio.readyState = 1;
event(sec.audio, 'loadedmetadata');
assert.equal(sec.audio.currentTime, 125.5);
assert.equal(sec.audio.preservesPitch, true);
sec.controls['.shiur-speed'].value = '2.5';
event(sec.controls['.shiur-speed'], 'change');
assert.equal(sec.audio.playbackRate, 2.5);
assert.equal(saved('settings').speed, 2.5);
sec.audio.currentTime = 480;
event(sec.audio, 'seeked');
assert.equal(saved('teitelbaum-noach-2').position, 480);

const other = section('teitelbaum-noach-4');
const disposeOther = player.mount(other);
other.audio.readyState = 1;
event(other.audio, 'loadedmetadata');
assert.equal(other.audio.currentTime, 0, 'Each recording has its own listening position.');
assert.equal(other.audio.playbackRate, 2.5, 'Speed follows the listener to another recording.');
await other.audio.play();
assert.equal(sec.audio.paused, true, 'Only one shiur plays at a time.');
assert.equal(saved('teitelbaum-noach-2').position, 480);

sec.audio.currentTime = 487;
doc.visibilityState = 'hidden';
event(doc, 'visibilitychange');
assert.equal(saved('teitelbaum-noach-2').position, 487);
sec.audio.currentTime = 490;
event(win, 'pagehide');
assert.equal(saved('teitelbaum-noach-2').position, 490);
event(sec.controls['.shiur-restart'], 'click');
assert.equal(sec.audio.currentTime, 0);
assert.equal(saved('teitelbaum-noach-2').position, 0);
assert.equal(sec.controls['.shiur-resume'].hidden, true);

sec.audio.currentTime = sec.audio.duration;
sec.audio.ended = true;
event(sec.audio, 'ended');
assert.equal(saved('teitelbaum-noach-2').position, 0);
event(sec.audio, 'error');
assert.equal(sec.controls['.shiur-retry'].hidden, false);
event(sec.controls['.shiur-retry'], 'click');
assert.match(sec.controls['.shiur-audio-status'].textContent, /Loading/);

sec.controls['.shiur-boost'].value = '2';
event(sec.controls['.shiur-boost'], 'change');
await tick();
assert.equal(sec.controls['.shiur-boost'].disabled, true);
assert.equal(sec.controls['.shiur-boost'].value, '1');
dispose(); disposeOther();

let sourceCount = 0, boostGraph;
win.AudioContext = class {
  state = 'suspended'; currentTime = 0;
  constructor() { boostGraph = this; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  createGain() { return this.gain = {connect() {}, gain: {setTargetAtTime: value => { this.volume = value; }}}; }
  createDynamicsCompressor() { return {connect() {}, ...Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map(k => [k, {value: 0}]))}; }
  createMediaElementSource() { sourceCount++; return {connect() {}}; }
};
const boosted = section('teitelbaum-noach-2', 1);
const disposeBoosted = player.mount(boosted);
assert.equal(sourceCount, 0, 'Native audio is used until boost is requested.');
boosted.controls['.shiur-boost'].value = '3';
event(boosted.controls['.shiur-boost'], 'change');
await tick();
assert.equal(sourceCount, 1);
assert.equal(boostGraph.volume, 3);
boosted.controls['.shiur-boost'].value = '1';
event(boosted.controls['.shiur-boost'], 'change');
await tick();
assert.equal(sourceCount, 1, 'Changing boost reuses the existing audio graph.');
assert.equal(boostGraph.volume, 1);
disposeBoosted();
assert.equal(boostGraph.state, 'closed');

localStorage.setItem = () => { throw new Error('Storage blocked'); };
const restricted = section('teitelbaum-noach-4', 1);
const disposeRestricted = player.mount(restricted);
restricted.controls['.shiur-speed'].value = '2';
event(restricted.controls['.shiur-speed'], 'change');
assert.equal(restricted.audio.playbackRate, 2, 'Playback controls work even if storage is blocked.');
disposeRestricted();
console.log('Shiur player verified: mapping, 2×/2.5× speed, resume, seeking, restart, completion, navigation, boost, and unavailable-storage fallback.');
