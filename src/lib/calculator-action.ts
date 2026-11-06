const marker = "/* display-action */";

export const calculatorOperations = ["multiply", "divide", "add", "subtract", "negate", "absolute", "square", "sqrt", "round"] as const;
type Operation = typeof calculatorOperations[number];
const expressions: Record<Operation, string> = {
  multiply: "value * operand",
  divide: "value / operand",
  add: "value + operand",
  subtract: "value - operand",
  negate: "-value",
  absolute: "Math.abs(value)",
  square: "value ** 2",
  sqrt: "Math.sqrt(value)",
  round: "Math.round(value)",
};

/** Add a validated numeric action without replacing the starter's keypad or state machine. */
export function addCalculatorAction(source: string, label: string, operation: Operation, operand: number | null) {
  if (source.split(marker).length !== 2 || !label.trim() || label.length > 50
    || /^[0-9.+−×÷=]$|^Clear$/i.test(label)) return;
  if (!Object.hasOwn(expressions, operation)) return;
  if (["multiply", "divide", "add", "subtract"].includes(operation) && !Number.isFinite(operand)) return;
  if (operation === "divide" && operand === 0) return;
  const encodedLabel = JSON.stringify(label).replace(/</g, "\\u003c");
  return source.replace(marker, () => `{
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = ${encodedLabel};
  button.addEventListener('click', () => {
    const value = Number(display.textContent);
    if (!Number.isFinite(value)) return;
    const operand = ${JSON.stringify(operand)};
    const next = ${expressions[operation]};
    typed = Number.isFinite(next) ? String(Number(next.toPrecision(12))) : 'Error';
    show(typed);
  });
  keys.append(button);
}`);
}
