import type {
  AppConfig,
  ChatCompletionMessageParam,
  InitProgressReport,
  ModelRecord,
  WebWorkerMLCEngine,
} from '@mlc-ai/web-llm';
import { DEFAULT_MODEL_ID, MODEL_OPTIONS } from '@/constants/models';
import type { EngineBootProgress, SetupPhase } from '@/types/chat';

const ALLOWED_MODEL_IDS = new Set(MODEL_OPTIONS.map((model) => model.id));

function clampProgress(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function classifyPhase(progress: InitProgressReport): { phase: SetupPhase; text: string } {
  const rawText = (progress.text || '').trim();
  const source = rawText.toLowerCase();

  if (/fetching param cache|downloading|tokenizer|params/i.test(source)) {
    return { phase: 'downloading', text: 'Downloading offline model…' };
  }

  if (/loading model from cache/i.test(source)) {
    return { phase: 'loading', text: 'Loading cached model…' };
  }

  if (/shader|pipeline|webgpu|gpu/i.test(source)) {
    return { phase: 'initializing', text: 'Initializing local engine…' };
  }

  if (/finish loading|ready/i.test(source) || clampProgress(progress.progress) >= 1) {
    return { phase: 'ready', text: 'Offline model is ready on this device.' };
  }

  return { phase: 'initializing', text: rawText || 'Initializing local engine…' };
}

class ZayaEngine {
  private engine: WebWorkerMLCEngine | null = null;
  private worker: Worker | null = null;
  private activeModelId: string | null = null;
  private bootPromise: Promise<void> | null = null;
  private bootModelId: string | null = null;
  private webllmModulePromise: Promise<typeof import('@mlc-ai/web-llm')> | null = null;
  private appConfig: AppConfig | null = null;

  private getWebLLM() {
    if (!this.webllmModulePromise) {
      this.webllmModulePromise = import('@mlc-ai/web-llm');
    }
    return this.webllmModulePromise;
  }

  getActiveModelId(): string | null {
    return this.activeModelId;
  }

  isReady(modelId?: string): boolean {
    if (!this.engine || !this.activeModelId) return false;
    return modelId ? this.activeModelId === modelId : true;
  }

  private async getAppConfig(): Promise<AppConfig> {
    if (this.appConfig) return this.appConfig;

    const { prebuiltAppConfig } = await this.getWebLLM();
    const model_list = prebuiltAppConfig.model_list.filter((entry) => ALLOWED_MODEL_IDS.has(entry.model_id));
    const found = model_list.map((entry) => entry.model_id);

    if (!ALLOWED_MODEL_IDS.has(DEFAULT_MODEL_ID) || model_list.length !== ALLOWED_MODEL_IDS.size) {
      throw new Error(`Could not find the required offline model records. Found: ${found.join(', ') || 'none'}.`);
    }

    this.appConfig = {
      model_list: model_list as ModelRecord[],
      useIndexedDBCache: true,
    };

    return this.appConfig;
  }

  private getOrCreateWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/mlc.worker.ts', import.meta.url), {
        type: 'module',
      });
    }

    return this.worker;
  }

  private wrapProgress(onProgress?: (progress: EngineBootProgress) => void) {
    let lastPhase: SetupPhase | null = null;

    return (progress: InitProgressReport) => {
      const numeric = clampProgress(progress.progress);
      const rawText = (progress.text || '').trim();
      const classified = classifyPhase(progress);
      let phase = classified.phase;
      let text = classified.text;

      if (lastPhase === 'downloading' && phase === 'loading') {
        phase = 'verifying';
        text = 'Verifying downloaded model files…';
      }

      lastPhase = classified.phase;
      onProgress?.({
        phase,
        progress: numeric,
        text,
        rawText,
      });
    };
  }

  async boot(
    modelId: string,
    onProgress?: (progress: EngineBootProgress) => void,
  ): Promise<void> {
    if (!ALLOWED_MODEL_IDS.has(modelId)) {
      throw new Error('This model is not supported by Zaya Pocket.');
    }

    if (this.bootPromise) {
      if (this.bootModelId === modelId) {
        return this.bootPromise;
      }
      throw new Error('Another offline setup is already running. Wait for it to finish first.');
    }

    if (this.engine && this.activeModelId === modelId) {
      onProgress?.({
        phase: 'ready',
        progress: 1,
        text: 'Offline model is ready on this device.',
        rawText: 'Offline model is ready.',
      });
      return;
    }

    const run = async () => {
      const { CreateWebWorkerMLCEngine } = await this.getWebLLM();
      const appConfig = await this.getAppConfig();
      const progressCallback = this.wrapProgress(onProgress);
      const worker = this.getOrCreateWorker();

      try {
        if (!this.engine) {
          this.engine = await CreateWebWorkerMLCEngine(worker, modelId, {
            appConfig,
            initProgressCallback: progressCallback,
          });
          this.activeModelId = modelId;
          progressCallback({ progress: 1, timeElapsed: 0, text: 'Offline model is ready.' });
          return;
        }

        this.engine.setInitProgressCallback(progressCallback);

        if (this.activeModelId !== modelId) {
          progressCallback({ progress: 0.6, timeElapsed: 0, text: 'Loading model from cache[0/1]: 0MB loaded. 0% completed, 0 secs elapsed.' });
          await this.engine.reload(modelId);
          this.activeModelId = modelId;
        }

        progressCallback({ progress: 1, timeElapsed: 0, text: 'Offline model is ready.' });
      } catch (error) {
        await this.unload();
        throw error;
      }
    };

    this.bootModelId = modelId;
    this.bootPromise = run().finally(() => {
      this.bootPromise = null;
      this.bootModelId = null;
    });

    return this.bootPromise;
  }

  async isModelCached(modelId: string): Promise<boolean> {
    const { hasModelInCache } = await this.getWebLLM();
    return hasModelInCache(modelId, await this.getAppConfig());
  }

  async removeCachedModel(modelId: string): Promise<void> {
    const { deleteModelAllInfoInCache } = await this.getWebLLM();
    await deleteModelAllInfoInCache(modelId, await this.getAppConfig());

    if (this.activeModelId === modelId) {
      await this.unload();
    }
  }

  async interrupt(): Promise<void> {
    if (!this.engine) return;
    await this.engine.interruptGenerate();
  }

  async unload(): Promise<void> {
    if (this.engine) {
      try {
        await this.engine.unload();
      } catch {
        // ignore unload errors during recovery
      }
    }

    this.engine = null;
    this.activeModelId = null;
    this.worker?.terminate();
    this.worker = null;
  }

  async streamReply(
    messages: ChatCompletionMessageParam[],
    onToken: (token: string) => void,
  ): Promise<string> {
    if (!this.engine) {
      throw new Error('The model is not loaded yet.');
    }

    const stream = await this.engine.chat.completions.create({
      messages,
      stream: true,
      temperature: 0.7,
      top_p: 0.95,
    });

    let finalText = '';

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;

      const token = this.normalizeDelta(choice.delta?.content);
      if (token) {
        finalText += token;
        onToken(token);
      }

      if (choice.finish_reason === 'abort') {
        throw new Error('Generation was stopped before the reply finished.');
      }
    }

    const trimmed = finalText.trim();
    if (!trimmed) {
      throw new Error('The local model returned an empty reply. Please try again.');
    }

    return trimmed;
  }

  private normalizeDelta(delta: unknown): string {
    if (typeof delta === 'string') {
      return delta;
    }

    if (Array.isArray(delta)) {
      return delta
        .map((item) => this.normalizeDelta(item))
        .join('');
    }

    if (delta && typeof delta === 'object') {
      const record = delta as Record<string, unknown>;
      if (typeof record.text === 'string') return record.text;
      if (typeof record.content === 'string') return record.content;
      if (Array.isArray(record.content)) return this.normalizeDelta(record.content);
      if (typeof record.delta === 'string') return record.delta;
    }

    return '';
  }
}

export const zayaEngine = new ZayaEngine();
