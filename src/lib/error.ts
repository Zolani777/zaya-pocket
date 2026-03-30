function extractMessage(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (value instanceof Error) {
    if (value.message?.trim()) return value.message.trim();
    return value.name?.trim() || null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractMessage(item);
      if (nested) return nested;
    }
    return null;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;

    const direct =
      extractMessage(record.message) ??
      extractMessage(record.reason) ??
      extractMessage(record.error) ??
      extractMessage(record.details) ??
      extractMessage(record.cause) ??
      extractMessage(record.description);

    if (direct) return direct;

    if (typeof record.name === 'string' && record.name.trim()) {
      return record.name.trim();
    }

    try {
      const json = JSON.stringify(value);
      if (json && json !== '{}' && json !== '[]' && json !== '"[object Object]"') return json;
    } catch {
      // ignore
    }
  }

  return null;
}

export function toReadableError(error: unknown): string {
  const message = extractMessage(error) ?? 'Something went wrong.';
  const normalized = message.toLowerCase();

  if (normalized === '[object object]') {
    return 'Offline setup failed while starting the local model. Try loading it again.';
  }

  if (normalized.includes('another offline setup is already running')) {
    return 'Offline setup is already running. Wait for it to finish.';
  }

  if (normalized.includes('response is not ok') || normalized.includes('failed to fetch') || normalized.includes('networkerror')) {
    return 'The offline model files could not be downloaded. Check your connection and try again.';
  }

  if (normalized.includes('not enough') || normalized.includes('quota') || normalized.includes('storage')) {
    return 'This device does not have enough free storage for the offline model.';
  }

  if (
    normalized.includes('compatible gpu') ||
    normalized.includes('webgpu') ||
    normalized.includes('adapter') ||
    normalized.includes('shader-f16') ||
    normalized.includes('device was lost') ||
    normalized.includes('device lost')
  ) {
    return 'This phone could not keep the local AI engine running. Reopen the app and use the Starter model.';
  }

  if (normalized.includes('abort')) {
    return 'Generation was stopped before the reply finished.';
  }

  if (normalized.includes('not loaded yet') || normalized.includes('still loading')) {
    return 'The offline model is still loading. Wait a moment and try again.';
  }

  if (normalized.includes('empty reply')) {
    return 'The local model returned an empty reply. Send the message again.';
  }

  if (normalized.includes('404') || normalized.includes('not found')) {
    return 'Some offline model files could not be found during setup.';
  }

  if (normalized.includes('cache')) {
    return 'The offline model cache could not be prepared correctly.';
  }

  return message;
}
