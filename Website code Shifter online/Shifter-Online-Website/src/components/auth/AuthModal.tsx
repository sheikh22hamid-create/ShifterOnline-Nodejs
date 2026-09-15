import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Lock, Mail, User, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../lib/api';
import { Logo } from '../ui/Logo';

export type AuthMode = 'login' | 'signup';

interface AuthModalProps {
  mode: AuthMode | null;
  onClose: () => void;
  onSwitchMode: (mode: AuthMode) => void;
}

export function AuthModal({ mode, onClose, onSwitchMode }: AuthModalProps) {
  const { login, signup } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
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
    setSubmitting(true);
    try {
      if (mode === 'signup') {
        await signup(name, email, password);
      } else {
        await login(email, password);
      }
      onClose();
      setName('');
      setEmail('');
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
            {mode === 'login' ? 'Log in to manage your shipments.' : 'Get started with Shifter Online in seconds.'}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            {mode === 'signup' && (
              <label className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 focus-within:border-royal">
                <User size={17} className="text-muted" />
                <input
                  required
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  className="w-full bg-transparent text-[15px] text-ink placeholder:text-muted focus:outline-none"
                />
              </label>
            )}
            <label className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 focus-within:border-royal">
              <Mail size={17} className="text-muted" />
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                className="w-full bg-transparent text-[15px] text-ink placeholder:text-muted focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 focus-within:border-royal">
              <Lock size={17} className="text-muted" />
              <input
                required
                minLength={8}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (min. 8 characters)"
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
