export function toReadableError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();

    if (/response is not ok/i.test(message)) {
      return 'The offline model files could not be downloaded. Check your connection and try again.';
    }

    if (/failed to fetch/i.test(message)) {
      return 'Zaya could not reach the download source just now. Try again in a moment.';
    }

    if (/compatible gpu/i.test(message) || /webgpu/i.test(message)) {
      return 'This device/browser cannot start local AI here yet.';
    }

    return message || 'Something went wrong.';
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Something went wrong.';
}
