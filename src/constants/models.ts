import type { ModelOption } from '@/types/chat';

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    name: 'Llama 3.2 1B',
    sizeLabel: '1B · fast',
    memoryLabel: '~879 MB VRAM class',
    description: 'The safest first ship for iPhone-class browsers. Smaller, faster, better chance to initialize cleanly.',
    recommended: true,
  },
  {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    name: 'Llama 3.2 3B',
    sizeLabel: '3B · better answers',
    memoryLabel: '~2264 MB VRAM class',
    description: 'Higher quality but much heavier. Keep this as the opt-in upgrade tier after the 1B model is proven stable.',
    caution: 'Use only on stronger devices with patience for longer cold starts.',
  },
];

export const DEFAULT_MODEL_ID = MODEL_OPTIONS[0].id;
