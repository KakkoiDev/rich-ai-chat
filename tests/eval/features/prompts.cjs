// Seeded synthetic prompts for the features suite. Each (round, model, case) gets its own wording and data, so a case
// is not one memorised sentence, and the same key always gives the same prompt, so a failure can be reproduced.
// Every prompt stays outside the app's tested layouts (preflight checks this), so the model's own code is under test.

function seed(text) {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.codePointAt(0), 16777619) >>> 0;
  return hash;
}

function random(key) {
  let state = seed(key);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (next, list) => list[Math.floor(next() * list.length)];
function pickDistinct(next, list, count) {
  const pool = [...list];
  return Array.from({ length: count }, () => pool.splice(Math.floor(next() * pool.length), 1)[0]);
}

const topics = [
  ['the class vote on a lunch fruit', ['Apple', 'Banana', 'Mango', 'Pear', 'Grape', 'Kiwi']],
  ['birds seen in the school garden', ['Sparrow', 'Crow', 'Pigeon', 'Robin', 'Heron', 'Swallow']],
  ['our favourite planet poll', ['Mars', 'Venus', 'Jupiter', 'Saturn', 'Neptune', 'Mercury']],
  ['colours chosen for the class flag', ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange']],
  ['instruments picked for the band', ['Drums', 'Guitar', 'Piano', 'Violin', 'Flute', 'Trumpet']],
];
const verbs = ['Build', 'Make', 'Create'];

/** A tally app outside the tested layouts: three labelled +1 buttons, Reset all, the total in one output. */
function tallyApp(next) {
  const [topic, words] = pick(next, topics);
  const items = pickDistinct(next, words, 3);
  const kind = pick(next, ['tally counter app', 'vote counter app', 'counter app']);
  const prompt = `${pick(next, verbs)} a ${kind} for ${topic}. Add buttons labeled ${items.map(i => `"${i}"`).join(', ')}; ` +
    'each adds one to that item. Add a button labeled "Reset all" that sets every count back to zero. ' +
    'Show the total of all counts in a single output element.';
  return { prompt, items, reset: 'Reset all' };
}

/** A points counter, then a revision that adds a subtract button. */
function pointsApp(next) {
  const team = pick(next, ['the Red team', 'the Owls', 'Group B', 'the robotics club', 'the quiz team']);
  const add = pick(next, [2, 3, 5, 10]);
  const take = pick(next, [1, 2, 4].filter(n => n < add));
  const minus = pick(next, ['Penalty', 'Lose points', `Minus ${take}`, 'Remove points']);
  const prompt = `${pick(next, verbs)} a points counter app for ${team}. Add a button labeled "+${add}" that adds ${add} points ` +
    'and a button labeled "Reset" that sets the points to zero. Show the points in a single output element.';
  const revision = `Add a button labeled "${minus}" that subtracts ${take} point${take === 1 ? '' : 's'}. Keep the existing buttons working.`;
  return { prompt, add, take, plus: `+${add}`, minus, revision };
}

const builders = { 'export-novel-app': tallyApp, 'export-after-revision': pointsApp };

function featurePrompt(caseId, round, model) {
  const build = builders[caseId];
  if (!build) throw new Error('Unknown case: ' + caseId);
  return build(random(`${caseId}|${round}|${model}`));
}

module.exports = { featurePrompt, caseIds: Object.keys(builders) };
