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
      className="absolute -bottom-6 -right-4 w-[240px] rounded-2xl bg-navy p-5 shadow-lift sm:-bottom-8 sm:-right-8 sm:w-64"
    >
      <ul className="flex flex-col gap-4">
        {stats.map(({ icon: Icon, value, label }, i) => (
          <li key={label} className={`flex items-center gap-3 ${i !== 0 ? 'border-t border-white/10 pt-4' : ''}`}>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-orange/20 text-orange">
              <Icon size={18} />
            </span>
            <span>
              <span className="block text-lg font-extrabold leading-tight text-white">{value}</span>
              <span className="block text-xs font-medium text-white/60">{label}</span>
            </span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
