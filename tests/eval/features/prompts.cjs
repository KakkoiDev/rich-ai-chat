/* eslint-disable @typescript-eslint/no-require-imports -- standalone benchmark module. */
// Seeded synthetic prompts for the features suite. Each (round, model, case) gets its own wording and data, so a case
// is not one memorised sentence, and the same key always gives the same prompt, so a failure can be reproduced.
// Every prompt stays outside the app's tested layouts (preflight checks this), so the model's own code is under test.

// Seeded choices come from test-core (bench/seeded.mjs): the same key always gives the same prompt.
const { seeded } = require('../../../test-core/bench/seeded.mjs');

const topics = [
  ['the class vote on a lunch fruit', ['Apple', 'Banana', 'Mango', 'Pear', 'Grape', 'Kiwi']],
  ['birds seen in the school garden', ['Sparrow', 'Crow', 'Pigeon', 'Robin', 'Heron', 'Swallow']],
  ['our favourite planet poll', ['Mars', 'Venus', 'Jupiter', 'Saturn', 'Neptune', 'Mercury']],
  ['colours chosen for the class flag', ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange']],
  ['instruments picked for the band', ['Drums', 'Guitar', 'Piano', 'Violin', 'Flute', 'Trumpet']],
];
const verbs = ['Build', 'Make', 'Create'];

/** A tally app outside the tested layouts: three labelled +1 buttons, Reset all, the total in one output. */
function tallyApp(choose) {
  const [topic, words] = choose.pick(topics);
  const items = choose.pickDistinct(words, 3);
  const kind = choose.pick(['tally counter app', 'vote counter app', 'counter app']);
  const prompt = `${choose.pick(verbs)} a ${kind} for ${topic}. Add buttons labeled ${items.map(i => `"${i}"`).join(', ')}; ` +
    'each adds one to that item. Add a button labeled "Reset all" that sets every count back to zero. ' +
    'Show the total of all counts in a single output element.';
  return { prompt, items, reset: 'Reset all' };
}

/** A points counter, then a revision that adds a subtract button. */
function pointsApp(choose) {
  const team = choose.pick(['the Red team', 'the Owls', 'Group B', 'the robotics club', 'the quiz team']);
  const add = choose.pick([2, 3, 5, 10]);
  const take = choose.pick([1, 2, 4].filter(n => n < add));
  const minus = choose.pick(['Penalty', 'Lose points', `Minus ${take}`, 'Remove points']);
  const prompt = `${choose.pick(verbs)} a points counter app for ${team}. Add a button labeled "+${add}" that adds ${add} points ` +
    'and a button labeled "Reset" that sets the points to zero. Show the points in a single output element.';
  const revision = `Add a button labeled "${minus}" that subtracts ${take} point${take === 1 ? '' : 's'}. Keep the existing buttons working.`;
  return { prompt, add, take, plus: `+${add}`, minus, revision };
}

/** An explicit web search, so exactly one search should run and be shown once. */
function searchQuestion(choose) {
  const place = choose.pick(['Tokyo Skytree', 'the Sydney Opera House', 'the Golden Gate Bridge', 'the Eiffel Tower',
    'the Louvre Pyramid', 'the Akashi Kaikyo Bridge', 'the Burj Khalifa', 'the Shard in London']);
  const fact = choose.pick(['first opened to the public', 'was completed', 'opened']);
  const opener = choose.pick(['Search the web for', 'Look up', 'Search online for']);
  return { prompt: `${opener} the year ${place} ${fact}, and cite your source.` };
}

/** A simple explanation that needs no tool, so Activity must show none. */
function explainTopic(choose) {
  const topic = choose.pick(['why the sky looks blue', 'how a rainbow forms', 'why ice floats on water', 'how plants make food from sunlight',
    'why we have seasons', 'how a magnet picks up a paper clip', 'why the moon has phases', 'how sound travels through air']);
  const reader = choose.pick(['a ten-year-old', 'a younger student', 'a classmate']);
  const length = choose.pick(['two short sentences', 'three sentences', 'one short paragraph']);
  return { prompt: `Explain ${topic} to ${reader} in ${length}.` };
}

const builders = { 'export-novel-app': tallyApp, 'export-after-revision': pointsApp,
  'activity-single-search': searchQuestion, 'activity-matches-tools': explainTopic };

function featurePrompt(caseId, round, model) {
  const build = builders[caseId];
  if (!build) throw new Error('Unknown case: ' + caseId);
  return build(seeded(caseId, round, model));
}

module.exports = { featurePrompt, caseIds: Object.keys(builders) };
