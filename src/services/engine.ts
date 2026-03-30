import type {
  ChatCompletionMessageParam,
  InitProgressReport,
  MLCEngineInterface,
} from '@mlc-ai/web-llm';

type WebLLMModule = typeof import('@mlc-ai/web-llm');

class ZayaEngine {
  private worker: Worker | null = null;
  private engine: MLCEngineInterface | null = null;
  private activeModelId: string | null = null;
  private webllm: WebLLMModule | null = null;

  private async getWebLLM(): Promise<WebLLMModule> {
    if (!this.webllm) {
      this.webllm = await import('@mlc-ai/web-llm');
    }

    return this.webllm;
  }

  async boot(
    modelId: string,
    onProgress?: (progress: InitProgressReport) => void,
  ): Promise<void> {
    const { CreateWebWorkerMLCEngine } = await this.getWebLLM();

    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/mlc.worker.ts', import.meta.url), {
        type: 'module',
      });
    }

    if (!this.engine) {
      this.engine = await CreateWebWorkerMLCEngine(this.worker, modelId, {
        initProgressCallback: onProgress,
      });
      this.activeModelId = modelId;
      return;
    }

    if (onProgress) {
      this.engine.setInitProgressCallback(onProgress);
    }

    if (this.activeModelId !== modelId) {
      await this.engine.reload(modelId);
      this.activeModelId = modelId;
    }
  }

  isReady(): boolean {
    return Boolean(this.engine);
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
