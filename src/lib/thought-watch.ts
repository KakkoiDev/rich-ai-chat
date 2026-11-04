// PLH's repeated-three-line rule, bounded to recent reasoning and never applied to code.
export function thoughtWatch() {
  let tail = "";
  let lines: string[] = [];
  return (delta: string) => {
    const parts = (tail + delta).split("\n");
    tail = (parts.pop() ?? "").slice(-500);
    if (!parts.length) return false;
    lines = [...lines, ...parts.map(line => line.trim().slice(0, 500)).filter(Boolean)].slice(-100);
    const seen = new Map<string, number>();
    for (let i = 0; i + 2 < lines.length; i++) {
      const key = JSON.stringify(lines.slice(i, i + 3));
      const first = seen.get(key);
      if (first !== undefined && i - first >= 3) return true;
      if (first === undefined) seen.set(key, i);
    }
    return false;
  };
}
