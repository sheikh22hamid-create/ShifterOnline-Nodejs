import { motion } from 'framer-motion';

export function TrustBadgeIllustration() {
  return (
    <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-full w-full" aria-hidden="true">
      <defs>
        <linearGradient id="shieldGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF7A3D" />
          <stop offset="100%" stopColor="#FF5A1F" />
        </linearGradient>
      </defs>

      {/* orbit ring */}
      <circle cx="100" cy="100" r="92" stroke="#FFFFFF" strokeOpacity="0.08" strokeWidth="1.5" strokeDasharray="3 8" />
      <circle cx="100" cy="100" r="70" stroke="#FFFFFF" strokeOpacity="0.1" strokeWidth="1.5" />

      {/* orbiting dot */}
      <motion.g
        animate={{ rotate: 360 }}
        transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}
        style={{ transformOrigin: '100px 100px' }}
      >
        <circle cx="100" cy="30" r="4" fill="#FF5A1F" />
      </motion.g>
      <motion.g
        animate={{ rotate: -360 }}
        transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
        style={{ transformOrigin: '100px 100px' }}
      >
        <circle cx="100" cy="8" r="3" fill="#FFFFFF" opacity="0.5" />
      </motion.g>

      {/* shield */}
      <path
        d="M100 40 L142 56 V96 C142 126 124 148 100 158 C76 148 58 126 58 96 V56 Z"
        fill="url(#shieldGrad)"
      />
      <path
        d="M100 48 L134 61 V96 C134 121 119 139 100 148 C81 139 66 121 66 96 V61 Z"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <path
        d="M84 99 L95 110 L118 85"
        stroke="#FFFFFF"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
