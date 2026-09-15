import { motion } from 'framer-motion';
import { Smartphone } from 'lucide-react';
import { Button } from '../ui/Button';
import { FloatingStatsCard } from './FloatingStatsCard';
import { HeroIllustration } from '../illustrations/HeroIllustration';

export function Hero() {
  return (
    <section id="home" className="relative overflow-hidden pt-40 pb-24 md:pt-48 md:pb-32">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[#EEF3FC] via-white to-white" />
      <div className="absolute inset-0 -z-10 bg-grid-fade" />

      <div className="container-shifter grid grid-cols-1 items-center gap-16 lg:grid-cols-2 lg:gap-10">
        <div>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-xs font-semibold tracking-wide text-navy shadow-soft"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-orange" />
            SMART LOGISTICS <span className="text-line">·</span> DELIVERED WITH CARE
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            className="text-balance text-[42px] font-extrabold leading-[1.05] text-ink sm:text-[56px] lg:text-[68px]"
          >
            Moving Your World
            <br />
            <span className="text-orange">Forward</span>, Together.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="mt-6 max-w-lg text-lg text-muted"
          >
            India&apos;s technology-driven logistics platform connecting you with verified driver
            partners for fast, affordable and transparent goods transportation.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center"
          >
            <Button href="#app" size="lg" variant="primary">
              <Smartphone size={18} />
              Download Our App
            </Button>
            <Button href="#services" size="lg" variant="secondary">
              Learn More →
            </Button>
          </motion.div>
        </div>

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
