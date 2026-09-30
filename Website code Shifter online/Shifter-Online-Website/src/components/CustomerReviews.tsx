import { Star, Building2, User, Truck } from 'lucide-react';
import { ScrollReveal } from './ui/ScrollReveal';

const REVIEWS = [
  {
    name: 'Rajesh Khandelwal',
    role: 'Wholesale Textile Merchant',
    location: 'Sitlamata Bazar, Indore',
    rating: 5,
    icon: Building2,
    comment:
      'We use Shifter Online Tata Ace daily for sending textile rolls from warehouse to shops. The drivers arrive within 15 minutes, handle goods carefully, and the app gives exact live location. Highly recommended for commercial transport!',
  },
  {
    name: 'Priyanka Sharma',
    role: 'Home Shifting Customer',
    location: 'Vijay Nagar, Indore',
    rating: 5,
    icon: User,
    comment:
      'Shifted our complete 2 BHK apartment using Shifter Online Pickup 8ft. The fare was completely transparent with zero hidden charges. Both the driver and helper were polite and punctual.',
  },
  {
    name: 'Sunil Parmar',
    role: 'Driver Partner (Tata Ace)',
    location: 'Dewas Naka, Indore',
    rating: 5,
    icon: Truck,
    comment:
      'I attached my Chhota Hathi with Shifter Online 4 months ago. Regular daily bookings, no commission deduction for the first month, and payouts reach my bank account every evening without any delay.',
  },
];

export function CustomerReviews() {
  return (
    <section className="py-24 md:py-32 bg-offwhite/60">
      <div className="container-shifter">
        <ScrollReveal className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-bold tracking-[0.14em] text-orange uppercase">TRUSTED BY THOUSANDS</span>
          <h2 className="mt-3 text-3xl font-extrabold leading-tight text-ink sm:text-[42px]">
            What People Say About Shifter
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-muted">
            From local merchants and e-commerce stores to families shifting homes — see why people choose Shifter Online.
          </p>
        </ScrollReveal>

        <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {REVIEWS.map((review, i) => {
            const Icon = review.icon;
            return (
              <ScrollReveal key={review.name} delay={i * 0.08}>
                <div className="flex h-full flex-col justify-between rounded-3xl border border-line bg-white p-7 shadow-soft transition-all hover:-translate-y-1 hover:shadow-card">
                  <div>
                    {/* Star ratings */}
                    <div className="flex items-center gap-1 text-amber-500">
                      {[...Array(review.rating)].map((_, idx) => (
                        <Star key={idx} size={16} fill="currentColor" />
                      ))}
                    </div>

                    <p className="mt-4 text-[14px] leading-relaxed text-ink/80">
                      &ldquo;{review.comment}&rdquo;
                    </p>
                  </div>

                  <div className="mt-6 flex items-center gap-3 border-t border-line/80 pt-4">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-orange/15 text-orange">
                      <Icon size={18} />
                    </span>
                    <div>
                      <h4 className="text-sm font-bold text-ink">{review.name}</h4>
                      <p className="text-xs text-muted">{review.role} · {review.location}</p>
                    </div>
                  </div>
                </div>
              </ScrollReveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
