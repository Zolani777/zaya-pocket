export function toReadableError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    const normalized = message.toLowerCase();

    if (normalized.includes('response is not ok') || normalized.includes('404') || normalized.includes('failed to fetch')) {
      return 'The offline brain files could not be reached. Check the connection and try again.';
    }

    if (normalized.includes('compatible gpu') || normalized.includes('webgpu')) {
      return 'This browser could not start the local brain here. Open Zaya in Safari over HTTPS or use a device with WebGPU support.';
    }

    if (normalized.includes('secure context')) {
      return 'Offline setup needs a secure connection. Open Zaya from your HTTPS domain or install it to the Home Screen first.';
    }

    if (normalized.includes('not loaded yet')) {
      return 'Offline chat is not ready yet. Finish setup from Offline setup first.';
    }

    return message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Something went wrong.';
}
