import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

type Variant = 'primary' | 'secondary' | 'outline-light' | 'ghost-light';
type Size = 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-all duration-200 ease-out ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange disabled:opacity-50 disabled:pointer-events-none';

const variants: Record<Variant, string> = {
  primary:
    'bg-orange text-white shadow-[0_10px_24px_-10px_rgba(255,90,31,0.55)] hover:bg-orange-light hover:-translate-y-0.5 active:translate-y-0',
  secondary:
    'bg-white text-royal border border-line hover:border-royal/40 hover:bg-royal/5 hover:-translate-y-0.5 active:translate-y-0',
  'outline-light':
    'bg-transparent text-white border border-white/30 hover:bg-white/10 hover:-translate-y-0.5 active:translate-y-0',
  'ghost-light': 'bg-white text-navy hover:bg-white/90 hover:-translate-y-0.5 active:translate-y-0',
};

const sizes: Record<Size, string> = {
  md: 'h-12 px-5 text-[15px]',
  lg: 'h-14 px-7 text-base',
};

interface ButtonOwnProps {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
  className?: string;
}

type ButtonAsButton = ButtonOwnProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined; to?: undefined };
type ButtonAsAnchor = ButtonOwnProps & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; to?: undefined };
type ButtonAsLink = ButtonOwnProps & Omit<LinkProps, 'className' | 'children'> & { href?: undefined; to: string };
type ButtonProps = ButtonAsButton | ButtonAsAnchor | ButtonAsLink;

export function Button({ variant = 'primary', size = 'md', className = '', children, ...props }: ButtonProps) {
  const classes = `${base} ${variants[variant]} ${sizes[size]} ${className}`;

  if (props.to !== undefined) {
    const { to, ...linkProps } = props as ButtonAsLink;
    return (
      <Link to={to} className={classes} {...(linkProps as any)}>
        {children}
      </Link>
    );
  }

  if (props.href !== undefined) {
    const { href, ...anchorProps } = props as ButtonAsAnchor;
    return (
      <a href={href} className={classes} {...(anchorProps as any)}>
        {children}
      </a>
    );
  }

  const buttonProps = props as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button className={classes} {...buttonProps}>
      {children}
    </button>
  );
}
