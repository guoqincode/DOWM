'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const film = $('concept-film');
  const branch = $('branch-film');
  const sceneButtons = $('fork-scenes');
  const choices = $('fork-choices');
  const delivery = $('fork-delivery');
  const scenes = window.DOWMForks;
  let currentScene;
  let choice;
  let mode;
  let lastEvent = -1;

  function play(video) {
    video.play().catch(() => {
      if (video === film) paintControls();
    });
  }

  const guideStart = $('guide-start');
  const captions = JSON.parse($('guide-subtitles').textContent);
  for (const [code, content] of Object.entries(captions)) {
    const track = document.createElement('track');
    track.kind = 'captions';
    track.srclang = code;
    track.label = 'English';
    track.default = true;
    track.src = URL.createObjectURL(new Blob([content], {type:'text/vtt'}));
    film.append(track);
    track.track.mode = 'showing';
  }
  const captionButton = $('guide-captions');
  captionButton.hidden = false;
  function showCaptionState() {
    const enabled = film.textTracks[0].mode === 'showing';
    captionButton.setAttribute('aria-pressed', String(enabled));
    captionButton.setAttribute('aria-label', enabled ? 'Turn English captions off' : 'Turn English captions on');
    captionButton.title = enabled ? 'Turn English captions off' : 'Turn English captions on';
  }
  captionButton.onclick = () => {
    const track = film.textTracks[0];
    track.mode = track.mode === 'showing' ? 'hidden' : 'showing';
    showCaptionState();
  };
  film.textTracks.addEventListener('change', showCaptionState);
  showCaptionState();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const soundButton = $('guide-sound');
  let viewerControls = false;
  let inView = false;
  film.muted = false;
  function present() {
    if (viewerControls) return;
    if (!inView || document.hidden || reduced.matches) film.pause();
    else if (!film.ended) play(film);
  }
  const visibility = new IntersectionObserver(entries => {
    inView = entries[0].intersectionRatio >= .45;
    present();
  }, {threshold:[0,.45]});
  visibility.observe(film);
  reduced.addEventListener('change',present);
  document.addEventListener('visibilitychange',present);

  function takeControl() {
    viewerControls = true;
    visibility.disconnect();
    film.controls = true;
  }
  function beginFilm(at) {
    takeControl();
    if (at !== undefined) film.currentTime = at;
    stopOtherPlayers(film);
    play(film);
  }
  function paintControls() {
    const paused = film.paused || film.ended;
    guideStart.querySelector('span').textContent = paused ? '▶' : 'Ⅱ';
    guideStart.querySelector('b').textContent = film.ended ? ('Replay film') :
      !paused ? ('Pause film') :
      film.currentTime ? 'Resume film' : film.muted ? 'Play film' : 'Play film with sound';
    soundButton.textContent = film.muted ? ('Turn sound on') : ('Mute');
  }
  guideStart.hidden = soundButton.hidden = false;
  guideStart.onclick = () => {
    if (!film.paused && !film.ended) {takeControl(); film.pause();}
    else beginFilm(film.ended ? 0 : undefined);
  };
  soundButton.onclick = () => {
    takeControl();
    film.muted = !film.muted;
    if (!film.paused) stopOtherPlayers(film);
    paintControls();
  };
  film.controls = false;
  paintControls();
  for (const event of ['play','pause','ended','volumechange']) film.addEventListener(event,paintControls);
  const chapters = [...document.querySelectorAll('[data-concept]')];
  function updateChapter() {
    const active = chapters.findLast(button => film.currentTime >= Number(button.dataset.seconds));
    for (const button of chapters) button.setAttribute('aria-pressed', String(button === active));
  }
  film.addEventListener('timeupdate', updateChapter);
  for (const button of chapters) {
    button.onclick = () => {
      beginFilm(Number(button.dataset.seconds));
      updateChapter();
    };
  }

  function stopOtherPlayers(active) {
    if (active !== film) film.pause();
    if (active !== branch) branch.pause();
    document.dispatchEvent(new Event('dowm:guide-play'));
    document.dispatchEvent(new CustomEvent('dowm:other-play', {detail: active.id}));
  }
  film.addEventListener('play', () => {if(viewerControls) stopOtherPlayers(film);});
  branch.addEventListener('play', () => stopOtherPlayers(branch));
  document.addEventListener('dowm:online-play', () => {film.pause(); branch.pause();});
  document.addEventListener('dowm:other-play', event => {if (!event.detail) film.pause();});
  document.addEventListener('visibilitychange', () => {if (document.hidden) film.pause();});

  function setCommand() {
    if (!choice || mode !== 'choice') return;
    const events = choice.events;
    const index = events.findLastIndex(e => e.after === 2 ||
      branch.currentTime >= currentScene.hold + (e.after * 17 - currentScene.boundary) / currentScene.fps);
    if (index === lastEvent) return;
    lastEvent = index;
    delivery.replaceChildren();
    const label = document.createElement('span');
    label.textContent = index < 0 ? ('No new instruction') :
      ('Recorded instruction after chunk ') + events[index].after;
    const command = document.createElement('p');
    if (index >= 0) command.lang = 'en';
    command.textContent = index < 0 ? currentScene.plan : '“' + events[index].text + '”';
    delivery.append(label, command);
  }

  function showPoint() {
    mode = 'point';
    choice = null;
    branch.pause();
    branch.controls = false;
    branch.removeAttribute('src');
    branch.poster = currentScene.poster;
    branch.load();
    delivery.replaceChildren();
    for (const b of choices.children) b.setAttribute('aria-pressed', 'false');
    $('fork-status').textContent = ('Instruction point · Choose how the video continues.');
  }

  function follow(option, button) {
    mode = 'choice';
    choice = option;
    lastEvent = -2;
    for (const b of choices.children) b.setAttribute('aria-pressed', String(button === b));
    branch.pause();
    branch.controls = true;
    branch.poster = currentScene.poster;
    branch.src = option.video;
    $('fork-status').textContent = option.result;
    setCommand();
    play(branch);
  }

  function selectScene(scene) {
    currentScene = scene;
    for (const button of sceneButtons.children) button.setAttribute('aria-pressed', String(button.dataset.scene === scene.key));
    $('fork-plan').textContent = scene.plan;
    choices.replaceChildren();
    for (const option of scene.choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-controls', 'branch-film');
      const thumb = new Image();
      thumb.src = option.still;
      thumb.alt = '';
      const labels = document.createElement('span');
      const role = document.createElement('small');
      role.textContent = option.events.length ? ('Send instruction') : ('No new instruction');
      const title = document.createElement('strong');
      title.textContent = option.label;
      labels.append(role,title);
      button.append(thumb, labels);
      button.onclick = () => follow(option,button);
      choices.append(button);
    }
    showPoint();
  }
  for (const scene of scenes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.scene = scene.key;
    button.textContent = scene.name;
    button.onclick = () => selectScene(scene);
    sceneButtons.append(button);
  }
  $('fork-origin').onclick = () => {
    showPoint();
    mode = 'opening';
    branch.src = currentScene.opening;
    branch.controls = true;
    $('fork-status').textContent = ('The shared opening plays up to the instruction.');
    play(branch);
  };
  $('fork-reset').onclick = showPoint;
  branch.addEventListener('timeupdate', setCommand);
  branch.addEventListener('ended', () => {if (mode === 'opening') showPoint();});
  selectScene(scenes[0]);
})();
