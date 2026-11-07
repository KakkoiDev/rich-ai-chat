/**
 * A guarded transition table: each state lists the events it accepts, the state each leads to and an optional guard.
 * A guard reads a context the host supplies (dependencies, evidence, a reason) and returns null to allow the change
 * or a sentence saying why not. Everything here is pure: no clock, no storage, no mutation of the inputs.
 */

/** Validate and freeze a table: every target must be a known state and every guard a function. */
export function defineTransitions(table) {
  if (!table || typeof table !== "object" || Array.isArray(table))
    throw new TypeError("A transition table maps states to events");
  const states = Object.keys(table);
  for (const state of states) {
    for (const [event, rule] of Object.entries(table[state])) {
      if (!rule || !states.includes(rule.to))
        throw new TypeError(`${state} --${event}--> leads to an unknown state`);
      if (rule.guard !== undefined && typeof rule.guard !== "function")
        throw new TypeError(
          `${state} --${event}--> has a guard that is not a function`,
        );
    }
  }
  return Object.freeze(
    Object.fromEntries(
      states.map((state) => [
        state,
        Object.freeze(
          Object.fromEntries(
            Object.entries(table[state]).map(([event, rule]) => [
              event,
              Object.freeze({ ...rule }),
            ]),
          ),
        ),
      ]),
    ),
  );
}

/**
 * Apply one event. Returns `{ ok: true, from, to, event }` or `{ ok: false, error }` where the error says what was
 * refused and why; it never throws for an illegal change, so a host can show the sentence to the person or the agent.
 */
export function transition(table, state, event, context = {}) {
  const rules = table[state];
  if (!rules) return { ok: false, error: `Unknown state "${state}"` };
  const rule = rules[event];
  if (!rule) {
    const allowed = Object.keys(rules);
    return {
      ok: false,
      error:
        `Cannot ${event} from ${state}` +
        (allowed.length
          ? ` (allowed: ${allowed.join(", ")})`
          : " (final state)"),
    };
  }
  const refused = rule.guard ? rule.guard(context) : null;
  if (refused)
    return { ok: false, error: `Cannot ${event} from ${state}: ${refused}` };
  return { ok: true, from: state, to: rule.to, event };
}

/** The events whose guards pass in this state, in table order. */
export function allowedEvents(table, state, context = {}) {
  return Object.entries(table[state] ?? {})
    .filter(([, rule]) => !rule.guard || !rule.guard(context))
    .map(([event]) => event);
}

const evidenceKinds = ["test", "artifact", "receipt"];

/** Guard: at least one piece of evidence, each `{ kind: "test" | "artifact" | "receipt", ref: "<non-empty>" }`. */
export function hasEvidence({ evidence } = {}) {
  if (!Array.isArray(evidence) || evidence.length === 0)
    return "evidence is required (a test, artifact or receipt)";
  const bad = evidence.find(
    (item) =>
      !item ||
      !evidenceKinds.includes(item.kind) ||
      typeof item.ref !== "string" ||
      !item.ref.trim(),
  );
  return bad
    ? `evidence must be { kind: ${evidenceKinds.join(" | ")}, ref } with a non-empty ref`
    : null;
}

/** Guard: every dependency is done. `blockedBy` lists the ones that are not. */
export function dependenciesDone({ blockedBy = [] } = {}) {
  return blockedBy.length ? `waits for ${blockedBy.join(", ")}` : null;
}

/** Guard: a short reason is given (blocking without saying why helps nobody). */
export function hasReason({ reason } = {}) {
  return typeof reason === "string" && reason.trim()
    ? null
    : "a reason is required";
}

/**
 * Task and todo states. Work can be marked done only by `verify` with evidence; starting waits for dependencies;
 * blocking needs a reason; done and cancelled items can be reopened.
 */
export const taskTransitions = defineTransitions({
  pending: {
    start: { to: "in_progress", guard: dependenciesDone },
    block: { to: "blocked", guard: hasReason },
    cancel: { to: "cancelled" },
  },
  in_progress: {
    pause: { to: "pending" },
    block: { to: "blocked", guard: hasReason },
    verify: { to: "done", guard: hasEvidence },
    cancel: { to: "cancelled" },
  },
  blocked: {
    unblock: { to: "pending" },
    cancel: { to: "cancelled" },
  },
  done: { reopen: { to: "pending" } },
  cancelled: { reopen: { to: "pending" } },
});
