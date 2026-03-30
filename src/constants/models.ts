import type { ModelOption } from '@/types/chat';

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    name: 'Starter',
    sizeLabel: 'Llama 3.2 1B',
    memoryLabel: 'About 1 GB download',
    description: 'Best first setup for most phones. Faster startup and lighter local use.',
    recommended: true,
  },
  {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    name: 'Enhanced',
    sizeLabel: 'Llama 3.2 3B',
    memoryLabel: 'About 2.3 GB download',
    description: 'Sharper replies, but heavier. Use this after Starter is stable on your device.',
    caution: 'Can take longer to download and warm up on mobile hardware.',
  },
];

export const DEFAULT_MODEL_ID = MODEL_OPTIONS[0].id;
