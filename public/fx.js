// 연출: 날아가는 카드·칩, 승리 불꽃, 효과음(WebAudio로 합성)
(function () {
  'use strict';
  const FX = {};
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let layer = null;
  const L = () => layer || (layer = document.body);

  // ───────── 효과음 ─────────
  let ctx = null;
  let muted = false; try { muted = localStorage.getItem('sutda-mute') === '1'; } catch (e) {}
  function ac() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  // 브라우저는 사용자 조작 뒤에만 소리를 허락한다
  document.addEventListener('pointerdown', () => ac(), { passive: true });
  document.addEventListener('keydown', () => ac());
  function tone(freq, dur, type, vol, when, slide) {
    const c = ctx; if (!c || muted || c.state !== 'running') return;
    const t = c.currentTime + (when || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || .12, t + .01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + .02);
  }
  function noise(dur, vol, freq, when) {
    const c = ctx; if (!c || muted || c.state !== 'running') return;
    const t = c.currentTime + (when || 0);
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq || 2500; f.Q.value = .8;
    g.gain.value = vol || .2;
    s.connect(f).connect(g).connect(c.destination); s.start(t);
  }
  FX.sound = {
    deal: when => noise(.07, .22, 3200, when),
    chip: when => { tone(2300, .07, 'triangle', .07, when); tone(3150, .06, 'triangle', .05, (when || 0) + .035); },
    turn: () => { tone(880, .16, 'sine', .11); tone(1318, .3, 'sine', .08, .12); },
    die: () => tone(220, .2, 'sine', .12, 0, -120),
    stamp: () => { noise(.12, .35, 500); tone(110, .18, 'sine', .2); },
    win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, .32, 'triangle', .11, i * .09)),
    lose: () => [392, 330, 262].forEach((f, i) => tone(f, .28, 'sine', .08, i * .12)),
  };
  FX.muted = () => muted;
  FX.setMuted = m => { muted = !!m; try { localStorage.setItem('sutda-mute', muted ? '1' : '0'); } catch (e) {} if (!muted) ac(); };

  // ───────── 음성 (브라우저 내장 TTS) ─────────
  const SS = window.speechSynthesis;
  let voiceOn = true; try { voiceOn = localStorage.getItem('sutda-voice') !== '0'; } catch (e) {}
  let koVoice = null, spoke = false;
  function pickVoice() {
    if (!SS) return;
    const vs = SS.getVoices() || [];
    const ko = vs.filter(v => /^ko/i.test(v.lang));
    koVoice = ko.find(v => /google|yuna|heami|sunhi|natural|online/i.test(v.name)) || ko[0] || null;
  }
  if (SS) { pickVoice(); try { SS.addEventListener('voiceschanged', pickVoice); } catch (e) { SS.onvoiceschanged = pickVoice; } }
  // iOS 사파리는 사용자 터치 안에서 한 번 말해야 그 뒤로 소리가 난다
  const unlock = () => {
    if (!SS || spoke) return; spoke = true;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; u.lang = 'ko-KR'; SS.speak(u); } catch (e) {}
  };
  document.addEventListener('pointerdown', unlock, { passive: true });
  FX.voiceSupported = () => !!SS;
  FX.voiceOn = () => voiceOn && !!SS;
  FX.setVoice = on => { voiceOn = !!on; try { localStorage.setItem('sutda-voice', voiceOn ? '1' : '0'); } catch (e) {} if (!voiceOn && SS) SS.cancel(); };
  // pitch 0.6~1.5: 사람마다 목소리 높낮이를 다르게
  FX.say = (text, pitch, rate) => {
    if (!SS || !voiceOn || muted || document.hidden) return;
    try {
      if (SS.speaking || SS.pending) SS.cancel(); // 밀리면 최신 것만
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR'; if (koVoice) u.voice = koVoice;
      u.pitch = pitch || 1; u.rate = rate || 1.15; u.volume = 1;
      SS.speak(u);
    } catch (e) {}
  };

  // ───────── 날아가는 것들 ─────────
  const center = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, ok: r.width > 0 }; };

  // 덱 → 카드 자리. 끝나면 onDone (진짜 카드를 보이게)
  FX.flyCard = (fromEl, toEl, delay, onDone) => {
    const a = fromEl && center(fromEl), b = toEl && center(toEl);
    if (reduce || !a || !b || !a.ok || !b.ok) { setTimeout(onDone, delay || 0); return; }
    const el = document.createElement('div');
    el.className = 'fly-card';
    el.innerHTML = window.HwatuArt.back();
    Object.assign(el.style, { left: (b.x - b.w / 2) + 'px', top: (b.y - b.h / 2) + 'px', width: b.w + 'px', height: b.h + 'px', opacity: 0 });
    L().appendChild(el);
    const dx = a.x - b.x, dy = a.y - b.y, s = a.w / b.w || .6;
    const anim = el.animate([
      { transform: `translate(${dx}px,${dy}px) rotate(-25deg) scale(${s})`, opacity: 1 },
      { transform: `translate(${dx * .4}px,${dy * .4 - 30}px) rotate(-8deg) scale(${(s + 1) / 2})`, opacity: 1, offset: .6 },
      { transform: 'none', opacity: 1 },
    ], { duration: 420, delay: delay || 0, easing: 'cubic-bezier(.25,.8,.35,1)', fill: 'both' });
    setTimeout(() => FX.sound.deal(), delay || 0);
    anim.onfinish = () => { el.remove(); onDone && onDone(); };
  };

  const CHIP_COLORS = ['#f3ead5', '#2a4ea3', '#b3261e', '#1d1a19', '#c9962c'];
  FX.flyChips = (fromEl, toEl, n, delay) => {
    const a = fromEl && center(fromEl), b = toEl && center(toEl);
    if (reduce || !a || !b || !a.ok || !b.ok) return;
    n = Math.max(1, Math.min(6, n || 3));
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'fly-chip';
      el.style.background = CHIP_COLORS[(i + n) % CHIP_COLORS.length];
      el.style.left = (b.x - 11) + 'px'; el.style.top = (b.y - 11) + 'px'; el.style.opacity = 0;
      L().appendChild(el);
      const dx = a.x - b.x + (Math.random() - .5) * 12, dy = a.y - b.y + (Math.random() - .5) * 12;
      const d = (delay || 0) + i * 55;
      const anim = el.animate([
        { transform: `translate(${dx}px,${dy}px) scale(.9)`, opacity: 1 },
        { transform: `translate(${dx / 2}px,${dy / 2 - 40}px) scale(1.15)`, opacity: 1, offset: .5 },
        { transform: `translate(${(Math.random() - .5) * 10}px,${(Math.random() - .5) * 6}px) scale(.9)`, opacity: 1 },
      ], { duration: 480, delay: d, easing: 'ease-in-out', fill: 'both' });
      if (i === 0 || i === n - 1) setTimeout(() => FX.sound.chip(), d + 420);
      anim.onfinish = () => el.remove();
    }
  };

  FX.burst = (el, big) => {
    const c = el && center(el); if (reduce || !c || !c.ok) return;
    const glyphs = ['✦', '光', '✧', '❀', '✦'];
    const n = big ? 26 : 16;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('div');
      s.className = 'spark';
      s.textContent = glyphs[i % glyphs.length];
      s.style.left = c.x + 'px'; s.style.top = c.y + 'px';
      s.style.fontSize = (12 + Math.random() * (big ? 18 : 12)) + 'px';
      L().appendChild(s);
      const ang = Math.random() * Math.PI * 2, dist = 50 + Math.random() * (big ? 140 : 80);
      const anim = s.animate([
        { transform: 'translate(-50%,-50%) scale(.3)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist + 30}px)) scale(1) rotate(${Math.random() * 180}deg)`, opacity: 0 },
      ], { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(.1,.7,.3,1)', delay: Math.random() * 120 });
      anim.onfinish = () => s.remove();
    }
  };

  window.FX = FX;
})();
