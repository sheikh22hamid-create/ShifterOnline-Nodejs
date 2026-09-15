import { SmartLink } from './ui/SmartLink';
import { FacebookIcon, InstagramIcon, LinkedinIcon } from './ui/SocialIcons';

const columns = [
  {
    title: 'Company',
    links: [
      { label: 'About Us', href: '#why-us' },
      { label: 'Services', href: '#services' },
      { label: 'Contact Us', href: 'mailto:support@shifteronline.com' },
      { label: 'Helpline', href: 'tel:9109114515' },
    ],
  },
  {
    title: 'Services',
    links: [
      { label: 'Bike Goods Delivery', href: '#services' },
      { label: 'Three-Wheeler Transport', href: '#services' },
      { label: 'Tata Ace & Mini Truck', href: '#services' },
      { label: 'Business & Commercial Logistics', href: '#services' },
    ],
  },
  {
    title: 'Support & Contact',
    links: [
      { label: '📞 +91 9109114515', href: 'tel:9109114515' },
      { label: '✉️ support@shifteronline.com', href: 'mailto:support@shifteronline.com' },
      { label: 'Privacy Policy', href: '/privacy-policy.html' },
      { label: 'Terms & Conditions', href: '/terms.html' },
    ],
  },
];

const socials = [
  { icon: FacebookIcon, href: 'https://www.facebook.com/share/1E4zRQy9fA/', label: 'Facebook' },
  { icon: InstagramIcon, href: 'https://www.instagram.com/shifter_online?stkn=dGV6YjBzcDZtdW9z', label: 'Instagram' },
  { icon: LinkedinIcon, href: 'https://www.linkedin.com/company/shifteronline/', label: 'LinkedIn' },
];

export function Footer() {
  return (
    <footer className="bg-[#081D4C] pt-20 text-white/70">
      <div className="container-shifter grid grid-cols-1 gap-12 pb-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <span className="inline-flex items-center gap-2.5 select-none">
            <img
              src="/shifter-online-icon.png"
              alt="Shifter Online"
              className="h-9 w-9 object-contain"
            />
            <span className="text-[19px] font-extrabold tracking-tight text-white">
              Shifter <span className="text-orange">Online</span>
            </span>
          </span>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/55">
            Shifter Online, by Movigo Logistics Aggregator Pvt. Ltd., is India&apos;s
            technology-driven logistics platform — connecting customers with verified driver
            partners for fast, affordable and transparent goods transportation.
          </p>
          <div className="mt-6 flex gap-3">
            {socials.map(({ icon: Icon, href, label }) => (
              <a
                key={label}
                href={href}
                aria-label={label}
                className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-orange"
              >
                <Icon />
              </a>
            ))}
          </div>
        </div>

        {columns.map((col) => (
          <div key={col.title}>
            <h4 className="text-sm font-bold text-white">{col.title}</h4>
            <ul className="mt-4 flex flex-col gap-3">
              {col.links.map((link) => (
                <li key={link.label}>
                  <SmartLink href={link.href} className="text-sm text-white/55 transition-colors hover:text-white">
                    {link.label}
                  </SmartLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-white/10">
        <div className="container-shifter flex flex-col items-center justify-between gap-4 py-6 sm:flex-row">
          <p className="text-xs text-white/45">
            © {new Date().getFullYear()} Movigo Logistics Aggregator Pvt. Ltd. All rights reserved.
          </p>
          <div className="flex items-center gap-4 text-xs text-white/45">
            <a href="/privacy-policy.html" className="hover:text-white">
              Privacy Policy
            </a>
            <a href="/terms.html" className="hover:text-white">
              Terms & Conditions
            </a>
            <a href="/refund.html" className="hover:text-white">
              Refund Policy
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
