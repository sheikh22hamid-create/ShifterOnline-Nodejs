import { useOutletContext } from 'react-router-dom';
import { Hero } from '../components/hero/Hero';
import { BenefitsBar } from '../components/BenefitsBar';
import { Services } from '../components/services/Services';
import { WhyChooseUs } from '../components/WhyChooseUs';
import { HowItWorks } from '../components/HowItWorks';
import { TrackingPreview } from '../components/TrackingPreview';
import { CustomerReviews } from '../components/CustomerReviews';
import { AppSection } from '../components/AppSection';
import { FAQSection } from '../components/FAQSection';
import { CTA } from '../components/CTA';
import type { LayoutContext } from '../components/Layout';

export function Home() {
  const { openSignup } = useOutletContext<LayoutContext>();

  return (
    <main>
      <Hero />
      <BenefitsBar />
      <Services />
      <WhyChooseUs />
      <HowItWorks />
      <TrackingPreview />
      <CustomerReviews />
      <AppSection />
      <FAQSection />
      <CTA onGetStartedClick={openSignup} />
    </main>
  );
}
