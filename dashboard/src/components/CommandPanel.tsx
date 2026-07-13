import { useState } from 'react';
import type { Estado } from '../lib/api';
import { postCommand, type Comando } from '../lib/api';
import { fmtHace } from '../lib/format';
import { Modal } from './ui/Modal';
import { IconAlerta, IconCalibrar, IconCandado, IconWifi } from './ui/icons';

interface Props {
  status: Estado | null;
  ahora: number;
  onComandoEnviado: () => void; // refresca /api/status para ver el ACK
}

type ModalAbierto = null | 'recalibrar' | 'portal' | 'setwifi';

interface Toast {
  id: number;
  texto: string;
  tipo: 'ok' | 'error';
}

function describeAck(status: Estado | null): string | null {
  const r = status?.ultimoResultadoComando;
  if (!r) return null;
  if (r.cmd === 'calibrar') {
    return r.estado === 'ok'
      ? 'Recalibración: OK'
      : r.estado === 'warmup'
        ? 'Recalibración: ignorada, la estación aún está en calentamiento'
        : `Recalibración: ${r.estado ?? '?'}`;
  }
  if (r.cmd === 'wifi_portal') return 'Portal WiFi: abierto en la estación';
  if (r.cmd === 'set_wifi') return 'Cambio de WiFi: aplicando';
  return r.raw ?? null;
}

