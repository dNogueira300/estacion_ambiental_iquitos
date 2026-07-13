import { useCallback, useEffect, useRef, useState } from 'react';

export interface PollState<T> {
  data: T | null;
  error: string | null;
  loading: boolean; // solo la primera carga
  refresh: () => void;
}

/**
 * Sondeo periódico con reintento automático: si una llamada falla, se
 * conserva el último dato bueno y se marca el error (la UI decide cómo
 * mostrarlo). Se pausa cuando la pestaña está oculta.
 */
export function usePolling<T>(fn: () => Promise<T>, intervalMs: number): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let vivo = true;
    let timer: ReturnType<typeof setTimeout>;
    let primera = true;

    async function ciclo() {
      // La primera carga se hace siempre, aunque la pestaña esté oculta;
      // los sondeos siguientes se pausan hasta que vuelva a ser visible.
      if (primera || document.visibilityState !== 'hidden') {
        primera = false;
        try {
          const d = await fnRef.current();
          if (!vivo) return;
          setData(d);
          setError(null);
        } catch (e) {
          if (!vivo) return;
          setError(e instanceof Error ? e.message : 'error de red');
        } finally {
          if (vivo) setLoading(false);
        }
      }
      if (vivo) timer = setTimeout(ciclo, intervalMs);
    }

    ciclo();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer);
        ciclo();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      vivo = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs, tick]);

  return { data, error, loading, refresh };
}

/** Reloj de 1 s para los tickers "hace X s" */
export function useAhora(): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return ahora;
}
