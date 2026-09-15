import { motion } from 'framer-motion';

export function HeroIllustration() {
  return (
    <svg
      viewBox="0 0 640 520"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-auto"
      role="img"
      aria-label="Delivery truck moving through a city on a logistics route"
    >
      <defs>
        <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#EAF1FF" />
          <stop offset="100%" stopColor="#F7F9FC" />
        </linearGradient>
        <linearGradient id="truckBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF7A3D" />
          <stop offset="100%" stopColor="#FF5A1F" />
        </linearGradient>
        <linearGradient id="roadGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#123F8C" />
          <stop offset="100%" stopColor="#0B2A68" />
        </linearGradient>
        <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FF7A3D" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#FF7A3D" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="cloudGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.4" />
        </linearGradient>
      </defs>

      <rect width="640" height="520" rx="28" fill="url(#skyGrad)" />

      {/* Soft sun glow */}
      <circle cx="500" cy="110" r="90" fill="url(#sunGlow)" />

      {/* Clouds */}
      <g opacity="0.8">
        <ellipse cx="110" cy="80" rx="34" ry="13" fill="url(#cloudGrad)" />
        <ellipse cx="138" cy="74" rx="22" ry="10" fill="url(#cloudGrad)" />
        <ellipse cx="340" cy="52" rx="26" ry="10" fill="url(#cloudGrad)" />
      </g>

      {/* Skyline */}
      <g opacity="0.55">
        <rect x="40" y="210" width="46" height="150" rx="4" fill="#123F8C" opacity="0.18" />
        <rect x="96" y="170" width="34" height="190" rx="4" fill="#0B2A68" opacity="0.14" />
        <rect x="140" y="230" width="40" height="130" rx="4" fill="#123F8C" opacity="0.16" />
        <rect x="470" y="190" width="38" height="170" rx="4" fill="#0B2A68" opacity="0.14" />
        <rect x="518" y="225" width="50" height="135" rx="4" fill="#123F8C" opacity="0.18" />
        <rect x="578" y="165" width="32" height="195" rx="4" fill="#0B2A68" opacity="0.12" />
        {/* window dots for texture */}
        {[96, 108, 120].map((x) =>
          [190, 215, 240, 265, 290].map((y) => (
            <rect key={`${x}-${y}`} x={x} y={y} width="5" height="7" rx="1" fill="#0B2A68" opacity="0.22" />
          )),
        )}
        {[522, 536, 550].map((x) =>
          [245, 268, 291, 314].map((y) => (
            <rect key={`${x}-${y}`} x={x} y={y} width="5" height="7" rx="1" fill="#123F8C" opacity="0.2" />
          )),
        )}
      </g>

      {/* Sun / accent orb */}
      <circle cx="500" cy="110" r="46" fill="#FF7A3D" opacity="0.15" />
      <circle cx="500" cy="110" r="26" fill="#FF7A3D" opacity="0.25" />

      {/* Route line */}
      <path
        d="M60 150 C 180 90, 260 210, 360 140 S 560 70, 600 60"
        stroke="#123F8C"
        strokeOpacity="0.25"
        strokeWidth="3"
        strokeDasharray="2 12"
        strokeLinecap="round"
        fill="none"
      />
      <motion.circle
        cx="600"
        cy="60"
        r="7"
        fill="#FF5A1F"
        animate={{ scale: [1, 1.25, 1] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformOrigin: '600px 60px' }}
      />
      <motion.circle
        cx="600"
        cy="60"
        r="12"
        fill="#FF5A1F"
        opacity="0.25"
        animate={{ scale: [1, 1.6, 1], opacity: [0.25, 0, 0.25] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformOrigin: '600px 60px' }}
      />

      {/* Plane */}
      <g transform="translate(420 60) rotate(18)">
        <motion.path
          d="M0 8 L34 8 L48 0 L54 2 L44 10 L54 14 L60 20 L48 18 L34 22 L0 14 Z"
          fill="#0B2A68"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.55 }}
          transition={{ duration: 1, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
        />
      </g>

      {/* Road */}
      <rect x="0" y="392" width="640" height="128" fill="url(#roadGrad)" />
      <g opacity="0.9">
        <rect x="10" y="410" width="46" height="6" rx="3" fill="#F7F9FC" opacity="0.55" />
        <rect x="90" y="410" width="46" height="6" rx="3" fill="#F7F9FC" opacity="0.55" />
        <rect x="170" y="410" width="46" height="6" rx="3" fill="#F7F9FC" opacity="0.55" />
        <rect x="600" y="410" width="30" height="6" rx="3" fill="#F7F9FC" opacity="0.4" />
      </g>

      {/* Ground shadow under vehicle */}
      <ellipse cx="380" cy="410" rx="150" ry="14" fill="#000000" opacity="0.14" />

      {/* Container / trailer */}
      <rect x="230" y="290" width="200" height="110" rx="8" fill="#FFFFFF" stroke="#E5EAF2" strokeWidth="2" />
      <rect x="230" y="290" width="200" height="18" rx="8" fill="#0B2A68" />
      <line x1="270" y1="308" x2="270" y2="400" stroke="#E5EAF2" strokeWidth="2" />
      <line x1="310" y1="308" x2="310" y2="400" stroke="#E5EAF2" strokeWidth="2" />
      <line x1="350" y1="308" x2="350" y2="400" stroke="#E5EAF2" strokeWidth="2" />
      <line x1="390" y1="308" x2="390" y2="400" stroke="#E5EAF2" strokeWidth="2" />
      {/* brand mark on trailer */}
      <g transform="translate(300 335)">
        <rect x="-32" y="-16" width="64" height="32" rx="8" fill="#FF5A1F" opacity="0.08" />
        <text x="0" y="6" textAnchor="middle" fontSize="15" fontWeight="800" fill="#FF5A1F" fontFamily="Plus Jakarta Sans, sans-serif">
          SHIFTER
        </text>
      </g>

      {/* Cab */}
      <path d="M430 330 h58 a14 14 0 0 1 14 14 v56 h-72 z" fill="url(#truckBody)" />
      <rect x="446" y="346" width="34" height="26" rx="4" fill="#0B2A68" opacity="0.85" />
      {/* headlight */}
      <rect x="486" y="378" width="10" height="8" rx="2" fill="#FFE7A0" />
      <rect x="430" y="392" width="212" height="10" rx="5" fill="#0B2A68" />

      {/* Wheels */}
      <g>
        <circle cx="278" cy="404" r="20" fill="#0B1736" />
        <circle cx="278" cy="404" r="8" fill="#F7F9FC" />
        <circle cx="370" cy="404" r="20" fill="#0B1736" />
        <circle cx="370" cy="404" r="8" fill="#F7F9FC" />
        <circle cx="470" cy="404" r="20" fill="#0B1736" />
        <circle cx="470" cy="404" r="8" fill="#F7F9FC" />
      </g>

      {/* Speed lines */}
      <motion.g
        stroke="#123F8C"
        strokeOpacity="0.25"
        strokeWidth="4"
        strokeLinecap="round"
        animate={{ x: [0, -10, 0], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <line x1="130" y1="360" x2="200" y2="360" />
        <line x1="110" y1="378" x2="205" y2="378" />
        <line x1="140" y1="396" x2="200" y2="396" />
      </motion.g>

      {/* Location pin above trailer */}
      <g transform="translate(320 250)">
        <motion.g animate={{ y: [0, -6, 0] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}>
          <path d="M0 0c-11 0-20 9-20 20 0 15 20 34 20 34s20-19 20-34c0-11-9-20-20-20z" fill="#FF5A1F" />
          <circle cx="0" cy="19" r="7" fill="#FFFFFF" />
        </motion.g>
      </g>
    </svg>
  );
}
