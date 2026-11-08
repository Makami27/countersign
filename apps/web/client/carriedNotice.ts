const carried = new Map<string, string>();

export function carryNotice(key: string, text: string): void {
  carried.set(key, text);
}

export function showCarried(key: string, status: HTMLElement): void {
  const text = carried.get(key);
  if (!text) return;
  carried.delete(key);
  setTimeout(() => (status.textContent = text), 50);
}
