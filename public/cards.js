// 화투 카드 그림 (SVG). 카드 번호 c: 월 = (c>>1)+1, 짝수 = 광/열끗, 홀수 = 띠/피
(function (root) {
  'use strict';
  const C = {
    red: '#c8261d', dred: '#8e1a14', black: '#1d1a19', green: '#2f7d3a', dgreen: '#1c5229', lgreen: '#5fa548',
    yel: '#e8b923', cream: '#fffdf6', paper: '#fbf6e8', pink: '#f2a3b6', lpink: '#fbd3dd', white: '#fffdf6',
    blue: '#2a4ea3', purple: '#6a3ea1', brown: '#7a4a24', lbrown: '#a8723f', grey: '#8b8478', gold: '#d9a52b',
  };
  const f = n => Math.round(n * 10) / 10;

  // ── 도형 도우미 ──
  function blossom(cx, cy, r, petal, center, n = 5, rot = 0) {
    let s = '';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rot;
      s += `<circle cx="${f(cx + Math.cos(a) * r * 0.62)}" cy="${f(cy + Math.sin(a) * r * 0.62)}" r="${f(r * 0.5)}" fill="${petal}"/>`;
    }
    return s + `<circle cx="${cx}" cy="${cy}" r="${f(r * 0.3)}" fill="${center}"/>`;
  }
  function mum(cx, cy, r) { // 국화
    let s = '';
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      s += `<ellipse cx="${f(cx + Math.cos(a) * r * 0.6)}" cy="${f(cy + Math.sin(a) * r * 0.6)}" rx="${f(r * 0.42)}" ry="${f(r * 0.17)}" transform="rotate(${f(a * 180 / Math.PI)} ${f(cx + Math.cos(a) * r * 0.6)} ${f(cy + Math.sin(a) * r * 0.6)})" fill="${C.yel}" stroke="#b07d0e" stroke-width=".6"/>`;
    }
    return s + `<circle cx="${cx}" cy="${cy}" r="${f(r * 0.32)}" fill="#c9800c"/>`;
  }
  function maple(cx, cy, r, color, rot = 0) { // 단풍잎
    const pts = [];
    const spikes = [1, .45, .9, .4, .75, .35, .5, .35, .75, .4, .9, .45];
    for (let i = 0; i < 12; i++) {
      const a = -Math.PI / 2 + (i / 12) * Math.PI * 2 + rot;
      pts.push(`${f(cx + Math.cos(a) * r * spikes[i])},${f(cy + Math.sin(a) * r * spikes[i])}`);
    }
    return `<polygon points="${pts.join(' ')}" fill="${color}" stroke="${C.dred}" stroke-width=".8" stroke-linejoin="round"/>
      <line x1="${cx}" y1="${cy}" x2="${f(cx + Math.cos(Math.PI / 2 + rot) * r * .8)}" y2="${f(cy + Math.sin(Math.PI / 2 + rot) * r * .8)}" stroke="${C.dred}" stroke-width="1"/>`;
  }
  function needles(cx, cy, w, h) { // 소나무 잎 덩어리
    return `<ellipse cx="${cx}" cy="${cy}" rx="${w}" ry="${h}" fill="${C.dgreen}"/>
      <ellipse cx="${cx}" cy="${f(cy - h * .25)}" rx="${f(w * .78)}" ry="${f(h * .6)}" fill="${C.green}"/>
      <path d="M${f(cx - w * .7)} ${cy} L${f(cx + w * .7)} ${cy} M${f(cx - w * .5)} ${f(cy - h * .4)} L${f(cx + w * .5)} ${f(cy - h * .4)}" stroke="${C.lgreen}" stroke-width=".8" stroke-dasharray="1.5 1.5"/>`;
  }
  function blade(x, y, len, lean, color) { // 붓꽃 잎
    return `<path d="M${x} ${y} Q ${f(x + lean * .4)} ${f(y - len * .6)} ${f(x + lean)} ${f(y - len)} Q ${f(x + lean * .2)} ${f(y - len * .55)} ${f(x + 3)} ${y} Z" fill="${color}"/>`;
  }
  function iris(cx, cy, r) {
    return `<path d="M${cx} ${f(cy + r)} C ${f(cx - r * 1.3)} ${f(cy + r * .2)} ${f(cx - r * .9)} ${f(cy - r)} ${cx} ${f(cy - r * .2)} C ${f(cx + r * .9)} ${f(cy - r)} ${f(cx + r * 1.3)} ${f(cy + r * .2)} ${cx} ${f(cy + r)} Z" fill="${C.purple}"/>
      <path d="M${cx} ${f(cy - r * .2)} L${cx} ${f(cy + r * .7)}" stroke="${C.yel}" stroke-width="1.2"/>`;
  }
  function ribbon(kind) { // 띠: 홍단 / 청단 / 초단
    const col = kind === 'blue' ? C.blue : C.red;
    const text = kind === 'red' ? '홍단' : kind === 'blue' ? '청단' : '';
    return `<g transform="rotate(-8 50 90)">
      <rect x="38" y="44" width="24" height="86" rx="2" fill="${col}" stroke="${kind === 'blue' ? '#16306e' : C.dred}" stroke-width="1"/>
      <path d="M38 130 L44 138 L50 130 L56 138 L62 130" fill="${col}" stroke="${kind === 'blue' ? '#16306e' : C.dred}" stroke-width="1"/>
      ${text ? `<text x="50" y="80" font-size="11" font-family="'Song Myung','Nanum Myeongjo',serif" fill="${C.black}" text-anchor="middle" writing-mode="tb" letter-spacing="2">${text}</text>` : ''}
    </g>`;
  }

  // ── 동물·사물 ──
  const crane = `<g>
    <path d="M30 128 Q 22 118 34 104 Q 46 92 64 100 Q 72 104 68 116 Q 60 128 44 128 Z" fill="${C.white}" stroke="${C.black}" stroke-width="1.2"/>
    <path d="M30 120 Q 22 126 20 136 Q 30 132 36 126 Z" fill="${C.black}"/>
    <path d="M62 102 Q 70 84 66 70 Q 64 62 70 58" fill="none" stroke="${C.black}" stroke-width="4" stroke-linecap="round"/>
    <circle cx="71" cy="57" r="4.5" fill="${C.white}" stroke="${C.black}" stroke-width="1"/>
    <circle cx="71" cy="54" r="2.2" fill="${C.red}"/>
    <path d="M75 57 L86 60 L75 59 Z" fill="${C.gold}"/>
    <path d="M44 128 L42 146 M54 128 L56 146" stroke="${C.black}" stroke-width="1.6"/>
  </g>`;
  const smallBird = (x, y, body, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})">
    <ellipse cx="0" cy="0" rx="11" ry="7" fill="${body}" stroke="${C.black}" stroke-width=".8"/>
    <circle cx="9" cy="-5" r="5" fill="${body}" stroke="${C.black}" stroke-width=".8"/>
    <circle cx="10.5" cy="-6" r="1.1" fill="${C.black}"/>
    <path d="M14 -5 L19 -4 L14 -3 Z" fill="${C.gold}"/>
    <path d="M-10 -1 L-19 -6 L-17 2 Z" fill="${C.black}"/>
    <path d="M-4 -2 Q 2 -9 6 -1" fill="none" stroke="${C.black}" stroke-width=".8"/>
  </g>`;
  const flyingBird = `<g transform="translate(58 96)">
    <path d="M-22 -6 Q -6 -20 2 -2 Q 10 -22 26 -14 Q 12 -6 4 4 Q -8 6 -22 -6 Z" fill="${C.black}"/>
    <circle cx="6" cy="2" r="3.5" fill="${C.black}"/><path d="M9 2 L15 4 L9 5 Z" fill="${C.gold}"/>
    <path d="M-2 4 L-8 12 L-1 8 Z" fill="${C.black}"/>
  </g>`;
  const bridge = `<g>
    <path d="M6 132 L94 104 L94 116 L6 144 Z" fill="${C.lbrown}" stroke="${C.brown}" stroke-width="1"/>
    <path d="M18 128 L18 140 M34 123 L34 135 M50 118 L50 130 M66 113 L66 125 M82 108 L82 120" stroke="${C.brown}" stroke-width="1.4"/>
    <path d="M6 126 L94 98" stroke="${C.brown}" stroke-width="2"/>
  </g>`;
  const butterfly = (x, y, c1, c2, s = 1, r = 0) => `<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})">
    <ellipse cx="-7" cy="-5" rx="8" ry="6" fill="${c1}" stroke="${C.black}" stroke-width=".8"/>
    <ellipse cx="7" cy="-5" rx="8" ry="6" fill="${c1}" stroke="${C.black}" stroke-width=".8"/>
    <ellipse cx="-5" cy="5" rx="5" ry="4" fill="${c2}" stroke="${C.black}" stroke-width=".8"/>
    <ellipse cx="5" cy="5" rx="5" ry="4" fill="${c2}" stroke="${C.black}" stroke-width=".8"/>
    <rect x="-1" y="-8" width="2" height="16" rx="1" fill="${C.black}"/>
  </g>`;
  const boar = `<g transform="translate(50 118)">
    <path d="M-34 6 Q -36 -14 -12 -18 Q 14 -22 28 -8 L 38 -4 Q 40 2 34 4 Q 28 12 14 12 L -26 12 Z" fill="${C.brown}" stroke="${C.black}" stroke-width="1.2"/>
    <path d="M-12 -18 Q -4 -26 6 -20" fill="none" stroke="${C.black}" stroke-width="2"/>
    <circle cx="26" cy="-7" r="1.6" fill="${C.black}"/>
    <path d="M34 2 Q 38 -2 36 -8" fill="none" stroke="${C.white}" stroke-width="1.6"/>
    <path d="M-24 12 L-24 22 M-12 12 L-12 22 M12 12 L12 22 M22 12 L22 22" stroke="${C.black}" stroke-width="3" stroke-linecap="round"/>
    <path d="M-34 0 L-40 -4" stroke="${C.black}" stroke-width="1.5"/>
  </g>`;
  const deer = `<g transform="translate(48 112)">
    <path d="M-26 4 Q -28 -12 -6 -14 L 14 -14 Q 20 -24 22 -34 L 30 -34 Q 30 -20 24 -8 Q 22 6 10 8 L -20 8 Z" fill="${C.lbrown}" stroke="${C.black}" stroke-width="1.2"/>
    <path d="M24 -34 L22 -48 M22 -42 L16 -50 M28 -34 L34 -48 M32 -42 L38 -46" stroke="${C.brown}" stroke-width="2" stroke-linecap="round"/>
    <circle cx="27" cy="-29" r="1.4" fill="${C.black}"/>
    <path d="M-18 8 L-20 26 M-10 8 L-8 26 M4 8 L2 26 M12 6 L16 26" stroke="${C.black}" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="-14" cy="-6" r="1.6" fill="${C.cream}"/><circle cx="-4" cy="-8" r="1.6" fill="${C.cream}"/><circle cx="4" cy="-4" r="1.6" fill="${C.cream}"/>
  </g>`;
  const sakeCup = `<g transform="translate(50 116)">
    <ellipse cx="0" cy="-12" rx="26" ry="7" fill="${C.dred}"/>
    <path d="M-26 -12 Q -22 14 0 16 Q 22 14 26 -12 Z" fill="${C.red}" stroke="${C.dred}" stroke-width="1"/>
    <ellipse cx="0" cy="-12" rx="21" ry="4.6" fill="${C.gold}"/>
    <circle cx="0" cy="2" r="7" fill="none" stroke="${C.gold}" stroke-width="1.6"/>
    <path d="M-4 2 L4 2 M0 -2 L0 6" stroke="${C.gold}" stroke-width="1.4"/>
    <path d="M-10 16 L10 16 L8 22 L-8 22 Z" fill="${C.dred}"/>
  </g>`;
  const curtain = `<g>
    <path d="M4 96 Q 50 88 96 96 L96 140 Q 50 132 4 140 Z" fill="${C.red}"/>
    ${[12, 28, 44, 60, 76].map(x => `<path d="M${x} ${f(94 - (x > 50 ? (100 - x) : x) * .08)} L${x} ${f(138 - (x > 50 ? (100 - x) : x) * .08)}" stroke="${C.white}" stroke-width="6" opacity=".9"/>`).join('')}
    <path d="M4 96 Q 50 88 96 96" fill="none" stroke="${C.black}" stroke-width="2"/>
    <path d="M4 140 Q 50 132 96 140" fill="none" stroke="${C.gold}" stroke-width="2" stroke-dasharray="2 2"/>
  </g>`;

  // ── 월별 배경 ──
  function art(m, sp) {
    switch (m) {
      case 1: return `<rect width="100" height="160" fill="${C.cream}"/>
        ${sp ? `<circle cx="56" cy="44" r="21" fill="${C.red}"/>` : `<rect width="100" height="56" fill="${C.red}"/>`}
        <path d="M14 160 Q 20 110 10 70 Q 26 100 30 60" fill="none" stroke="${C.brown}" stroke-width="5" stroke-linecap="round"/>
        ${needles(14, 66, 16, 9)}${needles(32, 56, 14, 8)}${needles(20, 94, 18, 9)}${needles(36, 80, 12, 7)}
        ${sp ? crane : needles(70, 120, 22, 10) + needles(82, 98, 16, 8) + `<path d="M80 160 L78 110" stroke="${C.brown}" stroke-width="4"/>`}`;
      case 2: return `<rect width="100" height="160" fill="${C.cream}"/>
        <path d="M2 150 Q 30 120 34 90 Q 40 60 70 46 Q 84 40 96 20" fill="none" stroke="${C.brown}" stroke-width="5" stroke-linecap="round"/>
        <path d="M34 90 Q 54 86 70 96" fill="none" stroke="${C.brown}" stroke-width="3" stroke-linecap="round"/>
        ${blossom(70, 46, 12, C.red, C.yel)}${blossom(88, 28, 10, C.red, C.yel, 5, .5)}${blossom(30, 110, 11, C.red, C.yel, 5, .3)}
        ${blossom(52, 66, 9, C.red, C.yel)}${blossom(72, 98, 9, C.red, C.yel, 5, .2)}${blossom(14, 136, 10, C.red, C.yel)}
        ${sp ? smallBird(52, 82, '#7fa33a', 1.35) : ''}`;
      case 3: return `<rect width="100" height="160" fill="${C.cream}"/>
        <path d="M0 18 Q 50 40 100 14" fill="none" stroke="${C.brown}" stroke-width="4"/>
        ${[[12, 24], [30, 34], [50, 36], [70, 30], [88, 22], [22, 52], [44, 56], [66, 52], [84, 46], [34, 74], [58, 76]].map(([x, y], i) => blossom(x, y, 11, i % 2 ? '#e2405a' : '#ffffff', i % 2 ? C.yel : C.red, 5, i) + `<circle cx="${x}" cy="${y}" r="10" fill="none" stroke="${i % 2 ? C.dred : '#e2405a'}" stroke-width=".6" opacity=".6"/>`).join('')}
        ${sp ? curtain : ''}`;
      case 4: return `<rect width="100" height="160" fill="${C.cream}"/>
        ${sp ? `<circle cx="74" cy="122" r="18" fill="${C.red}"/>` : ''}
        ${[10, 26, 42, 58, 74, 90].map((x, i) => `<path d="M${x} 0 Q ${x - 4} 40 ${x + 2} ${70 + (i % 3) * 14}" fill="none" stroke="${C.black}" stroke-width="1.6"/>` +
          Array.from({ length: 6 }, (_, k) => `<ellipse cx="${f(x - 2 + (k % 2) * 4)}" cy="${12 + k * 11 + (i % 3) * 2}" rx="4" ry="2.2" fill="${C.black}" transform="rotate(${k % 2 ? 30 : -30} ${f(x - 2 + (k % 2) * 4)} ${12 + k * 11 + (i % 3) * 2})"/>`).join('')).join('')}
        ${sp ? flyingBird : ''}`;
      case 5: return `<rect width="100" height="160" fill="${C.cream}"/>
        ${blade(12, 160, 110, -6, C.green)}${blade(22, 160, 124, 8, C.dgreen)}${blade(70, 160, 118, -10, C.green)}${blade(82, 160, 100, 8, C.dgreen)}${blade(46, 160, 90, 4, C.green)}
        ${iris(26, 42, 11)}${iris(66, 36, 12)}${iris(84, 62, 9)}${iris(44, 64, 9)}
        ${sp ? bridge : ''}`;
      case 6: return `<rect width="100" height="160" fill="${C.cream}"/>
        <path d="M20 160 Q 34 120 30 92" fill="none" stroke="${C.dgreen}" stroke-width="3"/>
        ${[[14, 110, 30], [46, 108, -20], [24, 132, 60], [56, 134, -40]].map(([x, y, r]) => `<path d="M${x} ${y} q 8 -12 18 -6 q -6 12 -18 6 Z" transform="rotate(${r} ${x} ${y})" fill="${C.green}" stroke="${C.dgreen}" stroke-width=".8"/>`).join('')}
        <g transform="translate(34 72)">${[26, 20, 14, 8].map((r, i) => `<circle r="${r}" fill="${i % 2 ? C.red : '#e0473d'}" stroke="${C.dred}" stroke-width="1"/>`).join('')}<circle r="3" fill="${C.yel}"/></g>
        ${sp ? butterfly(74, 40, C.blue, C.yel, 1.1, 15) + butterfly(76, 92, C.yel, C.blue, .9, -10) : ''}`;
      case 7: return `<rect width="100" height="160" fill="${C.cream}"/>
        ${[[0, 0], [30, 14], [60, 4]].map(([dx, dy]) => `<path d="M${10 + dx} 160 Q ${30 + dx} ${80 + dy} ${70 + dx} ${20 + dy}" fill="none" stroke="${C.brown}" stroke-width="1.6"/>` +
          Array.from({ length: 9 }, (_, k) => { const t = k / 9, x = 10 + dx + (60 * t) + Math.sin(t * 3) * 10, y = 160 - 140 * t + dy * t; return `<circle cx="${f(x + 4)}" cy="${f(y)}" r="2.6" fill="${C.red}"/><circle cx="${f(x - 3)}" cy="${f(y + 3)}" r="2.2" fill="${C.red}"/><ellipse cx="${f(x)}" cy="${f(y + 6)}" rx="3" ry="1.4" fill="${C.green}"/>`; }).join('')).join('')}
        ${sp ? boar : ''}`;
      case 8: return `<rect width="100" height="160" fill="${C.red}"/>
        ${sp ? `<circle cx="50" cy="48" r="28" fill="${C.cream}"/><circle cx="50" cy="48" r="28" fill="none" stroke="${C.gold}" stroke-width="2"/>` : ''}
        <path d="M0 160 L0 96 Q 50 56 100 96 L100 160 Z" fill="${C.black}"/>
        ${Array.from({ length: 13 }, (_, k) => `<path d="M${4 + k * 8} 160 Q ${2 + k * 8} ${120 - (k % 3) * 6} ${8 + k * 8} ${96 + Math.abs(6 - k) * 2}" fill="none" stroke="${C.cream}" stroke-width="1" opacity=".7"/>`).join('')}`;
      case 9: return `<rect width="100" height="160" fill="${C.cream}"/>
        <path d="M30 160 Q 26 110 40 70 M40 70 Q 60 50 74 30" fill="none" stroke="${C.dgreen}" stroke-width="2.4"/>
        ${[[20, 100, 40], [52, 84, -30], [62, 60, 30], [24, 130, -20]].map(([x, y, r]) => `<path d="M${x} ${y} q 6 -10 16 -4 q -4 4 0 8 q -10 4 -16 -4 Z" transform="rotate(${r} ${x} ${y})" fill="${C.green}" stroke="${C.dgreen}" stroke-width=".8"/>`).join('')}
        ${mum(74, 30, 16)}${mum(36, 62, 14)}${sp ? '' : mum(68, 106, 15)}
        ${sp ? sakeCup : ''}`;
      case 10: return `<rect width="100" height="160" fill="${C.cream}"/>
        <path d="M0 10 Q 40 30 70 18 Q 86 12 100 20" fill="none" stroke="${C.brown}" stroke-width="3"/>
        ${[[14, 22, 13, 0], [40, 30, 12, .3], [66, 22, 13, -.2], [88, 30, 11, .2], [26, 48, 11, -.3], [54, 50, 12, .1], [80, 52, 10, .4]].map(([x, y, r, ro], i) => maple(x, y, r, i % 3 ? C.red : '#e05a1f', ro)).join('')}
        ${sp ? deer : [[20, 96, 12, .2], [54, 92, 13, -.1], [80, 110, 11, .3], [36, 128, 12, 0], [70, 140, 11, .5]].map(([x, y, r, ro], i) => maple(x, y, r, i % 2 ? C.red : '#e05a1f', ro)).join('')}`;
    }
    return '';
  }
  const RIBBON = { 1: 'red', 2: 'red', 3: 'red', 4: 'plain', 5: 'plain', 6: 'blue', 7: 'plain', 9: 'blue', 10: 'blue' };

  function face(c) {
    const m = (c >> 1) + 1, sp = c % 2 === 0;
    const gwang = sp && (m === 1 || m === 3 || m === 8);
    const rib = !sp && RIBBON[m] ? ribbon(RIBBON[m]) : '';
    const id = 'hw' + c;
    return `<svg viewBox="0 0 100 160" xmlns="http://www.w3.org/2000/svg" class="hwsvg" aria-hidden="true">
      <defs><clipPath id="${id}"><rect x="6" y="6" width="88" height="148" rx="3"/></clipPath></defs>
      <rect width="100" height="160" rx="8" fill="${C.red}"/>
      <rect x="1.5" y="1.5" width="97" height="157" rx="7" fill="none" stroke="${C.dred}" stroke-width="1.5"/>
      <g clip-path="url(#${id})">${art(m, sp)}${rib}</g>
      <rect x="6" y="6" width="88" height="148" rx="3" fill="none" stroke="rgba(0,0,0,.25)" stroke-width=".8"/>
      <g><rect x="7" y="7" width="15" height="15" rx="2" fill="${C.paper}" stroke="${C.black}" stroke-width="1" opacity=".92"/>
        <text x="14.5" y="18.6" font-size="${m === 10 ? 9 : 11.5}" font-weight="700" font-family="'Song Myung',serif" fill="${C.black}" text-anchor="middle">${m}</text></g>
      ${gwang ? `<g><circle cx="81" cy="19" r="10.5" fill="${C.red}" stroke="${C.paper}" stroke-width="2"/><text x="81" y="24" font-size="13" font-weight="700" font-family="'Song Myung',serif" fill="${C.paper}" text-anchor="middle">光</text></g>` : ''}
    </svg>`;
  }
  function back() {
    return `<svg viewBox="0 0 100 160" xmlns="http://www.w3.org/2000/svg" class="hwsvg" aria-hidden="true">
      <defs><pattern id="hwbk" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="12" height="12" fill="#b3221a"/><rect width="6" height="6" fill="#bd2a21"/></pattern></defs>
      <rect width="100" height="160" rx="9" fill="#5e110d"/>
      <rect x="4" y="4" width="92" height="152" rx="6" fill="url(#hwbk)"/>
      <rect x="10" y="10" width="80" height="140" rx="4" fill="none" stroke="#e8c37a" stroke-width="1.4" opacity=".75"/>
      <circle cx="50" cy="80" r="17" fill="#5e110d" stroke="#e8c37a" stroke-width="1.6"/>
      <text x="50" y="87" font-size="19" font-family="'Song Myung',serif" fill="#e8c37a" text-anchor="middle">花</text>
    </svg>`;
  }
  const NAMES = ['', '송학', '매조', '벚꽃', '흑싸리', '난초', '모란', '홍싸리', '공산', '국화', '단풍'];
  function label(c) {
    const m = (c >> 1) + 1, sp = c % 2 === 0;
    if (sp) return `${m}월 ${NAMES[m]} ${(m === 1 || m === 3 || m === 8) ? '광' : '열끗'}`;
    const r = RIBBON[m];
    return `${m}월 ${NAMES[m]} ${r === 'red' ? '홍단' : r === 'blue' ? '청단' : r === 'plain' ? '초단' : '피'}`;
  }
  const api = { face, back, label };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HwatuArt = api;
})(typeof window !== 'undefined' ? window : globalThis);
