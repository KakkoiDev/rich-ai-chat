// Seeded choices for varied synthetic benchmark inputs. A key (for example case, round and subject) always gives the
// same choices, so a failure can be reproduced exactly; different keys give different wording and data, so a case is
// not one memorised sentence. No dependencies.

/** FNV-1a of the key's text. */
function hash(text) {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.codePointAt(0), 16777619) >>> 0;
  return value;
}

/**
 * A deterministic generator for one key: seeded('export-app', round, subject).
 *   next()               a number in [0, 1)
 *   int(min, max)        an integer in [min, max]
 *   pick(list)           one item
 *   pickDistinct(list, n) n different items, in a varied order
 */
export function seeded(...key) {
  let state = hash(key.map(String).join('|'));
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0; // mulberry32
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min, max) => min + Math.floor(next() * (max - min + 1));
  const pick = list => {
    if (!list.length) throw new Error('pick needs a non-empty list');
    return list[Math.floor(next() * list.length)];
  };
  const pickDistinct = (list, count) => {
    if (count > list.length) throw new Error(`pickDistinct needs ${count} items, the list has ${list.length}`);
    const pool = [...list];
    return Array.from({ length: count }, () => pool.splice(Math.floor(next() * pool.length), 1)[0]);
  };
  return { next, int, pick, pickDistinct };
}
