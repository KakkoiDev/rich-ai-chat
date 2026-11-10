/**
 * Run one synthetic conversation. The adapter sends a fresh snapshot of the
 * actual history and returns { answer, activity?, evidence? }. Evidence is
 * passed to assertions but not saved. The caller owns transport and replay.
 */
export async function runConversation(steps, send, { signal } = {}) {
  if (!steps.length) throw new Error('Conversation needs at least one turn');
  const history = [], prior = [], turns = [];
  for (const [prompt, check] of steps) {
    signal?.throwIfAborted();
    const started = performance.now();
    const turn = { prompt };
    history.push({ role: 'user', text: prompt });
    let answered = false;
    try {
      const { answer, activity, evidence } = await send(history.map(message => ({ ...message })), signal);
      turn.answer = answer;
      if (activity !== undefined) turn.activity = activity;
      if (typeof answer !== 'string' || !answer.trim()) throw new Error('No completed visible reply');
      history.push({ role: 'assistant', text: answer });
      answered = true;
      try { await check(answer, [...prior], evidence); } finally { prior.push(answer); }
      turn.status = 'pass';
    } catch (error) {
      signal?.throwIfAborted();
      turn.status = 'fail';
      turn.detail = String(error?.message ?? error).slice(0, 300);
    }
    turns.push({ ...turn, seconds: (performance.now() - started) / 1000 });
    if (!answered) break;
  }
  return {
    status: turns.length === steps.length && turns.every(turn => turn.status === 'pass') ? 'pass' : 'fail',
    seconds: turns.reduce((sum, turn) => sum + turn.seconds, 0),
    turns,
  };
}
