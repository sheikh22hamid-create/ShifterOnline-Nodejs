import { ScrollReveal } from './ui/ScrollReveal';
import { Button } from './ui/Button';

interface CTAProps {
  onGetStartedClick: () => void;
}

export function CTA({ onGetStartedClick }: CTAProps) {
  return (
    <section id="cta" className="relative overflow-hidden bg-navy py-24 md:py-28">
      <div className="absolute inset-0 bg-grid-fade opacity-30" />
      <div className="absolute -top-24 right-0 h-72 w-72 rounded-full bg-orange/10 blur-3xl" />
      <div className="absolute -bottom-16 left-0 h-64 w-64 rounded-full bg-royal/20 blur-3xl" />

      <svg
        className="pointer-events-none absolute inset-x-0 top-1/2 hidden w-full -translate-y-1/2 opacity-25 md:block"
        viewBox="0 0 1200 120"
        fill="none"
        aria-hidden="true"
        preserveAspectRatio="none"
      >
        <path
          d="M0 80 C 200 20, 400 120, 600 60 S 1000 20, 1200 70"
          stroke="#FF5A1F"
          strokeWidth="2"
          strokeDasharray="2 14"
          strokeLinecap="round"
          fill="none"
        />
      </svg>

      <ScrollReveal className="container-shifter relative text-center">
        <h2 className="mx-auto max-w-2xl text-3xl font-extrabold leading-tight text-white sm:text-[42px]">
          Ready to Move Smarter?
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-[15px] text-white/70 sm:text-lg">
          Experience faster, safer and smarter logistics with Shifter Online.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button variant="primary" size="lg" onClick={onGetStartedClick}>
            Get Started →
          </Button>
          <Button href="mailto:support@shifteronline.com" variant="outline-light" size="lg">
            Contact Us
          </Button>
        </div>
      </ScrollReveal>
    </section>
  );
}
