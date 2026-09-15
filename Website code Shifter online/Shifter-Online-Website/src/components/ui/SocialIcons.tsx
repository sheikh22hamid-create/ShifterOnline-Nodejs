import type { SVGProps } from 'react';

export function FacebookIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" {...props}>
      <path d="M13.5 21v-8.2h2.75l.41-3.2h-3.16V7.5c0-.93.26-1.56 1.6-1.56h1.7V3.1C15.98 3.05 15.05 3 13.96 3c-2.28 0-3.85 1.4-3.85 3.96v2.64H7.35v3.2h2.76V21h3.39z" />
    </svg>
  );
}

export function InstagramIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16" {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.15" cy="6.85" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function TwitterIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" {...props}>
      <path d="M18.9 3h3l-6.6 7.55L23 21h-6.1l-4.77-6.24L6.64 21H3.63l7.06-8.08L2 3h6.25l4.31 5.7L18.9 3zm-1.06 16.17h1.66L7.24 4.74H5.46l12.38 14.43z" />
    </svg>
  );
}

export function LinkedinIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" {...props}>
      <path d="M6.94 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM3.3 8.75h3.3V21H3.3V8.75zM9.75 8.75h3.16v1.68h.05c.44-.83 1.52-1.7 3.12-1.7 3.34 0 3.96 2.2 3.96 5.05V21h-3.3v-6.3c0-1.5-.03-3.44-2.1-3.44-2.1 0-2.42 1.64-2.42 3.33V21h-3.3V8.75z" />
    </svg>
  );
}
