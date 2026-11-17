'use strict';
const crypto = require('crypto');
const Sutda = require('./public/core.js');

// 패 돌리기 전 덱 준비 (관리자 딜 옵션, 단계별 섞기 횟수)
const PASSES = [1, 2, 3, 6];
function handScore(cs) {
  if (cs.length < 2) return Sutda.strength(cs);
  return Sutda.strength(cs) + (Sutda.evalHand(cs).rank || 0) / 1e5;
}
function prepareDeck(B, S) {
  const h = S.hand;
  if (!h || !B) return;
  const live = h.seats.filter(id => !h.folded[id]);
  const targets = live.filter(id => B[id] > 0);
  if (!targets.length) return;
  const tries = Math.max(...targets.map(id => PASSES[B[id]] || 1));
  if (tries <= 1) return;
  const proj = deck => {
    let sc = 0;
    for (const id of targets) {
      const have = (h.cards[id] || []).slice(), i = live.indexOf(id), n = live.length;
      for (let r = 0; have.length < 2; r++) { const k = deck.length - 1 - (r * n + i); if (k < 0) break; have.push(deck[k]); }
      sc += handScore(have);
    }
    return sc;
  };
  let best = h.deck.slice(), bestSc = proj(best);
  for (let t = 1; t < tries; t++) {
    const d = h.deck.slice();
    for (let i = d.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [d[i], d[j]] = [d[j], d[i]]; }
    const sc = proj(d);
    if (sc > bestSc) { best = d; bestSc = sc; }
  }
  h.deck = best;
}

module.exports = { prepareDeck, PASSES };
