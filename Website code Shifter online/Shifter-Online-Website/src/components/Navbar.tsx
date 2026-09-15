import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Calculator, ChevronDown, LogOut, Menu, Phone, X } from 'lucide-react';
import { Button } from './ui/Button';
import { SmartLink } from './ui/SmartLink';
import { useAuth } from '../context/AuthContext';

const navLinks = [
  { label: 'Home', href: '#home' },
  { label: 'About Us', href: '#why-us' },
  { label: 'Services', href: '#services', hasDropdown: true },
  { label: 'App', href: '#app' },
  { label: 'Contact', href: '#cta' },
];

const serviceLinks = [
  { label: 'Express Delivery', href: '#services' },
  { label: 'Freight & Cargo', href: '#services' },
  { label: 'Air Cargo', href: '#services' },
  { label: 'Warehousing', href: '#services' },
];

interface NavbarProps {
  onLoginClick: () => void;
  onGetStartedClick: () => void;
}

export function Navbar({ onLoginClick, onGetStartedClick }: NavbarProps) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const { user, logout, isLoading } = useAuth();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-4 pt-4">
      <div
        className={`container-shifter !max-w-[1400px] transition-all duration-300 ${
          scrolled ? 'shadow-nav' : 'shadow-soft'
        } rounded-2xl border border-line bg-white/90 backdrop-blur-md`}
      >
        <nav className="flex h-[72px] items-center justify-between px-4 md:px-6">
          <SmartLink href="/" className="inline-flex shrink-0 items-center gap-2.5">
            <img
              src="/shifter-online-icon.png"
              alt="Shifter Online"
              className="h-9 w-9 object-contain"
            />
            <span className="text-[19px] font-extrabold tracking-tight text-ink">
              <span className="text-orange">Shifter</span> <span className="text-navy">Online</span>
            </span>
          </SmartLink>

          <ul className="hidden lg:flex items-center gap-1">
            {navLinks.map((link) => (
              <li
                key={link.label}
                className="relative"
                onMouseEnter={() => link.hasDropdown && setServicesOpen(true)}
                onMouseLeave={() => link.hasDropdown && setServicesOpen(false)}
              >
                <SmartLink
                  href={link.href}
                  className="group flex items-center gap-1 rounded-lg px-4 py-2.5 text-[15px] font-medium text-ink/80 hover:text-navy transition-colors"
                >
                  {link.label}
                  {link.hasDropdown && <ChevronDown size={15} className="opacity-60" />}
                  <span className="pointer-events-none absolute inset-x-4 -bottom-0.5 h-[2px] scale-x-0 bg-orange transition-transform duration-200 group-hover:scale-x-100" />
                </SmartLink>
                {link.hasDropdown && (
                  <AnimatePresence>
                    {servicesOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        transition={{ duration: 0.15 }}
                        className="absolute left-0 top-full w-56 rounded-xl border border-line bg-white p-2 shadow-card"
                      >
                        {serviceLinks.map((s) => (
                          <SmartLink
                            key={s.label}
                            href={s.href}
                            className="block rounded-lg px-3 py-2 text-sm font-medium text-ink/80 hover:bg-offwhite hover:text-navy"
                          >
                            {s.label}
                          </SmartLink>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                )}
              </li>
            ))}
          </ul>

          <div className="hidden lg:flex items-center gap-3">
            <a
              href="tel:9109114515"
              className="inline-flex items-center gap-1.5 text-xs font-extrabold text-navy hover:text-orange transition-colors bg-offwhite px-3 py-2 rounded-xl border border-line"
            >
              <Phone size={14} className="text-orange" />
              <span>+91 9109114515</span>
            </a>
            <Button variant="secondary" size="md" to="/estimate" className="!h-11 !px-5">
              <Calculator size={16} />
              Get Estimate
            </Button>
            {!isLoading && user ? (
              <>
                <span className="text-sm font-semibold text-ink/80">Hi, {user.name.split(' ')[0]}</span>
                <Button variant="secondary" size="md" onClick={logout} className="!h-11 !px-4">
                  <LogOut size={16} />
                  Log out
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" size="md" onClick={onLoginClick} className="!h-11 !px-5">
                  Login
                </Button>
                <Button variant="primary" size="md" onClick={onGetStartedClick} className="!h-11 !px-5">
                  Get Started →
                </Button>
              </>
            )}
          </div>

          <button
            aria-label="Toggle navigation menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
            className="grid h-11 w-11 place-items-center rounded-lg text-navy lg:hidden"
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </nav>
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="container-shifter !max-w-[1400px] overflow-hidden lg:hidden"
          >
            <div className="mt-3 rounded-2xl border border-line bg-white p-4 shadow-card">
              <ul className="flex flex-col gap-1">
                {navLinks.map((link) => (
                  <li key={link.label}>
                    <SmartLink
                      href={link.href}
                      onClick={() => setMobileOpen(false)}
                      className="block rounded-lg px-3 py-3 text-[15px] font-medium text-ink/80 hover:bg-offwhite hover:text-navy"
                    >
                      {link.label}
                    </SmartLink>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
                <Button variant="secondary" to="/estimate" onClick={() => setMobileOpen(false)} className="w-full">
                  <Calculator size={16} />
                  Get Estimate
                </Button>
                {!isLoading && user ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      logout();
                      setMobileOpen(false);
                    }}
                    className="w-full"
                  >
                    <LogOut size={16} /> Log out
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setMobileOpen(false);
                        onLoginClick();
                      }}
                      className="w-full"
                    >
                      Login
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => {
                        setMobileOpen(false);
                        onGetStartedClick();
                      }}
                      className="w-full"
                    >
                      Get Started →
                    </Button>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
