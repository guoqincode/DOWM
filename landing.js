'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const {films, hatTrace} = window.DOWMStory;
  const inspection = $('trace-seek');
  function showChunk() {
    const chunk = Number(inspection.value);
    const row = hatTrace[chunk - 1];
    $('trace-frame').src = 'media/hat-chunk-' + String(chunk).padStart(2, '0') + '.webp';
    $('trace-frame').alt = 'Last frame of chunk ' + chunk + ' of the hat sequence';
    $('trace-chunk').textContent = 'Chunk ' + chunk;
    $('trace-action').textContent = chunk <= 6 ? 'Take the hat off' : 'Put the hat back on';
    $('trace-value').textContent = chunk + ' of ' + hatTrace.length;
    inspection.setAttribute('aria-valuetext', 'Chunk ' + chunk);
    let note = 'The active prompt continues.';
    if (chunk === 5) note = 'First NO. The hat-off prompt continues.';
    if (chunk === 6) note = 'Second NO. The controller switches the next prompt.';
    if (chunk === 7) note = 'First chunk scored for putting the hat back on.';
    if (chunk === 12) note = 'The recorded video ends here.';
    $('trace-state').textContent = row.answer + ' · P(YES) ' + row.yes.toFixed(4) + ' · ' + note;
  }
  inspection.addEventListener('input', showChunk);
  showChunk();

  const glassButtons = Array.from(document.querySelectorAll('[data-glass]'));
  function showGlass(index) {
    const observation = window.DOWMStory.methodSteps[index];
    $('pour-frame').src = observation.frame;
    for (const button of glassButtons) button.setAttribute('aria-pressed', String(Number(button.dataset.glass) === index));
    $('glass-scores').replaceChildren(...observation.questions.map(question => {
      const group = document.createElement('div');
      const name = document.createElement('dt');
      const value = document.createElement('dd');
      name.textContent = question.text;
      value.textContent = 'P(YES) ' + question.yes.toFixed(4);
      group.append(name, value);
      return group;
    }));
  }
  for (const button of glassButtons) button.onclick = () => showGlass(Number(button.dataset.glass));
  showGlass(2);

  const gallery = document.querySelector('.case-gallery');
  const methods = $('screen-methods');
  const playButton = $('screen-play');
  const seek = $('screen-seek');
  const solo = $('solo');
  const peer = $('peer');
  const videos = [solo, peer];
  const systemMethods = [
    ['open_loop', 'Open-loop'], ['clip_vlm_local', 'Clip-level Qwen'],
    ['chunk_vlm_local', 'Chunk-level Qwen'], ['dowm_pre', 'DOWM-Base']
  ];
  let caseKey;
  let arm;
  let tracks = [];
  let playing = false;
  let animation = 0;
  let version = 0;
  let targetTime = null;
  let autoPlay = false;
  let loadPromise;
  let lastRecord;
  const active = () => arm ? videos : [solo];
  const duration = () => Math.max(0, ...active().map(v => Number.isFinite(v.duration) ? v.duration : 0));
  const hasRecord = () => !$('film-trace').hidden;
  const setStatus = message => { $('player-status').textContent = message; };

  function pause() {
    playing = false;
    autoPlay = false;
    cancelAnimationFrame(animation);
    videos.forEach(v => v.pause());
    playButton.textContent = duration() && Number(seek.value) >= duration() - .05 ? '↻ Replay' : '▶ Play';
  }
  function setClock(time) {
    for (const movie of active()) {
      if (movie.readyState >= 1) movie.currentTime = Math.min(time, Math.max(0, movie.duration - .01));
    }
    paintTime(time);
  }
  function holdClock(time) {
    pause();
    setClock(time);
  }
  function showTracks() {
    tracks = [];
    const timeline = films[caseKey].timeline;
    const keys = arm ? ['dowm_full', arm] : ['dowm_full'];
    const end = timeline ? Math.max(...keys.map(key => timeline.tracks[key].at(-1)[0])) : 0;
    videos.forEach((movie, i) => {
      const figure = movie.closest('figure');
      const bar = figure.querySelector('.take-track');
      const caption = figure.querySelector('.take-caption');
      const cue = figure.querySelector('.switch-cue');
      bar.replaceChildren();
      caption.replaceChildren();
      cue.replaceChildren();
      bar.hidden = caption.hidden = !timeline || !keys[i];
      if (bar.hidden) return;
      const rows = timeline.tracks[keys[i]];
      const change = rows.findIndex((r, n) => n > 0 && r[1] !== rows[n - 1][1]);
      if (change > 0) {
        const at = rows[change - 1][0] / 24;
        const jump = document.createElement('button');
        jump.type = 'button';
        jump.textContent = 'Prompt switch at ' + at.toFixed(2) + ' s';
        jump.onclick = () => { if (!playButton.disabled) holdClock(at); };
        cue.append(jump);
      } else {
        cue.textContent = 'One prompt throughout';
      }
      let start = 0;
      for (const [finish, action] of rows) {
        const segment = document.createElement('i');
        segment.dataset.action = action;
        segment.style.left = (100 * start / end) + '%';
        segment.style.width = (100 * (finish - start) / end) + '%';
        bar.append(segment);
        start = finish;
      }
      const head = document.createElement('b');
      bar.setAttribute('aria-hidden', 'true');
      bar.append(head);
      const label = document.createElement('strong');
      const quote = document.createElement('span');
      caption.append(label, quote);
      tracks.push({rows, end, head, label, quote, actions: timeline.actions});
    });
  }
  function paintTime(time) {
    const total = duration();
    seek.max = total || 1;
    seek.value = time;
    $('screen-clock').textContent = time.toFixed(1) + ' / ' + total.toFixed(1) + ' s';
    if (!playing) playButton.textContent = total && time >= total - .05 ? '↻ Replay' : '▶ Play';
    const frame = time * 24;
    for (const track of tracks) {
      const last = track.rows.at(-1);
      const row = track.rows.find(([endFrame]) => endFrame > frame + 1e-6) || last;
      track.head.style.left = (Math.min(frame, last[0]) / track.end * 100) + '%';
      const action = row[1];
      const state = frame >= last[0] - 1e-6 ? 'final' : action;
      if (track.state === state) continue;
      track.state = state;
      track.label.textContent = state === 'final' ? 'Final prompt' : action === 'user_goal' ? 'New goal' : action === 'action_2' ? 'Next action' : 'First action';
      track.quote.textContent = track.actions[action];
    }
    paintRecord(time);
  }

  function playPair() {
    if (playButton.disabled) return;
    document.dispatchEvent(new Event('dowm:other-play'));
    $('branch-film').pause();
    const movies = active();
    const leader = movies.reduce((a, b) => a.duration >= b.duration ? a : b);
    const current = version;
    let time = Number(seek.value);
    if (time >= duration() - .05 || leader.ended) { time = 0; setClock(0); }
    playing = true;
    for (const movie of movies) movie.preload = 'auto';
    const stillActive = () => playing && current === version;
    function start() {
      if (!stillActive()) return;
      const moving = movies.filter(v => time < v.duration - .015);
      if (moving.some(v => v.seeking || v.readyState < 3)) {
        playButton.textContent = 'Ⅱ Loading';
        animation = requestAnimationFrame(start);
        return;
      }
      playButton.textContent = 'Ⅱ Pause';
      Promise.all(moving.map(v => v.play())).then(() => {
        function tick() {
          if (!stillActive()) return;
          if (moving.some(v => !v.ended && v.currentTime < v.duration - .04 && (v.seeking || v.readyState < 3))) {
            time = Math.min(...moving.filter(v => !v.ended).map(v => v.currentTime));
            moving.forEach(v => v.pause());
            for (const v of moving) if (!v.ended && Math.abs(v.currentTime - time) > .08) v.currentTime = time;
            paintTime(time);
            animation = requestAnimationFrame(start);
            return;
          }
          const now = leader.ended ? duration() : leader.currentTime;
          paintTime(now);
          for (const v of movies) if (v !== leader && now < v.duration - .04 && Math.abs(v.currentTime - now) > .10) v.currentTime = now;
          if (leader.ended) { pause(); paintTime(duration()); return; }
          animation = requestAnimationFrame(tick);
        }
        tick();
      }).catch(() => {
        if (stillActive()) { pause(); setStatus('Press play to start the comparison.'); }
      });
    }
    start();
  }
  function ready() {
    if (!caseKey || active().some(v => v.readyState < 1)) return;
    if (targetTime !== null) {
      const time = Math.min(targetTime, duration());
      targetTime = null;
      if (time > 0) setClock(time); else paintTime(0);
    }
    if (active().some(v => v.seeking)) return;
    playButton.disabled = false;
    if (autoPlay) { autoPlay = false; playPair(); }
  }
  for (const movie of videos) {
    for (const type of ['loadedmetadata','loadeddata','canplay','seeked']) movie.addEventListener(type, ready);
    movie.addEventListener('click', () => playButton.click());
    movie.addEventListener('error', () => {
      if (active().includes(movie) && movie.getAttribute('src')) {
        pause();
        setStatus('The video could not be loaded. Select the film again to retry.');
      }
    });
  }
  function loadRecords() {
    if (window.DOWMRecords) return Promise.resolve();
    if (!loadPromise) loadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'examples.js';
      script.onload = resolve;
      script.onerror = () => { script.remove(); loadPromise = null; reject(new Error('Unable to load records')); };
      document.head.append(script);
    });
    return loadPromise;
  }
  function recordColumn(title, paragraphs) {
    const col = document.createElement('article');
    const heading = document.createElement('h4');
    heading.textContent = title;
    col.append(heading);
    for (const [label, value] of paragraphs) {
      const p = document.createElement('p');
      const b = document.createElement('strong');
      b.textContent = label;
      p.append(b, document.createTextNode(value));
      col.append(p);
    }
    return col;
  }
  function paintRecord(time) {
    if (!hasRecord() || !window.DOWMRecords) return;
    const records = window.DOWMRecords[caseKey];
    const destination = $('trace-readouts');
    if (films[caseKey].labels) {
      if (lastRecord === caseKey) return;
      lastRecord = caseKey;
      destination.replaceChildren(recordColumn('Shared prompt', records.map(r => [r.t.toFixed(1) + ' s', r.prompt])));
      return;
    }
    const arms = arm ? ['dowm_full', arm] : ['dowm_full'];
    const frame = Math.floor(time * 24 + 1e-6);
    const snapshots = arms.map(key => {
      const rows = records[key];
      return {key, current: rows.find(r => r.endFrame > frame) || rows.at(-1), completed: rows.filter(r => r.endFrame <= frame).at(-1)};
    });
    const signature = caseKey + snapshots.map(s => s.key + s.current.endFrame + '/' + s.completed?.endFrame).join('.');
    if (lastRecord === signature) return;
    lastRecord = signature;
    destination.replaceChildren(...snapshots.map(({key,current,completed}) => {
      const name = key === 'dowm_full' ? 'DOWM' : systemMethods.find(([k]) => k === key)[1];
      const fields = [['Current generator prompt', current.prompt]];
      if (completed?.answer) {
        fields.push(['Last scored action', completed.action], ['Bound question', completed.question],
          ['Scorer response', completed.answer + (completed.yes === null ? '' : ' · P(YES) ' + completed.yes.toFixed(4))]);
      } else fields.push(['Scorer response', 'No recorded judgment at this playback position.']);
      return recordColumn(name, fields);
    }));
  }
  function toggleRecord(open) {
    $('film-trace').hidden = !open;
    $('film-record').setAttribute('aria-expanded', String(open));
    $('trace-readouts').replaceChildren();
    lastRecord = null;
    if (!open) return;
    pause();
    $('trace-status').textContent = 'Loading…';
    loadRecords().then(() => {
      if (!hasRecord()) return;
      $('trace-status').textContent = '';
      paintRecord(Number(seek.value));
    }).catch(() => { $('trace-status').textContent = 'Close and reopen to retry loading the record.'; });
  }
  function selectFilm(key, selected, {time = 0, play = false} = {}) {
    version++;
    pause();
    toggleRecord(false);
    setStatus('');
    caseKey = key;
    arm = selected;
    const film = films[key];
    const generator = Boolean(film.labels);
    const options = generator ? [['reference', film.labels[1]]] : systemMethods;
    const primary = generator ? 'generator' : 'dowm_full';
    if (arm !== '' && !options.some(([name]) => name === arm)) arm = generator ? 'reference' : film.default;
    $('case-kind').textContent = generator ? 'Generator comparison' : 'System comparison';
    $('case-index').textContent = 'Film ' + Number(key.slice(-2)) + ' of ' + Object.keys(films).length;
    $('film-title').textContent = film.title;
    $('solo-name').textContent = generator ? film.labels[0] : 'DOWM';
    $('peer-name').textContent = options.find(([name]) => name === arm)?.[1] || '';
    $('compare-label').textContent = generator ? 'Generator' : 'Compare with DOWM';
    $('film-note').textContent = film.pairNotes?.[arm] || film.watch || film.note || '';
    $('pair-protocol').hidden = generator;
    $('film-record').textContent = generator ? 'Inspect shared prompts' : 'Inspect prompts and scores';
    for (const b of gallery.querySelectorAll('[data-feature]')) b.setAttribute('aria-pressed', String(b.dataset.feature === key));
    methods.replaceChildren();
    for (const [value, label] of [['', 'Single film'], ...options]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.dataset.method = value;
      b.setAttribute('aria-pressed', String(arm === value));
      b.onclick = () => {
        if (value !== arm) {
          selectFilm(key, value, {time: Number(seek.value), play: playing});
          Array.from(methods.children).find(option => option.dataset.method === value).focus({preventScroll:true});
        }
      };
      methods.append(b);
    }
    $('compare-screen').hidden = !arm;
    showTracks();
    playButton.disabled = true;
    targetTime = time;
    autoPlay = play;
    paintTime(time);
    solo.poster = film.posters[primary];
    solo.src = film.clips[primary];
    if (arm) { peer.poster = film.posters[arm]; peer.src = film.clips[arm]; }
    else { peer.removeAttribute('src'); peer.load(); }
  }
  gallery.addEventListener('click', e => {
    const button = e.target.closest('[data-feature]');
    if (!button) return;
    selectFilm(button.dataset.feature, undefined, {play: false});
    if (matchMedia('(max-width: 800px)').matches) $('featured-screening').scrollIntoView({block: 'start'});
  });
  playButton.onclick = () => { if (playing) pause(); else playPair(); };
  seek.oninput = () => holdClock(Number(seek.value));
  $('film-record').onclick = () => toggleRecord(!hasRecord());
  document.addEventListener('dowm:guide-play', pause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  new IntersectionObserver(entries => { if (!entries[0].isIntersecting) pause(); }).observe($('featured-screening'));
  const requested = location.hash.startsWith('#film-case-') ? location.hash.slice(6) : null;
  selectFilm(Object.hasOwn(films, requested) ? requested : 'case-01');
  if (Object.hasOwn(films, requested)) $('featured-screening').scrollIntoView();
})();
