import { createContext, useContext } from 'react';

export interface AuthSessionContextValue {
  signOut: () => Promise<void>;
}

export const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

export function useAuthSession(): AuthSessionContextValue | null {
  return useContext(AuthSessionContext);
}
