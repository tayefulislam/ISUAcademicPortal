import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useToast } from '../context/ToastContext.jsx';

// Registers the service worker and surfaces the two states a PWA update
// flow needs: "ready to work offline" (first install) and "new version
// available" (subsequent visits) — using the app's existing toast system
// rather than a browser confirm() or a silent auto-reload.
export default function PwaUpdatePrompt() {
  const { toast } = useToast();
  const { offlineReady, needRefresh, updateServiceWorker } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      // Check for a new version every time the tab regains focus, not just
      // on load — otherwise a long-open tab never learns about updates.
      if (!registration) return;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update();
      });
    },
  });

  useEffect(() => {
    if (offlineReady[0]) {
      toast('App ready to work offline', 'success');
      offlineReady[1](false);
    }
  }, [offlineReady, toast]);

  useEffect(() => {
    if (needRefresh[0]) {
      toast('A new version is available — refresh to update', 'info');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needRefresh[0]]);

  // The toast is passive; give a real actionable button too since a new
  // version means stale JS chunks that can 404 on the next navigation.
  if (needRefresh[0]) {
    return (
      <button
        onClick={() => updateServiceWorker(true)}
        className="fixed bottom-4 left-4 z-[100] px-4 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold shadow-lg hover:bg-slate-800"
      >
        Update available — click to refresh
      </button>
    );
  }

  return null;
}
