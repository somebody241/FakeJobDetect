export function percent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatTick(value: number): string {
  const abs = Math.abs(value);
  if (abs !== 0 && abs < 10) return value.toFixed(2);
  if (abs < 100) return value.toFixed(1);
  return value.toFixed(0);
}
