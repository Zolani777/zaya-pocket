export function toReadableError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    const lowered = message.toLowerCase();

    if (!message) {
      return 'Something went wrong.';
    }

    if (lowered.includes('response is not ok') || lowered.includes('failed to fetch') || lowered.includes('networkerror')) {
      return 'The offline model files could not be reached. Make sure your connection is stable and try the download again.';
    }

    if (lowered.includes('compatible gpu') || lowered.includes('webgpu')) {
      return 'This device could not start the local AI model here.';
    }

    if (lowered.includes('finish offline setup')) {
      return 'Finish offline setup before sending your first message.';
    }

    if (lowered.includes('quota') || lowered.includes('storage')) {
      return 'There is not enough free storage on this device for the offline model download.';
    }

    if (lowered.includes('not allowed in zaya pocket')) {
      return 'That model is not enabled in this build of Zaya Pocket.';
    }

    if (lowered.includes('not registered in the local model runtime')) {
      return 'The selected offline model could not be found in the local runtime registry.';
    }

    if (lowered.includes('not loaded yet')) {
      return 'The offline model is not ready yet. Finish setup first.';
    }

    return message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Something went wrong.';
}
