import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Branch, ItemType, PatronCategory, PublicSettings } from './types';

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const LONG = 5 * 60 * 1000;

export function usePublicSettings() {
  return useQuery({ queryKey: ['settings', 'public'], queryFn: () => api<PublicSettings>('/settings/public'), staleTime: LONG });
}

/** Currency for money formatting (defaults to USD until settings load). */
export function useCurrency(): string {
  return usePublicSettings().data?.currency ?? 'USD';
}

export function useBranches() {
  return useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/branches'), staleTime: LONG });
}

export function useItemTypes() {
  return useQuery({ queryKey: ['lookups', 'item-types'], queryFn: () => api<ItemType[]>('/lookups/item-types'), staleTime: LONG });
}

export function usePatronCategories() {
  return useQuery({
    queryKey: ['lookups', 'patron-categories'],
    queryFn: () => api<PatronCategory[]>('/lookups/patron-categories'),
    staleTime: LONG,
  });
}

export function usePaymentMethods() {
  return useQuery({ queryKey: ['lookups', 'payment-methods'], queryFn: () => api<string[]>('/lookups/payment-methods'), staleTime: LONG });
}

/** Sets the browser tab title while a page is shown. */
export function useTitle(title: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · Library`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
