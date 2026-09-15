import { Bell, Calendar, CreditCard, Home, Package, TrendingUp, User } from 'lucide-react';
import { motion } from 'framer-motion';

export function AppMockup() {
  return (
    <div className="relative mx-auto w-full max-w-[300px]">
      <div className="absolute -left-6 -top-6 h-40 w-40 rounded-full bg-orange/10 blur-2xl sm:-left-10 sm:-top-10 sm:h-56 sm:w-56" />
      <div className="absolute -bottom-8 -right-6 h-40 w-40 rounded-full bg-royal/10 blur-2xl sm:h-56 sm:w-56" />

      <motion.div
        initial={{ opacity: 0, y: -16, x: -16 }}
        whileInView={{ opacity: 1, y: 0, x: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.7, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="absolute -left-6 top-6 z-10 hidden w-44 rounded-2xl bg-white p-4 shadow-lift sm:-left-28 sm:block"
      >
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-royal/10 text-royal">
            <TrendingUp size={15} />
          </span>
          <span className="text-xs font-semibold text-ink/70">Driver Earnings</span>
        </div>
        <p className="mt-2 text-xl font-extrabold text-navy">₹12,400</p>
        <p className="text-[11px] font-medium text-muted">This week · +18%</p>
        <div className="mt-3 flex items-end gap-1">
          {[40, 65, 50, 80, 60, 95, 70].map((h, i) => (
            <span
              key={i}
              className={`flex-1 rounded-sm ${i === 5 ? 'bg-orange' : 'bg-royal/15'}`}
              style={{ height: `${h * 0.28}px` }}
            />
          ))}
        </div>
      </motion.div>

      <div className="relative rounded-[2.5rem] border-[10px] border-navy bg-navy p-1.5 shadow-lift">
        <div className="absolute left-1/2 top-2 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-navy" />
        <div className="relative overflow-hidden rounded-[1.9rem] bg-white">
          <div className="flex items-center justify-between px-5 pb-4 pt-8">
            <div>
              <p className="text-xs text-muted">Welcome back</p>
              <p className="text-sm font-bold text-ink">Aarav Sharma</p>
            </div>
            <span className="grid h-9 w-9 place-items-center rounded-full bg-offwhite text-navy">
              <Bell size={16} />
            </span>
          </div>

          <div className="mx-4 rounded-2xl bg-gradient-to-br from-orange to-orange-light p-4 text-white shadow-soft">
            <p className="text-xs font-medium text-white/80">New Booking</p>
            <p className="mt-1 text-sm font-bold">Book a delivery in seconds</p>
          </div>

          <div className="grid grid-cols-2 gap-3 px-4 pt-4">
            <div className="rounded-xl border border-line p-3">
              <Calendar size={16} className="text-royal" />
              <p className="mt-2 text-xs font-semibold text-ink">Schedule Pickup</p>
            </div>
            <div className="rounded-xl border border-line p-3">
              <Package size={16} className="text-royal" />
              <p className="mt-2 text-xs font-semibold text-ink">My Deliveries</p>
            </div>
          </div>

          <div className="mx-4 mt-4 mb-6 rounded-xl bg-offwhite p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-ink">#SH-284917</p>
              <span className="rounded-full bg-orange/15 px-2 py-0.5 text-[10px] font-bold text-orange">
                On the way
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line">
              <div className="h-full w-3/4 rounded-full bg-navy" />
            </div>
          </div>

          <div className="flex items-center justify-around border-t border-line px-4 py-3">
            <Home size={18} className="text-navy" />
            <Package size={18} className="text-muted" />
            <CreditCard size={18} className="text-muted" />
            <User size={18} className="text-muted" />
          </div>
        </div>
      </div>
    </div>
  );
}
