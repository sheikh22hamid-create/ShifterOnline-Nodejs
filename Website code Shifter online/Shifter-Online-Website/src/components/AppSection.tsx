import { Truck, Users } from 'lucide-react';
import { ScrollReveal } from './ui/ScrollReveal';
import { AppMockup } from './illustrations/AppMockup';

export function AppSection() {
  return (
    <section id="app" className="overflow-hidden bg-offwhite py-24 md:py-32">
      <div className="container-shifter grid grid-cols-1 items-center gap-16 lg:grid-cols-2 lg:gap-20">
        <ScrollReveal className="order-2 lg:order-1">
          <AppMockup />
        </ScrollReveal>

        <ScrollReveal delay={0.1} className="order-1 lg:order-2">
          <span className="text-xs font-bold tracking-[0.14em] text-orange">MOBILE APP</span>
          <h2 className="mt-3 text-3xl font-extrabold leading-tight text-ink sm:text-[42px]">
            Logistics at Your Fingertips.
          </h2>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted">
            One app, two sides of the journey — customers book and track shipments, while driver
            partners find consistent earning opportunities.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink">
              <Users size={15} className="text-orange" />
              For Customers
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink">
              <Truck size={15} className="text-orange" />
              For Driver Partners
            </span>
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a
              href="https://play.google.com/store/apps/details?id=com.shifter.online"
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-14 items-center gap-3 rounded-xl bg-navy px-5 text-white shadow-soft transition-all hover:-translate-y-0.5 hover:bg-royal"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.6,9.48l1.84-3.18c0.16-0.31,0.04-0.69-0.26-0.85c-0.29-0.15-0.65-0.06-0.83,0.22l-1.88,3.24 c-2.86-1.21-6.08-1.21-8.94,0L5.65,5.67c-0.19-0.29-0.58-0.38-0.87-0.2C4.5,5.65,4.41,6.01,4.56,6.3L6.4,9.48 C3.3,11.25,1.28,14.44,1,18h22C22.72,14.44,20.7,11.25,17.6,9.48z M7,15.25c-0.69,0-1.25-0.56-1.25-1.25 c0-0.69,0.56-1.25,1.25-1.25S8.25,13.31,8.25,14C8.25,14.69,7.69,15.25,7,15.25z M17,15.25c-0.69,0-1.25-0.56-1.25-1.25 c0-0.69,0.56-1.25,1.25-1.25s1.25,0.56,1.25,1.25C18.25,14.69,17.69,15.25,17,15.25z" />
              </svg>
              <span className="text-left leading-tight">
                <span className="block text-[10px] text-white/70">CUSTOMER APP</span>
                <span className="block text-sm font-bold">Google Play</span>
              </span>
            </a>
            <a
              href="https://play.google.com/store/apps/details?id=com.shifter.driver"
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-14 items-center gap-3 rounded-xl bg-orange px-5 text-white shadow-soft transition-all hover:-translate-y-0.5 hover:bg-orange/90"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.6,9.48l1.84-3.18c0.16-0.31,0.04-0.69-0.26-0.85c-0.29-0.15-0.65-0.06-0.83,0.22l-1.88,3.24 c-2.86-1.21-6.08-1.21-8.94,0L5.65,5.67c-0.19-0.29-0.58-0.38-0.87-0.2C4.5,5.65,4.41,6.01,4.56,6.3L6.4,9.48 C3.3,11.25,1.28,14.44,1,18h22C22.72,14.44,20.7,11.25,17.6,9.48z M7,15.25c-0.69,0-1.25-0.56-1.25-1.25 c0-0.69,0.56-1.25,1.25-1.25S8.25,13.31,8.25,14C8.25,14.69,7.69,15.25,7,15.25z M17,15.25c-0.69,0-1.25-0.56-1.25-1.25 c0-0.69,0.56-1.25,1.25-1.25s1.25,0.56,1.25,1.25C18.25,14.69,17.69,15.25,17,15.25z" />
              </svg>
              <span className="text-left leading-tight">
                <span className="block text-[10px] text-white/90">DRIVER APP</span>
                <span className="block text-sm font-bold">Google Play</span>
              </span>
            </a>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
