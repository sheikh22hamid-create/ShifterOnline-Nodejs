import type { LucideIcon } from 'lucide-react';
import { ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

interface ServiceCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  accent: 'orange' | 'navy';
}

export function ServiceCard({ icon: Icon, title, description, accent }: ServiceCardProps) {
  return (
    <motion.div
      whileHover={{ y: -6 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-soft transition-shadow duration-300 hover:shadow-card"
    >
      <div className="relative flex h-36 items-center justify-center overflow-hidden bg-offwhite">
        <div
          className={`absolute h-24 w-24 rounded-full blur-2xl transition-transform duration-300 group-hover:scale-110 ${
            accent === 'orange' ? 'bg-orange/20' : 'bg-royal/15'
          }`}
        />
        <span
          className={`relative grid h-16 w-16 place-items-center rounded-2xl transition-transform duration-300 group-hover:scale-105 ${
            accent === 'orange' ? 'bg-orange text-white' : 'bg-navy text-white'
          }`}
        >
          <Icon size={28} strokeWidth={1.75} />
        </span>
      </div>

      <div className="flex flex-1 flex-col p-6">
        <h3 className="text-lg font-bold text-ink">{title}</h3>
        <p className="mt-2 flex-1 text-[15px] leading-relaxed text-muted">{description}</p>
        <a
          href="#services"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-orange"
        >
          Learn More
          <ArrowRight size={15} className="transition-transform duration-200 group-hover:translate-x-1" />
        </a>
      </div>
    </motion.div>
  );
}
