import { CheckCircle2, Circle, MapPin, Navigation, Package } from 'lucide-react';
import { motion } from 'framer-motion';
import { ScrollReveal } from './ui/ScrollReveal';

const statusSteps = [
  { label: 'Parcel Picked Up', done: true },
  { label: 'In Transit', done: true },
  { label: 'Out for Delivery', done: false, active: true },
  { label: 'Delivered', done: false },
];

export function TrackingPreview() {
  return (
    <section className="py-24 md:py-32">
      <div className="container-shifter grid grid-cols-1 items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <ScrollReveal>
          <span className="text-xs font-bold tracking-[0.14em] text-orange">LIVE VISIBILITY</span>
          <h2 className="mt-3 text-3xl font-extrabold leading-tight text-ink sm:text-[42px]">
            Track Every Shipment in Real Time
          </h2>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted">
            Our dashboard gives you a live view of driver location, route progress and estimated arrival —
            so you always know exactly where your shipment stands.
          </p>
          <ul className="mt-8 flex flex-col gap-4">
            <li className="flex items-center gap-3 text-sm text-ink/80">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-royal/10 text-royal">
                <Navigation size={15} />
              </span>
              Live driver location updated every few seconds
            </li>
            <li className="flex items-center gap-3 text-sm text-ink/80">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-royal/10 text-royal">
                <Package size={15} />
              </span>
              Full shipment and package details at a glance
            </li>
            <li className="flex items-center gap-3 text-sm text-ink/80">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-royal/10 text-royal">
                <MapPin size={15} />
              </span>
              Accurate ETA based on live traffic and route data
            </li>
          </ul>
        </ScrollReveal>

        <ScrollReveal delay={0.1}>
          <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-lift">
            <div className="flex items-center gap-1.5 border-b border-line bg-offwhite px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
              <span className="ml-3 text-xs font-medium text-muted">Shifter Online — Live Tracking</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[1.3fr_1fr]">
              <div className="relative h-64 overflow-hidden bg-[#EAF1FF] sm:h-auto">
                <svg viewBox="0 0 400 340" className="absolute inset-0 h-full w-full">
                  <defs>
                    <pattern id="mapGrid" width="34" height="34" patternUnits="userSpaceOnUse">
                      <path d="M34 0H0V34" fill="none" stroke="#123F8C" strokeOpacity="0.08" />
                    </pattern>
                  </defs>
                  <rect width="400" height="340" fill="url(#mapGrid)" />

                  {/* city blocks for map texture */}
                  <g opacity="0.5">
                    <rect x="230" y="220" width="30" height="24" rx="2" fill="#123F8C" opacity="0.1" />
                    <rect x="270" y="240" width="24" height="20" rx="2" fill="#123F8C" opacity="0.08" />
                    <rect x="60" y="90" width="26" height="22" rx="2" fill="#123F8C" opacity="0.09" />
                    <rect x="120" y="60" width="20" height="18" rx="2" fill="#123F8C" opacity="0.08" />
                  </g>

                  <path
                    d="M40 260 C 100 180, 140 220, 190 150 S 300 90, 350 60"
                    stroke="#FF5A1F"
                    strokeWidth="4"
                    strokeDasharray="10 8"
                    strokeLinecap="round"
                    fill="none"
                  />
                  <circle cx="40" cy="260" r="7" fill="#123F8C" />
                  <circle cx="350" cy="60" r="8" fill="#FF5A1F" />
                  <motion.circle
                    cx="350"
                    cy="60"
                    r="8"
                    fill="#FF5A1F"
                    opacity="0.3"
                    animate={{ scale: [1, 2.2, 1], opacity: [0.3, 0, 0.3] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                    style={{ transformOrigin: '350px 60px' }}
                  />
                  <g transform="translate(190 150)">
                    <circle r="16" fill="#0B2A68" opacity="0.15" />
                    <circle r="8" fill="#0B2A68" />
                  </g>

                  {/* live-moving vehicle dot along the route */}
                  <motion.circle
                    r="6"
                    fill="#FFFFFF"
                    stroke="#123F8C"
                    strokeWidth="3"
                    style={{
                      offsetPath: 'path("M40 260 C 100 180, 140 220, 190 150 S 300 90, 350 60")',
                    }}
                    animate={{ offsetDistance: ['0%', '100%'] }}
                    transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
                  />
                </svg>
                <div className="absolute left-3 top-3 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-ink shadow-soft">
                  ETA: 18 minutes
                </div>
              </div>

              <div className="flex flex-col gap-5 p-6">
                <div>
                  <span className="text-xs font-medium text-muted">Shipment</span>
                  <p className="text-sm font-bold text-ink">#SH-284917 · Indore → Bhopal</p>
                </div>
                <ul className="flex flex-col gap-3">
                  {statusSteps.map((step) => (
                    <li key={step.label} className="flex items-center gap-2.5 text-sm">
                      {step.done ? (
                        <CheckCircle2 size={17} className="text-orange" />
                      ) : (
                        <Circle
                          size={17}
                          className={step.active ? 'text-royal' : 'text-line'}
                          fill={step.active ? '#123F8C' : 'transparent'}
                        />
                      )}
                      <span className={step.done || step.active ? 'font-semibold text-ink' : 'text-muted'}>
                        {step.label}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto rounded-xl bg-offwhite p-4">
                  <span className="text-xs font-medium text-muted">Package</span>
                  <p className="text-sm font-semibold text-ink">2.4 kg · Documents & Parcel</p>
                </div>
              </div>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
