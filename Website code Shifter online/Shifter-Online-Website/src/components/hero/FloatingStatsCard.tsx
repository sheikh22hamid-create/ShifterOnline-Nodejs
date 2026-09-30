import { motion } from 'framer-motion';
import { Package, ShieldCheck, Users } from 'lucide-react';

const stats = [
  { icon: Package, value: '500+', label: 'Deliveries Daily' },
  { icon: Users, value: '100+', label: 'Happy Customers' },
  { icon: ShieldCheck, value: '99%', label: 'On-Time Delivery' },
];

export function FloatingStatsCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, x: 16 }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      transition={{ duration: 0.7, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="absolute -bottom-4 right-1 w-[200px] rounded-2xl bg-navy/95 p-3.5 shadow-lift backdrop-blur-md border border-white/10 sm:-bottom-8 sm:-right-8 sm:w-64 sm:p-5"
    >
      <ul className="flex flex-col gap-2.5 sm:gap-4">
        {stats.map(({ icon: Icon, value, label }, i) => (
          <li key={label} className={`flex items-center gap-2.5 sm:gap-3 ${i !== 0 ? 'border-t border-white/10 pt-2.5 sm:pt-4' : ''}`}>
            <span className="grid h-8 w-8 sm:h-10 sm:w-10 shrink-0 place-items-center rounded-full bg-orange/20 text-orange">
              <Icon size={16} className="sm:w-[18px] sm:h-[18px]" />
            </span>
            <span>
              <span className="block text-base sm:text-lg font-extrabold leading-tight text-white">{value}</span>
              <span className="block text-[11px] sm:text-xs font-medium text-white/60">{label}</span>
            </span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
