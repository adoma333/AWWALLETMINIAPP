import { createContext, useContext } from 'react';

// Global app state: config (public), me (profile), wallet (balances), icons (admin overrides), helpers.
export const AppCtx = createContext({ config: null, me: null, wallet: null, icons: {}, refresh: () => {}, toast: () => {} });
export const useApp = () => useContext(AppCtx);
