export function toReadableError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();

    if (/response is not ok/i.test(message)) {
      return 'The offline model download could not be completed.';
    }

    if (/compatible gpu/i.test(message) || /webgpu/i.test(message)) {
      return 'This device could not start the local AI model here.';
    }

    return message || 'Something went wrong.';
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Something went wrong.';
}
