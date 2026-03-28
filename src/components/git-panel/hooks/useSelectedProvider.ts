import { useEffect, useState } from 'react';

export function useSelectedProvider() {
  const [provider, setProvider] = useState(() => {
    return localStorage.getItem('selected-provider') || 'codex';
  });

  useEffect(() => {
    // Keep provider in sync when another tab changes the selected provider.
    const handleStorageChange = () => {
      const nextProvider = localStorage.getItem('selected-provider') || 'codex';
      setProvider(nextProvider);
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  return provider;
}
