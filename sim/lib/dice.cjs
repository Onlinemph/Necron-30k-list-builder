'use strict';
// Seeded dice. mulberry32: small, fast and well distributed. (The textbook LCG
// `(seed * 1103515245 + 12345) & 0x7fffffff` doesn't work in JavaScript: the product passes 2^53 and the stream
// falls into a loop of 10,466 numbers. See scripts/balance-sim.cjs.)
function createDice(seed = 1) {
  let s = seed | 0;
  const rnd = () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const d6 = () => 1 + Math.floor(rnd() * 6);
  const d3 = () => 1 + Math.floor(rnd() * 3);
  const twoD6 = () => d6() + d6();
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  return { rnd, d6, d3, twoD6, pick, get state() { return s; } };
}

module.exports = { createDice };
