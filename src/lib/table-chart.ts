const chartFollowup = /^(?:(?:i (?:want|would like)|show me|show|make|draw|plot|create|do|redo|render)\s+)?(?:(?:this|that|it)\s+as\s+)?(?:(?:a|the)\s+)?(?:(line|bar)\s+)?(?:chart|graph)(?:\s+again)?(?:\s+please)?[.!?]*$/i;

// OpenUI tables can refer to JSON array assignments in their own reply.
function openUITable(reply: string): string | undefined {
  const table = reply.match(/\bTable\s*\(\s*\[([^\n]*)\]\s*\)/);
  if (!table) return;
  const columns: { label: string; values: (string | number)[] }[] = [];
  for (const match of table[1].matchAll(/\bCol\s*\(\s*("(?:\\.|[^"\\])*")\s*,\s*([A-Za-z_]\w*|\[[^\n]*?\])\s*(?:,\s*"[^"]*")?\s*\)/g)) {
    const literal = match[2].startsWith("[") ? match[2]
      : reply.match(new RegExp(`^\\s*${match[2]}\\s*=\\s*(\\[[^\\n]*\\])\\s*$`, "m"))?.[1];
    if (!literal) return;
    try {
      const values: unknown = JSON.parse(literal);
      const label: string = JSON.parse(match[1]);
      if (!Array.isArray(values) || !values.length || values.length > 60
        || !values.every(v => typeof v === "number" && Number.isFinite(v) || typeof v === "string" && !/[|\r\n]/.test(v))
        || /[|\r\n]/.test(label)) return;
      columns.push({ label, values });
    } catch { return; }
  }
  if (columns.length < 2 || columns.some(col => col.values.length !== columns[0].values.length)) return;
  const row = (values: (string | number)[]) => `| ${values.join(" | ")} |`;
  return [
    row(columns.map(col => col.label)), row(columns.map(() => "---")),
    ...columns[0].values.map((_, i) => row(columns.map(col => col.values[i]))),
  ].join("\n");
}

export function chartFromTable(request: string, replies: string[]) {
  const intent = chartFollowup.exec(request.trim());
  if (!intent) return undefined;
  const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
  for (const reply of replies) {
    const lines = (openUITable(reply) ?? reply).split("\n");
    for (let i = lines.length - 1; i > 0; i--) {
      if (!/^\s*\|/.test(lines[i]) || !cells(lines[i]).every(cell => /^:?-{3,}:?$/.test(cell))) continue;
      const headings = cells(lines[i - 1]);
      if (headings.length < 2 || headings.length > 16) continue;
      const rows: string[][] = [];
      for (let j = i + 1; j < lines.length && /^\s*\|/.test(lines[j]); j++) rows.push(cells(lines[j]));
      if (!rows.length || rows.length > 60 || rows.some(row => row.length !== headings.length || !row[0])) continue;
      const series: { name: string; values: number[]; unit: string }[] = [];
      for (let col = 1; col < headings.length; col++) {
        const values = rows.map(row => row[col].match(/^(-?\d+(?:\.\d+)?)\s*(%|°[CF])?$/i));
        if (values.some(value => !value || !Number.isFinite(Number(value[1])))) continue;
        const units = new Set(values.map(value => value?.[2] ?? ""));
        if (units.size !== 1) continue;
        series.push({ name: headings[col], values: values.map(value => Number(value![1])),
          unit: headings[col].match(/%|°[CF]/i)?.[0] ?? values[0]?.[2] ?? "" });
      }
      if (!series.length) continue;
      const groups = [...new Set(series.map(s => s.unit))];
      const component = intent[1]?.toLowerCase() === "bar" ? "BarChart" : "LineChart";
      const labels = JSON.stringify(rows.map(row => row[0]));
      const charts = groups.map(unit => {
        const entries = series.filter(s => s.unit === unit).map(s => `Series(${JSON.stringify(s.name)}, ${JSON.stringify(s.values)})`);
        return `${component}(${labels}, [${entries.join(", ")}])`;
      });
      return `root = Card([CardHeader("Chart from the previous table"), ${charts.join(", ")}])`;
    }
  }
}
