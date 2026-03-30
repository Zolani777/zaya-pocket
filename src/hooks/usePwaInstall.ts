import { useEffect, useState } from 'react';
import { isIosSafari, isStandaloneMode } from '@/lib/runtime';

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(() => isStandaloneMode());
  const [showIosHint, setShowIosHint] = useState(() => isIosSafari() && !isStandaloneMode());

  useEffect(() => {
    const handlePrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleStandaloneChange = () => {
      const standalone = isStandaloneMode();
      setIsStandalone(standalone);
      setShowIosHint(isIosSafari() && !standalone);
    };

    window.addEventListener('beforeinstallprompt', handlePrompt);
    window.addEventListener('appinstalled', handleStandaloneChange);
    window.matchMedia('(display-mode: standalone)').addEventListener('change', handleStandaloneChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', handlePrompt);
      window.removeEventListener('appinstalled', handleStandaloneChange);
      window.matchMedia('(display-mode: standalone)').removeEventListener('change', handleStandaloneChange);
    };
  }, []);

  const promptInstall = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!deferredPrompt) {
      return 'unavailable';
    }

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    return outcome;
  };

  return {
    canPrompt: Boolean(deferredPrompt),
    isStandalone,
    showIosHint,
    promptInstall,
  };
}
