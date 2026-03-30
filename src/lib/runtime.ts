export interface RuntimeSupport {
  hasWorker: boolean;
  hasIndexedDb: boolean;
  hasWebGpu: boolean;
  hasSecureContext: boolean;
  supported: boolean;
}

export function getRuntimeSupport(): RuntimeSupport {
  const hasWorker = typeof window !== 'undefined' && 'Worker' in window;
  const hasIndexedDb = typeof window !== 'undefined' && 'indexedDB' in window;
  const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  const hasSecureContext = typeof window !== 'undefined' ? window.isSecureContext : false;

  return {
    hasWorker,
    hasIndexedDb,
    hasWebGpu,
    hasSecureContext,
    supported: hasWorker && hasIndexedDb && hasWebGpu && hasSecureContext,
  };
}

export function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;

  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;

  const ua = navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/i.test(ua);
  const isWebKit = /WebKit/i.test(ua);
  const isOtherBrowser = /CriOS|FxiOS|EdgiOS/i.test(ua);

  return isIos && isWebKit && !isOtherBrowser;
}
