/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Временный тип для virtual:pwa-register до npm install vite-plugin-pwa
declare module "virtual:pwa-register" {
  export type RegisterSWOptions = {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegistered?: (reg: ServiceWorkerRegistration | undefined) => void;
    onRegistrationError?: (error: unknown) => void;
  };
  export function registerSW(
    options?: RegisterSWOptions
  ): (reloadPage?: boolean) => Promise<void>;
}
