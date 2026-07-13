import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconCerrar } from './icons';

interface Props {
  titulo: string;
  abierto: boolean;
  onCerrar: () => void;
  children: ReactNode;
}

/** Modal accesible: trap de foco, Esc para cerrar, clic fuera cierra. */
export function Modal({ titulo, abierto, onCerrar, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const previo = useRef<Element | null>(null);

  useEffect(() => {
    if (!abierto) return;
    previo.current = document.activeElement;

    const nodo = ref.current;
    const focusables = () =>
      nodo?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ) ?? [];
    // Foco inicial: primer campo de entrada si lo hay; si no, el primer control
    const campo = nodo?.querySelector<HTMLElement>('input, select, textarea');
    (campo ?? focusables()[0])?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCerrar();
      } else if (e.key === 'Tab') {
        const els = Array.from(focusables());
        if (els.length === 0) return;
        const primero = els[0];
        const ultimo = els[els.length - 1];
        if (e.shiftKey && document.activeElement === primero) {
          e.preventDefault();
          ultimo.focus();
        } else if (!e.shiftKey && document.activeElement === ultimo) {
          e.preventDefault();
          primero.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      (previo.current as HTMLElement | null)?.focus?.();
    };
  }, [abierto, onCerrar]);

  if (!abierto) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="w-full max-w-md rounded-xl border border-edge bg-river-panel p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between gap-4">
          <h3 className="font-display text-lg font-medium text-mist">{titulo}</h3>
          <button
            onClick={onCerrar}
            aria-label="cerrar"
            className="rounded p-1 text-reed hover:text-mist"
          >
            <IconCerrar />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
