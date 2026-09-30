import { motion } from 'framer-motion';
import { Smartphone, ShieldCheck, Zap } from 'lucide-react';
import { Button } from '../ui/Button';
import { HeroIllustration } from '../illustrations/HeroIllustration';
import { FloatingStatsCard } from './FloatingStatsCard';

export function Hero() {
  return (
    <section id="home" className="relative overflow-hidden pt-36 pb-20 md:pt-44 md:pb-28">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[#EEF3FC] via-white to-white" />
      <div className="absolute inset-0 -z-10 bg-grid-fade" />

      <div className="container-shifter grid grid-cols-1 items-center gap-14 lg:grid-cols-2 lg:gap-10">
        {/* Left Column: Headline & Value Proposition */}
        <div>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-xs font-semibold tracking-wide text-navy shadow-soft"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-orange animate-pulse" />
            SMART LOGISTICS <span className="text-line">·</span> DELIVERED WITH CARE
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            className="text-balance text-[38px] font-extrabold leading-[1.08] text-ink sm:text-[50px] lg:text-[60px]"
          >
            Moving Your World
            <br />
            <span className="text-orange">Forward</span>, Together.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="mt-5 max-w-lg text-base sm:text-lg text-muted leading-relaxed"
          >
            India&apos;s technology-driven logistics platform connecting you with verified driver
            partners for fast, affordable and transparent goods transportation through our mobile apps.
          </motion.p>

          {/* Quick Trust Badges */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="mt-6 flex flex-wrap items-center gap-4 text-xs font-semibold text-navy"
          >
            <div className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 border border-line shadow-xs">
              <Zap size={14} className="text-orange" />
              <span>15 Min Pickup Dispatch</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 border border-line shadow-xs">
              <ShieldCheck size={14} className="text-emerald-600" />
              <span>100% Verified Drivers</span>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center"
          >
            <Button href="#app" size="lg" variant="primary">
              <Smartphone size={18} />
              Download Customer App
            </Button>
            <Button href="#services" size="lg" variant="secondary">
              Explore Fleet &amp; Services →
            </Button>
          </motion.div>
        </div>

        {/* Right Column: Hero Illustration & Stats */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="relative mx-auto w-full max-w-[560px]"
        >
          <HeroIllustration />
          <FloatingStatsCard />
        </motion.div>
      </div>
    </section>
  );
}
