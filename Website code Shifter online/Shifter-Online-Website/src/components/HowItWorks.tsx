import { CheckCircle2, MapPinned, Package, Truck, UserCheck } from 'lucide-react';
import { motion } from 'framer-motion';
import { ScrollReveal } from './ui/ScrollReveal';

const steps = [
  { number: '01', icon: Package, title: 'Book Delivery', description: 'Schedule a pickup in seconds from web or app.' },
  { number: '02', icon: UserCheck, title: 'Assign Driver Partner', description: 'A verified driver partner is matched to your shipment.' },
  { number: '03', icon: MapPinned, title: 'Track Shipment', description: 'Follow your package live, every step of the way.' },
  { number: '04', icon: CheckCircle2, title: 'Delivered Safely', description: 'Signed, confirmed, and closed out with proof of delivery.' },
];

export function HowItWorks() {
  return (
    <section className="py-24 md:py-32">
      <div className="container-shifter">
        <ScrollReveal className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-bold tracking-[0.14em] text-orange">HOW IT WORKS</span>
          <h2 className="mt-3 text-3xl font-extrabold leading-tight text-ink sm:text-[42px]">
            Four Simple Steps to Delivery
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-muted">
            A streamlined process built to remove friction from every shipment, big or small.
          </p>
        </ScrollReveal>

        <div className="relative mt-16 grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
          <div className="pointer-events-none absolute left-0 right-0 top-8 hidden h-px bg-gradient-to-r from-transparent via-line to-transparent lg:block" />
          <motion.div
            className="pointer-events-none absolute top-8 hidden -translate-y-1/2 lg:block"
            animate={{ left: ['4%', '92%'] }}
            transition={{ duration: 3.2, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' }}
          >
            <span className="relative grid h-6 w-6 -translate-x-1/2 place-items-center rounded-full bg-orange shadow-[0_0_0_5px_rgba(255,90,31,0.15)]">
              <Truck size={12} className="text-white" />
            </span>
          </motion.div>
          {steps.map((step, i) => (
            <ScrollReveal key={step.number} delay={i * 0.1}>
              <div className="relative flex flex-col items-start">
                <div className="relative z-10 grid h-16 w-16 place-items-center rounded-2xl bg-navy text-white shadow-card">
                  <step.icon size={26} strokeWidth={1.75} />
                  <span className="absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full bg-orange text-[11px] font-extrabold text-white">
                    {step.number}
                  </span>
                </div>
                <h3 className="mt-5 text-lg font-bold text-ink">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{step.description}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
