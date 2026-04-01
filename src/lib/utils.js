import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function safeJsonParse(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function resolveAppUrl(url) {
  if (!url || typeof url !== 'string') return '';

  const trimmedUrl = url.trim();
  if (!trimmedUrl) return '';

  if (/^(https?:)?\/\//i.test(trimmedUrl) || trimmedUrl.startsWith('mailto:') || trimmedUrl.startsWith('tel:')) {
    return trimmedUrl;
  }

  const baseUrl = import.meta.env.BASE_URL || '/';
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const previewMatch = trimmedUrl.match(/^\/preview\/([^/]+)\/([^/]+)(\/.*)?$/);

  if (previewMatch) {
    const [, workflowId, target, rest = '/'] = previewMatch;
    const token = typeof window !== 'undefined' ? window.localStorage?.getItem('auth-token') || '' : '';
    const previewUrl = `/api/delivery/${workflowId}/preview/${target}${rest}`;
    return token
      ? `${previewUrl}${previewUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
      : previewUrl;
  }

  if (trimmedUrl.startsWith('/')) {
    return `${normalizedBase.replace(/\/+$/, '')}${trimmedUrl}`;
  }

  return `${normalizedBase}${trimmedUrl.replace(/^\/+/, '')}`;
}
