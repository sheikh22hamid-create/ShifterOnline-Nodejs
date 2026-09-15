import {
  Bike,
  Building2,
  CarTaxiFront,
  Handshake,
  Headphones,
  Home,
  MapPin,
  Package,
  Truck,
  TruckElectric,
} from 'lucide-react';
import { ScrollReveal } from '../ui/ScrollReveal';
import { ServiceCard } from './ServiceCard';
import { VehicleLineupIllustration } from '../illustrations/VehicleLineupIllustration';

const services = [
  {
    icon: Bike,
    title: 'Bike Goods Delivery',
    description: 'Quick delivery for small parcels and urgent goods across the city.',
    accent: 'orange' as const,
  },
  {
    icon: CarTaxiFront,
    title: 'Three-Wheeler Transport',
    description: 'Affordable three-wheeler booking for mid-sized loads and local moves.',
    accent: 'navy' as const,
  },
  {
    icon: Truck,
    title: 'Tata Ace & Mini Truck',
    description: 'Book a Tata Ace or mini truck for larger commercial shipments.',
    accent: 'orange' as const,
  },
  {
    icon: TruckElectric,
    title: 'Pickup Vehicle Booking',
    description: 'On-demand pickup vehicles for bulkier household and business loads.',
    accent: 'navy' as const,
  },
  {
    icon: Home,
    title: 'Household Goods Transport',
    description: 'Careful, secure transport for home shifting and personal belongings.',
    accent: 'orange' as const,
  },
  {
    icon: Building2,
    title: 'Business & Commercial Logistics',
    description: 'End-to-end logistics support for retailers, wholesalers and enterprises.',
    accent: 'navy' as const,
  },
];

const metrics = [
  { icon: Package, value: '5+', label: 'Vehicle Types to Choose From' },
  { icon: Handshake, value: '100%', label: 'Verified Driver Partners' },
  { icon: MapPin, value: 'Pan-India', label: 'Growing Network' },
  { icon: Headphones, value: '24/7', label: 'On-Demand Booking' },
];

const industries = [
  'Individuals & Households',
  'Retail Businesses',
  'Wholesale Markets',
  'Manufacturers',
  'Traders & Distributors',
  'E-commerce Sellers',
  'SMEs',
  'Corporate Businesses',
];

export function Services() {
  return (
    <section id="services" className="py-24 md:py-32">
      <div className="container-shifter">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,380px)_1fr] lg:gap-16">
          <ScrollReveal>
            <span className="text-xs font-bold tracking-[0.14em] text-orange">WHAT WE OFFER</span>
            <h2 className="mt-3 text-3xl font-extrabold leading-tight text-ink sm:text-[42px]">
              Comprehensive Logistics Solutions
            </h2>
            <div className="mt-4 h-1 w-14 rounded-full bg-orange" />
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted">
              From a two-wheeler for a single parcel to a mini truck for a full commercial load —
              choose the right vehicle for every shipment.
            </p>
            <a href="#services" className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-royal">
              View All Services →
            </a>

            <div className="mt-10 hidden rounded-2xl border border-line bg-white p-6 shadow-soft lg:block">
              <VehicleLineupIllustration />
              <p className="mt-3 text-center text-xs font-semibold tracking-wide text-muted">
                BIKE · THREE-WHEELER · MINI TRUCK
              </p>
            </div>
          </ScrollReveal>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {services.map((service, i) => (
              <ScrollReveal key={service.title} delay={i * 0.06}>
                <ServiceCard {...service} />
              </ScrollReveal>
            ))}
          </div>
        </div>

        <ScrollReveal delay={0.1} className="mt-20 rounded-2xl border border-line bg-offwhite px-6 py-10 sm:px-10">
          <div className="grid grid-cols-2 gap-8 lg:grid-cols-4">
            {metrics.map(({ icon: Icon, value, label }) => (
              <div key={label} className="flex items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-orange shadow-soft">
                  <Icon size={20} />
                </span>
                <span>
                  <span className="block text-xl font-extrabold text-navy sm:text-2xl">{value}</span>
                  <span className="block text-xs font-medium text-muted sm:text-sm">{label}</span>
                </span>
              </div>
            ))}
          </div>
        </ScrollReveal>

        <ScrollReveal delay={0.15} className="mt-10 text-center">
          <span className="text-xs font-bold tracking-[0.14em] text-orange">INDUSTRIES WE SERVE</span>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
            {industries.map((industry) => (
              <span
                key={industry}
                className="rounded-full border border-line bg-white px-4 py-2 text-sm font-medium text-ink/75"
              >
                {industry}
              </span>
            ))}
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
