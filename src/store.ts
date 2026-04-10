import { create } from 'zustand';

export type Theme = 'light' | 'dark';
export type Language = 'zh' | 'en' | 'de';

const LANGUAGE_ORDER: Language[] = ['zh', 'en', 'de'];

export type State = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
};

const applyThemeToDocument = (theme: Theme) => {
  if (typeof document === 'undefined') return;
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
};

const applyLanguageToDocument = (language: Language) => {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('lang', language);
};

const notifyLanguageChange = (language: Language) => {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent('timetable-language-change', { detail: { language } }));
  } catch (err) {
    // CustomEvent might not be constructable in very old browsers; fall back silently
  }
};

export const useStore = create<State>((set) => {
  const savedTheme = ((): Theme | null => {
    try {
      const v = localStorage.getItem('theme');
      if (v === 'dark' || v === 'light') return v;
    } catch (e) {
      // ignore
    }
    return null;
  })();

  const prefersDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme: Theme = savedTheme || (prefersDark ? 'dark' : 'light');
  applyThemeToDocument(initialTheme);

  const savedLanguage = ((): Language | null => {
    try {
      const v = localStorage.getItem('language');
      if (v === 'en' || v === 'zh' || v === 'de') return v as Language;
    } catch (e) {
      // ignore
    }
    return null;
  })();

  const docLang = typeof document !== 'undefined' ? document.documentElement.getAttribute('lang') : null;
  const initialLanguage: Language = savedLanguage || (docLang === 'en' ? 'en' : docLang === 'de' ? 'de' : 'zh');
  applyLanguageToDocument(initialLanguage);

  return {
    theme: initialTheme,
    setTheme: (t) => {
      applyThemeToDocument(t);
      try { localStorage.setItem('theme', t); } catch (e) {}
      set({ theme: t });
    },
    toggleTheme: () => set((state) => {
      const next: Theme = state.theme === 'dark' ? 'light' : 'dark';
      applyThemeToDocument(next);
      try { localStorage.setItem('theme', next); } catch (e) {}
      return { theme: next };
    }),
    language: initialLanguage,
    setLanguage: (lang) => {
      const next: Language = LANGUAGE_ORDER.includes(lang) ? lang : 'zh';
      applyLanguageToDocument(next);
      try { localStorage.setItem('language', next); } catch (e) {}
      notifyLanguageChange(next);
      set({ language: next });
    },
    toggleLanguage: () => set((state) => {
      const idx = LANGUAGE_ORDER.indexOf(state.language);
      const next: Language = LANGUAGE_ORDER[(idx + 1) % LANGUAGE_ORDER.length];
      applyLanguageToDocument(next);
      try { localStorage.setItem('language', next); } catch (e) {}
      notifyLanguageChange(next);
      return { language: next };
    }),
  };
});

export default useStore;
