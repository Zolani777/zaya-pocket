import type {
  AppConfig,
  ChatCompletionMessageParam,
  InitProgressReport,
  ModelRecord,
  WebWorkerMLCEngine,
} from '@mlc-ai/web-llm';
import { DEFAULT_MODEL_ID, MODEL_OPTIONS } from '@/constants/models';

const ALLOWED_MODEL_IDS = new Set(MODEL_OPTIONS.map((model) => model.id));

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

  private wrapProgress(modelId: string, onProgress?: (progress: InitProgressReport) => void) {
    return (progress: InitProgressReport) => {
      const numeric = typeof progress.progress === 'number' ? Math.max(0, Math.min(1, progress.progress)) : 0;
      const source = (progress.text || '').trim().toLowerCase();
      let text = progress.text?.trim() || '';

      if (!text) {
        text = numeric >= 1 ? 'Offline model is ready.' : 'Downloading offline model…';
      } else if (/fetching|downloading|param cache|cache\[|ndarray|tokenizer|params/i.test(source)) {
        text = 'Downloading offline model…';
      } else if (/loading.*cache|from cache|cached/i.test(source)) {
        text = 'Loading downloaded model…';
      } else if (/initial|creating|instantiating|warm|shader|webgpu|pipeline|prefill/i.test(source)) {
        text = 'Initializing local engine…';
      }

      onProgress?.({ ...progress, progress: numeric, text });
    };
  }

  async boot(
    modelId: string,
    onProgress?: (progress: InitProgressReport) => void,
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
      onProgress?.({ progress: 1, timeElapsed: 0, text: 'Offline model is ready.' });
      return;
    }

    const run = async () => {
      const { CreateWebWorkerMLCEngine } = await this.getWebLLM();
      const appConfig = await this.getAppConfig();
      const progressCallback = this.wrapProgress(modelId, onProgress);
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
          progressCallback({ progress: 0.98, timeElapsed: 0, text: 'Initializing local engine…' });
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

  isReady(): boolean {
    return Boolean(this.engine && this.activeModelId);
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
      const delta = chunk.choices[0]?.delta?.content;
      const token = this.normalizeDelta(delta);
      if (!token) continue;
      finalText += token;
      onToken(token);
    }

    if (finalText.trim()) {
      return finalText.trim();
    }

    const completion = await this.engine.chat.completions.create({
      messages,
      stream: false,
      temperature: 0.7,
      top_p: 0.95,
    });

    const fallback = this.normalizeDelta(completion.choices?.[0]?.message?.content);
    return fallback.trim();
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
    }

    return '';
  }
}

export const zayaEngine = new ZayaEngine();
