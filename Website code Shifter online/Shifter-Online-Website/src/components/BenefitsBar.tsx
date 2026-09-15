import { IndianRupee, MapPin, ShieldCheck, Zap } from 'lucide-react';
import { ScrollReveal } from './ui/ScrollReveal';

const benefits = [
  {
    icon: Zap,
    title: 'Instant Booking',
    description: 'Book a vehicle for your goods in seconds, anytime you need it',
  },
  {
    icon: ShieldCheck,
    title: 'Verified Driver Partners',
    description: 'Every driver partner is vetted for safety and reliability',
  },
  {
    icon: MapPin,
    title: 'Live Trip Tracking',
    description: 'Follow your shipment in real time, from pickup to drop',
  },
  {
    icon: IndianRupee,
    title: 'Transparent Pricing',
    description: 'No hidden charges — know your fare before you book',
  },
];

export function BenefitsBar() {
  return (
    <section className="relative z-10 -mt-10 px-4">
      <ScrollReveal className="container-shifter">
        <div className="rounded-3xl bg-navy px-6 py-10 shadow-lift sm:px-10 md:py-12">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
            {benefits.map(({ icon: Icon, title, description }, i) => (
              <div
                key={title}
                className={`flex items-start gap-4 lg:flex-col lg:items-start lg:gap-3 ${
                  i !== 0 ? 'lg:border-l lg:border-white/10 lg:pl-6' : ''
                }`}
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-orange">
                  <Icon size={22} strokeWidth={2} />
                </span>
                <span>
                  <span className="block text-[17px] font-bold text-white">{title}</span>
                  <span className="mt-1 block text-sm text-white/65">{description}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </ScrollReveal>
    </section>
  );
}
