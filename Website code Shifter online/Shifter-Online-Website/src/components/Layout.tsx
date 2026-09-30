import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Navbar } from './Navbar';
import { Footer } from './Footer';
import { AuthModal, type AuthMode } from './auth/AuthModal';
import { MobileQuickBar } from './ui/MobileQuickBar';

export interface LayoutContext {
  openLogin: () => void;
  openSignup: () => void;
}

export function Layout() {
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);

  const context: LayoutContext = {
    openLogin: () => setAuthMode('login'),
    openSignup: () => setAuthMode('signup'),
  };

  return (
    <div className="overflow-x-hidden pb-16 sm:pb-0">
      <Navbar onLoginClick={context.openLogin} onGetStartedClick={context.openSignup} />
      <Outlet context={context} />
      <Footer />

      {/* Floating 1-tap mobile action bar for Call, WhatsApp and Booking */}
      <MobileQuickBar />

      <AuthModal mode={authMode} onClose={() => setAuthMode(null)} onSwitchMode={setAuthMode} />
    </div>
  );
}
