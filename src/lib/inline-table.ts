/** Sum explicitly supplied key/value pairs. Leave ambiguous or unstructured requests to the model. */
export function inlineSumTable(request: string) {
  if (request.length > 4000 || !/\bnative\s+openui\s+table\b/i.test(request)) return;
  if (!/\b(?:combine|sum|aggregate|add up)\b[^.!?\r\n]{0,100}\b(?:each|per|by|same)\b/i.test(request)) return;
  const headers = /\bheaders?\s+([\p{L}\p{N} _-]{1,40}?)\s+and\s+([\p{L}\p{N} _-]{1,40}?)[.;]/iu.exec(request);
  const rows = /:\s*((?:[\p{L}][\p{L}\p{N} _-]{0,39}\s+-?\d+(?:\.\d+)?\s*,\s*)+[\p{L}][\p{L}\p{N} _-]{0,39}\s+-?\d+(?:\.\d+)?)(?=\s*(?:\.(?!\d)|;|$))/u.exec(request);
  if (!headers || !rows) return;
  const totals = new Map<string, bigint>();
  const scale = BigInt(1_000_000_000_000);
  const zero = BigInt(0);
  for (const entry of rows[1].split(",")) {
    const match = /^([\p{L}][\p{L}\p{N} _-]*?)\s+(-?)(\d{1,18})(?:\.(\d{1,12}))?$/u.exec(entry.trim());
    if (!match) return;
    const value = BigInt(match[3]) * scale + BigInt((match[4] ?? "").padEnd(12, "0"));
    totals.set(match[1], (totals.get(match[1]) ?? zero) + (match[2] ? -value : value));
  }
  const [group, total] = headers.slice(1).map(value => JSON.stringify(value.trim()));
  const names = JSON.stringify([...totals.keys()]);
  const sums = JSON.stringify([...totals.values()].map(value => {
    const absolute = value < zero ? -value : value;
    const decimal = String(absolute % scale).padStart(12, "0").replace(/0+$/, "");
    return (value < zero ? "-" : "") + String(absolute / scale) + (decimal ? "." + decimal : "");
  }));
  return `root = Card([Table([Col(${group}, ${names}), Col(${total}, ${sums})])])`;
}