export function CommandPanel({ status, ahora, onComandoEnviado }: Props) {
  const [token, setToken] = useState<string | null>(null); // SOLO en memoria
  const [tokenInput, setTokenInput] = useState('');
  const [modal, setModal] = useState<ModalAbierto>(null);
  const [pedirToken, setPedirToken] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [avanzado, setAvanzado] = useState(false);
  const [ssid, setSsid] = useState('');
  const [pass, setPass] = useState('');

  const offline = !(status?.online ?? false);
  const ack = describeAck(status);

  function toast(texto: string, tipo: Toast['tipo']) {
    const id = Date.now();
    setToasts((t) => [...t, { id, texto, tipo }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }

  async function enviar(cmd: Comando, body?: Record<string, string>) {
    if (!token) return;
    setEnviando(true);
    try {
      await postCommand(cmd, token, body);
      toast(
        cmd === 'recalibrate'
          ? 'Comando de recalibración publicado. El resultado aparecerá abajo.'
          : cmd === 'wifi-portal'
            ? 'Comando de portal WiFi publicado. Completa la configuración desde el celular.'
            : 'Credenciales WiFi publicadas.',
        'ok'
      );
      setModal(null);
      setSsid('');
      setPass('');
      setTimeout(onComandoEnviado, 2500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'error desconocido';
      if (msg === 'token inválido') {
        setToken(null);
        setPedirToken(true);
      }
      toast(`No se pudo enviar el comando: ${msg}.`, 'error');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="rounded-xl border border-edge bg-river-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-medium text-mist sm:text-xl">Controles</h2>
        {token ? (
          <button
            onClick={() => setToken(null)}
            className="inline-flex items-center gap-1.5 rounded-full border border-edge px-3 py-1 text-sm text-reed hover:text-mist"
          >
            <IconCandado abierto /> Bloquear
          </button>
        ) : (
          <button
            onClick={() => setPedirToken(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-azulejo px-3 py-1 text-sm text-azulejo"
          >
            <IconCandado /> Desbloquear controles
          </button>
        )}
      </div>

      {offline && (
        <p className="mt-2 flex items-center gap-2 text-sm" style={{ color: 'var(--sun)' }}>
          <IconAlerta /> La estación está desconectada: los comandos podrían no llegar hasta que
          reconecte.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          disabled={!token || enviando}
          onClick={() => setModal('recalibrar')}
          className="inline-flex items-center gap-2 rounded-lg border border-edge bg-river-deep px-4 py-2.5 text-mist transition-colors hover:border-canopy disabled:cursor-not-allowed disabled:opacity-40"
        >
          <IconCalibrar /> Recalibrar sensores
        </button>
        <button
          disabled={!token || enviando}
          onClick={() => setModal('portal')}
          className="inline-flex items-center gap-2 rounded-lg border border-edge bg-river-deep px-4 py-2.5 text-mist transition-colors hover:border-azulejo disabled:cursor-not-allowed disabled:opacity-40"
        >
          <IconWifi /> Abrir portal WiFi
        </button>
      </div>

      {!token && (
        <p className="mt-2 text-xs text-reed">
          Los comandos disparan acciones físicas en la estación; requieren el token del operador.
        </p>
      )}

      {token && (
        <div className="mt-3">
          <button
            onClick={() => setAvanzado((a) => !a)}
            aria-expanded={avanzado}
            className="text-xs text-reed underline hover:text-mist"
          >
            {avanzado ? 'ocultar avanzado' : 'avanzado…'}
          </button>
          {avanzado && (
            <button
              disabled={enviando}
              onClick={() => setModal('setwifi')}
              className="ml-3 text-xs text-azulejo underline"
            >
              cambiar red WiFi (set-wifi)
            </button>
          )}
        </div>
      )}

      {ack && (
        <p className="tabular mt-4 border-t border-edge pt-3 font-mono text-sm text-reed">
          Último resultado: <span className="text-mist">{ack}</span>{' '}
          {status?.ultimoResultadoComandoTs && (
            <span>({fmtHace(status.ultimoResultadoComandoTs, ahora)})</span>
          )}
        </p>
      )}

      {/* ── Modal: pedir token ── */}
      <Modal titulo="Desbloquear controles" abierto={pedirToken} onCerrar={() => setPedirToken(false)}>
        <p className="text-sm text-reed">
          Ingresa el token de operador. Se guarda solo en memoria: al recargar la página se vuelve
          a pedir.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (tokenInput.trim()) {
              setToken(tokenInput.trim());
              setTokenInput('');
              setPedirToken(false);
            }
          }}
        >
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="token de operador"
            autoComplete="off"
            className="mt-3 w-full rounded-md border border-edge bg-river-deep px-3 py-2 font-mono text-sm text-mist"
          />
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPedirToken(false)}
              className="rounded-lg border border-edge px-4 py-2 text-sm text-reed"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!tokenInput.trim()}
              className="rounded-lg border border-azulejo px-4 py-2 text-sm text-azulejo disabled:opacity-40"
            >
              Desbloquear
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Modal: recalibrar ── */}
      <Modal titulo="Recalibrar sensores" abierto={modal === 'recalibrar'} onCerrar={() => setModal(null)}>
        <p className="flex items-start gap-2 text-sm text-mist">
          <span style={{ color: 'var(--sun)' }}>
            <IconAlerta />
          </span>
          <span>
            Asegúrate de que el sensor esté en <strong>aire limpio</strong> (exterior, lejos de
            humo o cocina) antes de recalibrar. El sistema no puede verificarlo.
          </span>
        </p>
        <p className="mt-2 text-sm text-reed">
          La calibración toma unos 15 segundos y fija la referencia de los sensores de gas.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => setModal(null)}
            className="rounded-lg border border-edge px-4 py-2 text-sm text-reed"
          >
            Cancelar
          </button>
          <button
            onClick={() => enviar('recalibrate')}
            disabled={enviando}
            className="rounded-lg border border-canopy px-4 py-2 text-sm text-canopy disabled:opacity-40"
          >
            {enviando ? 'Enviando…' : 'Sí, el aire está limpio. Recalibrar'}
          </button>
        </div>
      </Modal>

      {/* ── Modal: portal WiFi ── */}
      <Modal titulo="Abrir portal WiFi" abierto={modal === 'portal'} onCerrar={() => setModal(null)}>
        <p className="text-sm text-mist">
          La estación se desconectará de la red actual y levantará su propia red{' '}
          <code className="font-mono text-azulejo">Estacion-Iquitos-Setup</code>. La configuración
          se completa desde el celular, conectándose a esa red.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => setModal(null)}
            className="rounded-lg border border-edge px-4 py-2 text-sm text-reed"
          >
            Cancelar
          </button>
          <button
            onClick={() => enviar('wifi-portal')}
            disabled={enviando}
            className="rounded-lg border border-azulejo px-4 py-2 text-sm text-azulejo disabled:opacity-40"
          >
            {enviando ? 'Enviando…' : 'Abrir portal'}
          </button>
        </div>
      </Modal>

      {/* ── Modal: set-wifi (avanzado) ── */}
      <Modal titulo="Cambiar red WiFi" abierto={modal === 'setwifi'} onCerrar={() => setModal(null)}>
        <p className="flex items-start gap-2 text-sm" style={{ color: 'var(--sun)' }}>
          <IconAlerta />
          <span>
            La contraseña viaja <strong>sin cifrar</strong> hasta el servidor (MQTT sin TLS). Para
            cambiar de red, el método preferido es el portal WiFi.
          </span>
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (ssid) enviar('set-wifi', { ssid, pass });
          }}
        >
          <input
            value={ssid}
            onChange={(e) => setSsid(e.target.value)}
            placeholder="nombre de la red (SSID)"
            className="mt-3 w-full rounded-md border border-edge bg-river-deep px-3 py-2 text-sm text-mist"
          />
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="contraseña de la red"
            autoComplete="off"
            className="mt-2 w-full rounded-md border border-edge bg-river-deep px-3 py-2 text-sm text-mist"
          />
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setModal(null)}
              className="rounded-lg border border-edge px-4 py-2 text-sm text-reed"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!ssid || enviando}
              className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40"
              style={{ borderColor: 'var(--sun)', color: 'var(--sun)' }}
            >
              {enviando ? 'Enviando…' : 'Enviar de todas formas'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Toasts ── */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[1200] space-y-2" role="status">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="rounded-lg border bg-river-panel px-4 py-2.5 text-sm shadow-xl"
            style={{
              borderColor: t.tipo === 'ok' ? 'var(--canopy)' : 'var(--clay)',
              color: 'var(--mist)',
            }}
          >
            {t.texto}
          </div>
        ))}
      </div>
    </section>
  );
}
