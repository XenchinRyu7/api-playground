// Konfigurasi publik. Ubah lewat environment variable di Vercel atau langsung di sini.
const env = (k: string): string =>
  (import.meta.env as any)[k] ?? (globalThis as any).process?.env?.[k] ?? '';

const normalizeUrl = (url: string) => {
  const trimmed = url.trim();
  if (!trimmed) return '';
  // Jika tidak diawali http:// atau https:// dan bukan relative path (/path), tambahkan https://
  if (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('/')) {
    return `https://${trimmed}`;
  }
  return trimmed;
};

export const SITE = {
  name: env('PUBLIC_SITE_NAME') || 'API Playground',
  /** URL website utama (portfolio). Otomatis diprefix https:// jika protokol tidak disertakan. */
  mainSiteUrl: normalizeUrl(env('PUBLIC_MAIN_SITE_URL')),
  mainSiteLabel: env('PUBLIC_MAIN_SITE_LABEL') || 'Portfolio Utama',
  handle: env('PUBLIC_HANDLE') || 'guest',
  description: 'Coba langsung API yang saya bangun — dokumentasi interaktif, request builder, dan terminal di browser.',
};
