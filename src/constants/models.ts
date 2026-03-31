import type { ModelOption } from '@/types/chat';

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    name: 'Starter',
    sizeLabel: 'Qwen 2.5 0.5B',
    memoryLabel: 'Smaller download and lighter startup',
    description: 'Safest first setup for iPhone. This build favors stability over maximum quality.',
    recommended: true,
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    name: 'Enhanced',
    sizeLabel: 'Llama 3.2 1B',
    memoryLabel: 'Larger download and heavier startup',
    description: 'Use this only after Starter proves stable on your device.',
    caution: 'Can still be too heavy for some iPhone Home Screen sessions.',
  },
];

export const DEFAULT_MODEL_ID = MODEL_OPTIONS[0].id;
