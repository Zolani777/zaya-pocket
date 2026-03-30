export function formatClock(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatUpdatedAt(value: string): string {
  const then = new Date(value).getTime();
  const delta = Date.now() - then;
  const minutes = Math.floor(delta / 60000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(value).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
}
