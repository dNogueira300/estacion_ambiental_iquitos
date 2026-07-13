import { useCallback, useEffect, useState } from 'react';

export type Tema = 'dark' | 'light';

function temaInicial(): Tema {
  try {
    const t = localStorage.getItem('tema');
    if (t === 'light' || t === 'dark') return t;
  } catch {
    /* sin localStorage */
  }
  return 'dark'; // "río al anochecer" por defecto
}

export function useTheme(): { tema: Tema; alternar: () => void } {
  const [tema, setTema] = useState<Tema>(temaInicial);

  useEffect(() => {
    const raiz = document.documentElement;
    raiz.classList.add('theme-transition');
    raiz.setAttribute('data-theme', tema);
    try {
      localStorage.setItem('tema', tema);
    } catch {
      /* sin localStorage */
    }
    const id = setTimeout(() => raiz.classList.remove('theme-transition'), 350);
    return () => clearTimeout(id);
  }, [tema]);

  const alternar = useCallback(() => setTema((t) => (t === 'dark' ? 'light' : 'dark')), []);
  return { tema, alternar };
}
