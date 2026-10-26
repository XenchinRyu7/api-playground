/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface Window {
  toast?: {
    success: (message: string, duration?: number) => void;
    error: (message: string, duration?: number) => void;
    info: (message: string, duration?: number) => void;
  };
  showToast?: (message: string, type?: 'success' | 'error' | 'info', duration?: number) => void;
  showConfirm?: (opts: {
    title?: string;
    message?: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
  }) => Promise<boolean>;
  showAlert?: (message: string, title?: string) => Promise<void>;
  __PLAYGROUND_PROJECT__?: import('./lib/types').Project;
  __PLAYGROUND_VARS__?: Record<string, string>;
  __theme?: {
    get: () => string;
    set: (mode: string) => void;
  };
}