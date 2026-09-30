import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Lock, Mail, Phone, User, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../lib/api';
import { Logo } from '../ui/Logo';

export type AuthMode = 'login' | 'signup';

interface AuthModalProps {
  mode: AuthMode | null;
  onClose: () => void;
  onSwitchMode: (mode: AuthMode) => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanMobile(input: string) {
  let cleaned = input.trim().replace(/[\s\-().]/g, '');
  if (cleaned.startsWith('+91')) {
    cleaned = cleaned.slice(3);
  } else if (cleaned.startsWith('91') && cleaned.length === 12) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = cleaned.slice(1);
  }
  return cleaned;
}

function isValidMobile(mobile: string) {
  const cleaned = cleanMobile(mobile);
  return /^[6-9]\d{9}$/.test(cleaned);
}

export function AuthModal({ mode, onClose, onSwitchMode }: AuthModalProps) {
  const { login, signup } = useAuth();
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setError(null);
    setSubmitting(false);
  }, [mode]);

  useEffect(() => {
    if (!mode) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mode]);

  if (!mode) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    // Client-side validations
    if (mode === 'signup') {
      if (!name.trim()) {
        setError('Please enter your full name.');
        return;
      }
      if (!mobile.trim()) {
        setError('Mobile number is required.');
        return;
      }
      if (!isValidMobile(mobile)) {
        setError('Please enter a valid 10-digit mobile number (e.g. 9876543210).');
        return;
      }
      if (email.trim() && !EMAIL_RE.test(email.trim())) {
        setError('Please enter a valid email address.');
        return;
      }
      if (password.length < 8) {
        setError('Password must be at least 8 characters long.');
        return;
      }
    } else {
      if (!loginIdentifier.trim()) {
        setError('Please enter your mobile number or email address.');
        return;
      }
      if (!password) {
        setError('Please enter your password.');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (mode === 'signup') {
        await signup({
          name: name.trim(),
          mobile: cleanMobile(mobile),
          email: email.trim() ? email.trim() : undefined,
          password,
        });
      } else {
        await login(loginIdentifier.trim(), password);
      }
      onClose();
      setName('');
      setMobile('');
      setEmail('');
      setLoginIdentifier('');
      setPassword('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-navy/40 p-4 backdrop-blur-sm"
      >
        <motion.div
          key="panel"
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.97 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-md rounded-2xl bg-white p-8 shadow-lift"
        >
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-offwhite hover:text-ink"
          >
            <X size={18} />
          </button>

          <Logo />

          <h2 className="mt-6 text-2xl font-extrabold text-ink">
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </h2>
          <p className="mt-1.5 text-sm text-muted">
            {mode === 'login'
              ? 'Log in using your Mobile Number or Email.'
              : 'Sign up with your mobile number to get started in seconds.'}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            {mode === 'signup' ? (
              <>
                {/* Full Name */}
                <label className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 focus-within:border-royal">
                  <User size={17} className="text-muted shrink-0" />
                  <input
                    required
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Full name *"
                    className="w-full bg-transparent text-[15px] text-ink placeholder:text-muted focus:outline-none"
                  />
                </label>

                {/* Mobile Number (REQUIRED) */}
                <label className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 focus-within:border-royal">
                  <Phone size={17} className="text-muted shrink-0" />
                  <input
                    required
                    type="tel"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    placeholder="Mobile number (10 digits) *"
                    maxLength={14}
                    className="w-full bg-transparent text-[15px] text-ink placeholder:text-muted focus:outline-none"
                  />
                </label>

                {/* Email Address (OPTIONAL) */}
                <label className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 focus-within:border-royal">
                  <Mail size={17} className="text-muted shrink-0" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email address (optional)"
                    className="w-full bg-transparent text-[15px] text-ink placeholder:text-muted focus:outline-none"
                  />
                </label>
              </>
            ) : (
              /* Dual Login Identifier (Mobile OR Email) */
              <label className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 focus-within:border-royal">
                <Phone size={17} className="text-muted shrink-0" />
                <input
                  required
                  type="text"
                  value={loginIdentifier}
                  onChange={(e) => setLoginIdentifier(e.target.value)}
                  placeholder="Mobile number or Email *"
                  autoComplete="username"
                  className="w-full bg-transparent text-[15px] text-ink placeholder:text-muted focus:outline-none"
                />
              </label>
            )}

            {/* Password */}
            <label className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 focus-within:border-royal">
              <Lock size={17} className="text-muted shrink-0" />
              <input
                required
                minLength={8}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (min. 8 characters) *"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                className="w-full bg-transparent text-[15px] text-ink placeholder:text-muted focus:outline-none"
              />
            </label>

            {error && <p className="text-sm font-medium text-orange">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 flex h-[52px] items-center justify-center gap-2 rounded-xl bg-orange py-3.5 text-[15px] font-semibold text-white transition-all hover:bg-orange-light disabled:opacity-60"
            >
              {submitting && <Loader2 size={17} className="animate-spin" />}
              {mode === 'login' ? 'Log In' : 'Create Account'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-muted">
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <button
              onClick={() => onSwitchMode(mode === 'login' ? 'signup' : 'login')}
              className="font-semibold text-royal hover:underline"
            >
              {mode === 'login' ? 'Sign up' : 'Log in'}
            </button>
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
