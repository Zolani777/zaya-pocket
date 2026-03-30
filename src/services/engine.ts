import type {
  ChatCompletionMessageParam,
  InitProgressReport,
  MLCEngineInterface,
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
  private bootingModelId: string | null = null;

  private async getWebLLM(): Promise<WebLLMModule> {
    if (!this.webllm) {
      this.webllm = await import('@mlc-ai/web-llm');
    }

    return this.webllm;
  }

  private async getAppConfig(modelId: string) {
    const { prebuiltAppConfig } = await this.getWebLLM();
    const record = prebuiltAppConfig.model_list.find((item) => item.model_id === modelId);

    if (!record) {
      throw new Error('This model is not registered in the local model runtime.');
    }

    return {
      ...prebuiltAppConfig,
      model_list: [record],
    };
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/mlc.worker.ts', import.meta.url), {
        type: 'module',
      });
    }

    return this.worker;
  }

  async boot(
    modelId: string,
    onProgress?: (progress: InitProgressReport) => void,
  ): Promise<void> {
    if (!ALLOWED_MODEL_IDS.has(modelId)) {
      throw new Error('This model is not allowed in Zaya Pocket.');
    }

    if (this.engine && this.activeModelId === modelId && !this.bootPromise) {
      onProgress?.({ progress: 1, text: 'Offline model is ready.' } as InitProgressReport);
      return;
    }

    if (this.bootPromise) {
      return this.bootPromise;
    }

    this.bootingModelId = modelId;

    this.bootPromise = (async () => {
      const { WebWorkerMLCEngine } = await this.getWebLLM();
      const appConfig = await this.getAppConfig(modelId);
      const worker = this.ensureWorker();

      onProgress?.({ progress: 0, text: 'Starting offline setup…' } as InitProgressReport);

      const initialStageTimer = window.setTimeout(() => {
        onProgress?.({
          progress: 0.01,
          text: 'Starting the first download… keep this screen open.',
        } as InitProgressReport);
      }, 5000);

      const slowStageTimer = window.setTimeout(() => {
        onProgress?.({
          progress: 0.02,
          text: 'The first download can sit at 0% for a bit on iPhone. Let it keep running.',
        } as InitProgressReport);
      }, 15000);

      try {
        if (!this.engine) {
          this.engine = new WebWorkerMLCEngine(worker, {
            appConfig,
            initProgressCallback: onProgress,
          });
        } else {
          this.engine.setInitProgressCallback(onProgress);
          this.engine.setAppConfig(appConfig);
        }

        if (this.activeModelId !== modelId) {
          await this.engine.reload(modelId);
          this.activeModelId = modelId;
        }

        onProgress?.({ progress: 1, text: 'Offline model is ready.' } as InitProgressReport);
      } finally {
        window.clearTimeout(initialStageTimer);
        window.clearTimeout(slowStageTimer);
        this.bootPromise = null;
        this.bootingModelId = null;
      }
    })();

    return this.bootPromise;
  }

  isReady(): boolean {
    return Boolean(this.engine && this.activeModelId);
  }

  isBooting(): boolean {
    return Boolean(this.bootPromise);
  }

  getBootingModelId(): string | null {
    return this.bootingModelId;
  }

  async isModelCached(modelId: string): Promise<boolean> {
    const { hasModelInCache } = await this.getWebLLM();
    return hasModelInCache(modelId);
  }

  async removeCachedModel(modelId: string): Promise<void> {
    const { deleteModelAllInfoInCache } = await this.getWebLLM();
    await deleteModelAllInfoInCache(modelId);

    if (this.activeModelId === modelId) {
      this.activeModelId = null;
      this.engine = null;
      this.worker?.terminate();
      this.worker = null;
    }
  }

  async interrupt(): Promise<void> {
    if (!this.engine) return;
    await this.engine.interruptGenerate();
  }

  async unload(): Promise<void> {
    if (this.engine) {
      await this.engine.unload();
    }

    this.bootPromise = null;
    this.bootingModelId = null;
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
      throw new Error('The offline model is not loaded yet.');
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
