/// <reference path="../.astro/types.d.ts" />

type ToastFn = (message: string, duration?: number) => void;

export interface ToastApi {
  success: ToastFn;
  error: ToastFn;
  info: ToastFn;
}

export interface ConfirmDialogOptions {
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

declare global {
  interface Window {
    toast: ToastApi;
    showToast: (message: string, type?: 'success' | 'error' | 'info', duration?: number) => void;
    showConfirm: (opts: ConfirmDialogOptions) => Promise<boolean>;
    showAlert: (message: string, title?: string) => Promise<void>;
    __PLAYGROUND_PROJECT__?: import('./lib/types').Project;
    __PLAYGROUND_VARS__?: Record<string, string>;
    __theme?: {
      get: () => string;
      set: (mode: string) => void;
    };
  }
}

export {};