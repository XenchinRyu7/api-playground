// Konfigurasi publik. Ubah lewat environment variable di Vercel atau langsung di sini.
export const SITE = {
  name: import.meta.env.PUBLIC_SITE_NAME || 'API Playground',
  /** URL website utama (portfolio). Kosongkan untuk menyembunyikan tombol "kembali". */
  mainSiteUrl: import.meta.env.PUBLIC_MAIN_SITE_URL || '',
  mainSiteLabel: import.meta.env.PUBLIC_MAIN_SITE_LABEL || 'Portfolio',
  handle: import.meta.env.PUBLIC_HANDLE || 'guest',
  description: 'Coba langsung API yang saya bangun — dokumentasi interaktif, request builder, dan terminal di browser.',
};
