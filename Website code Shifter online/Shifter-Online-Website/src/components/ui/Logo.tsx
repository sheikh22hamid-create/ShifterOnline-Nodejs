interface LogoProps {
  dark?: boolean;
  className?: string;
}

export function Logo({ dark = false, className = '' }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-gradient-to-br from-orange to-orange-light text-white font-extrabold text-lg shadow-[0_6px_16px_-4px_rgba(255,90,31,0.5)]">
        S
      </span>
      <span className={`text-[19px] font-extrabold tracking-tight ${dark ? 'text-white' : 'text-ink'}`}>
        Shifter <span className="text-orange">Online</span>
      </span>
    </span>
  );
}
