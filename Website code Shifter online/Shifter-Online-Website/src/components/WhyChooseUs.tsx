import {
  BadgeCheck,
  CreditCard,
  Eye,
  Headphones,
  Heart,
  Lightbulb,
  Scale,
  ShieldCheck,
  Smartphone,
  UserCheck,
} from 'lucide-react';
import { ScrollReveal } from './ui/ScrollReveal';
import { TrustBadgeIllustration } from './illustrations/TrustBadgeIllustration';

const points = [
  {
    icon: Smartphone,
    title: 'Technology-Driven Platform',
    description: 'A seamless digital experience for booking, tracking and managing shipments.',
  },
  {
    icon: UserCheck,
    title: 'Verified Driver Partners',
    description: 'Every driver partner is vetted for safety, reliability and professionalism.',
  },
  {
    icon: CreditCard,
    title: 'Affordable & Transparent Pricing',
    description: 'No hidden fees — know exactly what you pay before you book.',
  },
  {
    icon: Headphones,
    title: 'Dedicated Customer Support',
    description: 'Reliable, responsive support whenever you need help with a shipment.',
  },
];

const values = [
  { icon: Heart, label: 'Customer First' },
  { icon: Eye, label: 'Trust & Transparency' },
  { icon: Lightbulb, label: 'Innovation' },
  { icon: BadgeCheck, label: 'Reliability' },
  { icon: Scale, label: 'Integrity' },
  { icon: ShieldCheck, label: 'Safety' },
];

export function WhyChooseUs() {
  return (
    <section id="why-us" className="bg-offwhite py-24 md:py-32">
      <div className="container-shifter grid grid-cols-1 gap-14 lg:grid-cols-2 lg:gap-20">
        <ScrollReveal>
          <span className="text-xs font-bold tracking-[0.14em] text-orange">WHY SHIFTER ONLINE</span>
          <h2 className="mt-3 text-3xl font-extrabold leading-tight text-ink sm:text-[42px]">
            Built for Businesses That Can&apos;t Afford Delays
          </h2>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted">
            Shifter Online, by Movigo Logistics Aggregator Pvt. Ltd., combines technology, a
            verified driver partner network, and disciplined operations so every shipment arrives
            exactly as promised.
          </p>

          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
            {points.map(({ icon: Icon, title, description }, i) => (
              <ScrollReveal key={title} delay={i * 0.08}>
                <div className="flex gap-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-orange shadow-soft">
                    <Icon size={20} />
                  </span>
                  <div>
                    <h3 className="text-[15px] font-bold text-ink">{title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>
                  </div>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </ScrollReveal>

        <ScrollReveal delay={0.1} className="relative">
          <div className="relative overflow-hidden rounded-3xl bg-navy p-10 shadow-lift">
            <div className="absolute inset-0 bg-grid-fade opacity-30" />
            <div className="pointer-events-none absolute -right-10 -top-10 h-56 w-56 opacity-90">
              <TrustBadgeIllustration />
            </div>
            <div className="relative">
              <span className="text-xs font-bold tracking-[0.14em] text-orange">OUR CORE VALUES</span>
              <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-orange" />
                <span className="text-xs font-semibold text-white">100% Verified Driver Partners</span>
              </div>
              <p className="mt-3 text-sm text-white/60">
                The principles that guide every booking, every delivery, and every partnership.
              </p>
              <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-7">
                {values.map(({ icon: Icon, label }) => (
                  <div key={label} className="flex items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 text-orange">
                      <Icon size={17} />
                    </span>
                    <span className="text-[15px] font-semibold text-white">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
