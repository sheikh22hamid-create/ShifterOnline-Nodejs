import { Link, useLocation } from 'react-router-dom';
import type { AnchorHTMLAttributes, ReactNode } from 'react';

interface SmartLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string;
  children: ReactNode;
}

/**
 * Renders a route Link for extension-less `/`-prefixed SPA paths (e.g. `/estimate`).
 * For `#`-anchors, renders a plain in-page anchor while on the home page, or a
 * Link back to `/#anchor` from any other page (since hash targets only exist on
 * Home). Everything else (static files like `/terms.html`, `mailto:`, external
 * URLs) falls through to a plain anchor.
 */
export function SmartLink({ href, children, ...props }: SmartLinkProps) {
  const { pathname } = useLocation();

  const isSpaRoute = href.startsWith('/') && !href.includes('.');
  if (isSpaRoute) {
    return (
      <Link to={href} {...props}>
        {children}
      </Link>
    );
  }

  if (href.startsWith('#') && pathname !== '/') {
    return (
      <Link to={`/${href}`} {...props}>
        {children}
      </Link>
    );
  }

  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}
