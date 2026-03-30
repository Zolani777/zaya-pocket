import type {
  AppConfig,
  ChatCompletionMessageParam,
  InitProgressReport,
  MLCEngineInterface,
  ModelRecord,
} from '@mlc-ai/web-llm';

type WebLLMModule = typeof import('@mlc-ai/web-llm');

const ALLOWED_MODEL_IDS = new Set([
  'Llama-3.2-1B-Instruct-q4f16_1-MLC',
  'Llama-3.2-3B-Instruct-q4f16_1-MLC',
]);

class ZayaEngine {
  private worker: Worker | null = null;
  private engine: MLCEngineInterface | null = null;
  private activeModelId: string | null = null;
  private webllm: WebLLMModule | null = null;
  private bootPromise: Promise<void> | null = null;
  private bootModelId: string | null = null;
  private appConfig: AppConfig | null = null;

  private async getWebLLM(): Promise<WebLLMModule> {
    if (!this.webllm) {
      this.webllm = await import('@mlc-ai/web-llm');
    }

    return this.webllm;
  }

  private async getAppConfig(): Promise<AppConfig> {
    if (this.appConfig) return this.appConfig;

    const { prebuiltAppConfig } = await this.getWebLLM();
    const model_list = prebuiltAppConfig.model_list.filter((record) => ALLOWED_MODEL_IDS.has(record.model_id));

    if (model_list.length !== ALLOWED_MODEL_IDS.size) {
      const found = model_list.map((record) => record.model_id).join(', ');
      throw new Error(`Could not find the required offline model records. Found: ${found || 'none'}.`);
    }

    this.appConfig = {
      model_list: model_list as ModelRecord[],
      useIndexedDBCache: false,
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
      let text = progress.text?.trim() || '';

      if (!text) {
        text = numeric >= 1 ? 'Initializing offline model…' : 'Downloading offline model…';
      } else if (/fetching|cache\[|loading model from cache/i.test(text)) {
        text = numeric >= 1 ? 'Initializing offline model…' : 'Downloading offline model…';
      } else if (/initializ|creating|instantiating|warm/i.test(text)) {
        text = 'Initializing offline model…';
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
          progressCallback({ progress: 0.98, timeElapsed: 0, text: 'Initializing offline model…' });
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
    return Boolean(this.engine);
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

    return finalText.trim();
  }

  private normalizeDelta(delta: unknown): string {
    if (typeof delta === 'string') {
      return delta;
    }

    if (Array.isArray(delta)) {
      return delta
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object' && 'text' in item) {
            return String((item as { text: string }).text ?? '');
          }
          return '';
        })
        .join('');
    }

    return '';
  }
}

export const zayaEngine = new ZayaEngine();
