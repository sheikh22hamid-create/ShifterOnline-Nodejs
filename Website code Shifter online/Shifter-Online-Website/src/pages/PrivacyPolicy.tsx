import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, Users, Truck, UserCheck } from 'lucide-react';

export function PrivacyPolicy() {
  const [activeTab, setActiveTab] = useState<'customers' | 'drivers'>('customers');

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  return (
    <div className="min-h-screen bg-[#F8FAFC] pt-32 pb-24 text-ink">
      {/* Hero Header */}
      <div className="relative overflow-hidden bg-navy py-14 text-white">
        <div className="absolute inset-0 bg-grid-fade opacity-20 pointer-events-none" />
        <div className="container-shifter relative">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-semibold text-white/70 hover:text-white transition-colors mb-6"
          >
            <ArrowLeft size={16} /> Back to Home
          </Link>
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-orange mb-4">
            <ShieldCheck size={14} /> Shifter Online · Data Protection &amp; Privacy
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl md:text-5xl">
            Privacy Policy
          </h1>
          <p className="mt-3 text-base text-white/75 max-w-2xl">
            Shifter Online is operated by <strong>Movigo Logistic Aggregator Private Limited</strong>.
            Please select your role below to view the policy applicable to you.
          </p>

          {/* Interactive Role Selector Switch */}
          <div className="mt-8 inline-flex rounded-2xl bg-white/10 p-1.5 backdrop-blur-md border border-white/15">
            <button
              type="button"
              onClick={() => setActiveTab('customers')}
              className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs sm:text-sm font-bold transition-all ${
                activeTab === 'customers'
                  ? 'bg-orange text-white shadow-soft'
                  : 'text-white/70 hover:text-white'
              }`}
            >
              <Users size={16} />
              <span>For Customers</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('drivers')}
              className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs sm:text-sm font-bold transition-all ${
                activeTab === 'drivers'
                  ? 'bg-orange text-white shadow-soft'
                  : 'text-white/70 hover:text-white'
              }`}
            >
              <Truck size={16} />
              <span>For Driver-Partners</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="container-shifter mt-10">
        <div className="mx-auto max-w-4xl rounded-3xl border border-line bg-white p-6 shadow-soft sm:p-10 md:p-14">

          {/* Tab Indicator Banner */}
          <div className="mb-8 flex items-center justify-between border-b border-line pb-4">
            <div className="flex items-center gap-2 text-sm font-bold text-navy">
              {activeTab === 'customers' ? (
                <>
                  <Users size={18} className="text-orange" />
                  <span>Viewing Privacy Policy for: <strong>Customers</strong></span>
                </>
              ) : (
                <>
                  <Truck size={18} className="text-orange" />
                  <span>Viewing Privacy Policy for: <strong>Driver-Partners</strong></span>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => setActiveTab(activeTab === 'customers' ? 'drivers' : 'customers')}
              className="text-xs font-semibold text-royal hover:underline"
            >
              Switch to {activeTab === 'customers' ? 'Driver-Partners' : 'Customers'} →
            </button>
          </div>

          {/* ========================================================== */}
          {/* TAB 1: CUSTOMERS PRIVACY POLICY */}
          {/* ========================================================== */}
          {activeTab === 'customers' && (
            <div className="space-y-8 text-[15px] leading-relaxed text-ink/80">
              <div>
                <span className="text-xs font-extrabold uppercase tracking-widest text-orange">
                  Customer Agreement
                </span>
                <h2 className="mt-1 text-2xl font-extrabold text-navy sm:text-3xl">
                  PRIVACY POLICY — CUSTOMERS
                </h2>
                <p className="mt-1 text-xs text-muted">
                  Shifter Online — operated by Movigo Logistic Aggregator Private Limited · Last updated: 01 October 2025
                </p>
              </div>

              <div className="rounded-2xl border border-line bg-[#F8FAFC] p-5">
                <p>
                  Your privacy matters to Movigo Logistic Aggregator Private Limited (“Company”, “Shifter Online”, “we”, “us”).
                  This Privacy Policy explains how we collect, use, store, and disclose your information when you use the
                  Shifter Online customer application (the “Application”) to book transportation of goods.
                  It is a part of, and read together with, the Terms of Use for Customers. Driver-Partners are governed by a separate Privacy Policy for Driver-Partners.
                </p>
                <p className="mt-3">
                  By using the Application, you agree to the collection, use, storage, and disclosure of your information as set out here.
                  If you don&apos;t agree, please don&apos;t use the Application.
                </p>
                <p className="mt-3 text-xs text-muted">
                  Separately from this Policy, at specific points where we ask for particular information, we&apos;ll show you a short, itemised notice explaining exactly what we&apos;re collecting and why, at that moment. This Policy remains the general reference document.
                </p>
              </div>

              {/* WHAT WE COLLECT */}
              <section>
                <h3 className="text-lg font-bold text-navy">WHAT WE COLLECT</h3>
                <p className="mt-2">
                  We collect: your name, contact number, and email address; your address and, for bookings, pickup and drop-off location details; and information you give us when you use the Application, including billing details, invoices, and past transaction history, so we can process requests and pre-fill future ones.
                </p>
              </section>

              {/* HOW WE USE YOUR INFORMATION */}
              <section>
                <h3 className="text-lg font-bold text-navy">HOW WE USE YOUR INFORMATION</h3>
                <p className="mt-2">
                  We use your information to let you register, book, and use the Application; match you with an available Driver-Partner; process payments and settlements connected to a booking; respond to queries, complaints, and support requests; send booking confirmations, status updates, and service-related communication; investigate and prevent fraud, misuse, or safety risks; and meet any other purpose you&apos;ve separately consented to.
                </p>
                <p className="mt-3">
                  We may occasionally send promotional messages — email, SMS, or calls — about offers or new features. You can opt out at any time under the Telecom Commercial Communications Customer Preference Regulations, 2018, by writing to us at the contact address below; opting out doesn&apos;t affect transactional messages tied to an active booking.
                </p>
              </section>

              {/* SECURITY */}
              <section>
                <h3 className="text-lg font-bold text-navy">SECURITY</h3>
                <p className="mt-2">
                  We maintain reasonable technical and organisational safeguards to protect your data against unauthorised access, alteration, or disclosure, as required under Section 8(5) of the Digital Personal Data Protection Act, 2023 and the Digital Personal Data Protection Rules, 2025. No system is completely immune to risk, and you&apos;re responsible for keeping your own login credentials confidential.
                </p>
              </section>

              {/* HOW WE SHARE YOUR INFORMATION */}
              <section>
                <h3 className="text-lg font-bold text-navy">HOW WE SHARE YOUR INFORMATION</h3>
                <p className="mt-2">
                  We may share your name, contact number, and pickup location with the Driver-Partner assigned to your booking, strictly to enable the transaction; with our payment aggregator, to process and settle payments; with vendors or service providers who support our operations under contract; with government or law enforcement authorities where required by law or to investigate fraud or unlawful conduct; and with a successor entity in the event of a merger, acquisition, or sale of business or assets. We don&apos;t sell your personal data.
                </p>
              </section>

              {/* YOUR RIGHTS AS A DATA PRINCIPAL */}
              <section>
                <h3 className="text-lg font-bold text-navy">YOUR RIGHTS AS A DATA PRINCIPAL</h3>
                <p className="mt-2">
                  Under the Digital Personal Data Protection Act, 2023, you have the right to access a summary of the personal data we hold about you (Section 11); ask us to correct, complete, update, or erase your data (Section 12); withdraw consent at any time; nominate another individual to exercise these rights on your behalf in the event of death or incapacity (Section 14); and register a grievance with us in the first instance (Section 13), after which, if unresolved, you may approach the Data Protection Board of India. To exercise any of these rights, write to us at the contact details below.
                </p>
              </section>

              {/* WITHDRAWAL OF CONSENT */}
              <section>
                <h3 className="text-lg font-bold text-navy">WITHDRAWAL OF CONSENT</h3>
                <p className="mt-2">
                  You may decline to give us certain information, or withdraw consent already given, by writing to us. Doing so may mean we&apos;re unable to offer the part of the Service that depended on that information — for instance, a Customer who withholds a pickup location can&apos;t be matched with a Driver-Partner.
                </p>
              </section>

              {/* DELETION OF DATA */}
              <section>
                <h3 className="text-lg font-bold text-navy">DELETION OF DATA</h3>
                <p className="mt-2">
                  If you delete your account, or write to us asking us to erase your data, we will do so — except where we&apos;re required to retain it for safety, fraud prevention, legal compliance, dispute resolution, or to enforce our own rights. Some records, such as trip and transaction history, may need to be kept even after account deletion where law requires it. Requests for deletion can be sent to <a href="mailto:support@shifteronline.com" className="font-semibold text-royal hover:underline">support@shifteronline.com</a>.
                </p>
              </section>

              {/* DATA RETENTION AND CROSS-BORDER TRANSFER */}
              <section>
                <h3 className="text-lg font-bold text-navy">DATA RETENTION AND CROSS-BORDER TRANSFER</h3>
                <p className="mt-2">
                  We retain your personal data only for as long as is necessary for the purpose it was collected for, or such longer period as may be required under applicable law, including for safety, fraud prevention, an ongoing dispute, or a statutory obligation such as tax record-keeping. All data collected through the Application is stored and processed on servers located within India, and is not transferred to, or processed by, any vendor or server located outside India.
                </p>
              </section>

              {/* PROHIBITED CONTENT */}
              <section>
                <h3 className="text-lg font-bold text-navy">PROHIBITED CONTENT</h3>
                <p className="mt-2">
                  In line with Rule 3(1)(b) of the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021, you must not use the Application to host, upload, or transmit information that belongs to someone else without right; is obscene, defamatory, harassing, or invasive of privacy; is harmful to a child; infringes intellectual property; is knowingly false or misleading; impersonates another person; threatens public order or India&apos;s sovereignty; or carries malicious code.
                </p>
              </section>

              {/* COOKIES AND SIMILAR TECHNOLOGIES */}
              <section>
                <h3 className="text-lg font-bold text-navy">COOKIES AND SIMILAR TECHNOLOGIES</h3>
                <p className="mt-2">
                  <strong>Website:</strong> Our website uses cookies to understand how it&apos;s used and to improve the experience. You can set your browser to decline cookies, though parts of the website may not work as well if you do.
                </p>
                <p className="mt-2">
                  <strong>Application:</strong> Our mobile application doesn&apos;t use browser cookies. It may use device identifiers and analytics tools to understand usage patterns and improve the app. You can reset or limit your device&apos;s advertising identifier through your phone&apos;s privacy settings.
                </p>
              </section>

              {/* GRIEVANCE OFFICER & CONTACT US */}
              <section className="rounded-2xl border border-line bg-navy p-6 text-white sm:p-8">
                <div className="flex items-center gap-2 text-orange text-xs font-bold uppercase tracking-wider mb-2">
                  <UserCheck size={16} /> Grievance Redressal
                </div>
                <h3 className="text-xl font-bold">GRIEVANCE OFFICER</h3>
                <div className="mt-4 space-y-1.5 text-sm text-white/80">
                  <p><strong>Name:</strong> Hamid Sheikh</p>
                  <p><strong>Designation:</strong> Director</p>
                  <p><strong>Email:</strong> <a href="mailto:support@shifteronline.com" className="text-orange hover:underline">support@shifteronline.com</a></p>
                  <p><strong>Address:</strong> 52–53 New Khijrabad Colony, Khajrana, Indore, Madhya Pradesh 452016</p>
                </div>

                <div className="mt-6 border-t border-white/10 pt-4">
                  <h4 className="text-base font-bold text-white">CONTACT US</h4>
                  <p className="mt-1 text-xs text-white/70">
                    For service queries, complaints, or questions about this Policy, write to us at{' '}
                    <a href="mailto:support@shifteronline.com" className="text-orange underline font-semibold">
                      support@shifteronline.com
                    </a>.
                  </p>
                </div>
              </section>
            </div>
          )}

          {/* ========================================================== */}
          {/* TAB 2: DRIVER-PARTNERS PRIVACY POLICY */}
          {/* ========================================================== */}
          {activeTab === 'drivers' && (
            <div className="space-y-8 text-[15px] leading-relaxed text-ink/80">
              <div>
                <span className="text-xs font-extrabold uppercase tracking-widest text-orange">
                  Driver-Partner Agreement
                </span>
                <h2 className="mt-1 text-2xl font-extrabold text-navy sm:text-3xl">
                  PRIVACY POLICY — DRIVER-PARTNERS
                </h2>
                <p className="mt-1 text-xs text-muted">
                  Shifter Online — operated by Movigo Logistic Aggregator Private Limited · Last updated: 01 October 2025
                </p>
              </div>

              <div className="rounded-2xl border border-line bg-[#F8FAFC] p-5">
                <p>
                  Your privacy matters to Movigo Logistic Aggregator Private Limited (“Company”, “Shifter Online”, “we”, “us”).
                  This Privacy Policy explains how we collect, use, store, and disclose your information when you use the
                  “Shifter Partner” driver application (the “Application”). It is a part of, and read together with,
                  the Terms of Use for Driver-Partners. Customers are governed by a separate Privacy Policy for Customers.
                </p>
                <p className="mt-3">
                  By using the Application, you agree to the collection, use, storage, and disclosure of your information as set out here.
                  If you don&apos;t agree, please don&apos;t use the Application.
                </p>
                <p className="mt-3 text-xs text-muted">
                  Separately from this Policy, at specific points where we ask for particular information — for instance, when you upload KYC documents or grant location access — we&apos;ll show you a short, itemised notice explaining exactly what we&apos;re collecting and why, at that moment. This Policy remains the general reference document.
                </p>
              </div>

              {/* WHAT WE COLLECT */}
              <section>
                <h3 className="text-lg font-bold text-navy">WHAT WE COLLECT</h3>
                <p className="mt-2">
                  We collect: your name, contact number, and email address; your live location, profile photo, and identity documents for KYC verification (any valid government-issued photo ID, such as Aadhaar, PAN, Voter ID, Driving Licence, or Passport); your vehicle documents — registration certificate, insurance, PUC certificate, driving licence, and any other document evidencing the vehicle&apos;s fitness to operate; bank account or payment details needed to process settlements through our payment aggregator; and call duration and connection status between you and a Customer during an active booking, used only to verify that contact was attempted or made, and to review safety or service complaints where raised.
                </p>
                <p className="mt-3">
                  We do not access or store the content of any call or SMS message. Where legally permitted, we may also collect background or identity verification information, which may be gathered on our behalf by an authorised third-party vendor.
                </p>
                <p className="mt-3">
                  We collect location data from your device from the time a booking is accepted until it&apos;s completed, and while the Application runs in the foreground. We link this to the Customer&apos;s booking record so we can generate accurate trip records and provide support.
                </p>
              </section>

              {/* HOW WE USE YOUR INFORMATION */}
              <section>
                <h3 className="text-lg font-bold text-navy">HOW WE USE YOUR INFORMATION</h3>
                <p className="mt-2">
                  We use your information to let you register and use the Application; match you with Customers seeking transportation services; process payments and settlements connected to a booking; verify your eligibility and documents; respond to queries, complaints, and support requests; investigate and prevent fraud, misuse, or safety risks; and meet any other purpose you&apos;ve separately consented to.
                </p>
                <p className="mt-3">
                  We may occasionally send promotional messages about offers or new features. You can opt out at any time under the Telecom Commercial Communications Customer Preference Regulations, 2018, by writing to us at the contact address below; opting out doesn&apos;t affect transactional messages tied to an active booking.
                </p>
              </section>

              {/* SECURITY */}
              <section>
                <h3 className="text-lg font-bold text-navy">SECURITY</h3>
                <p className="mt-2">
                  We maintain reasonable technical and organisational safeguards to protect your data against unauthorised access, alteration, or disclosure, as required under Section 8(5) of the Digital Personal Data Protection Act, 2023 and the Digital Personal Data Protection Rules, 2025. No system is completely immune to risk, and you&apos;re responsible for keeping your own login credentials confidential.
                </p>
              </section>

              {/* HOW WE SHARE YOUR INFORMATION */}
              <section>
                <h3 className="text-lg font-bold text-navy">HOW WE SHARE YOUR INFORMATION</h3>
                <p className="mt-2">
                  We may share your name, contact number, and profile photo with the Customer you are matched with, strictly to enable the transaction; your bank or payment details with our payment aggregator, to process and settle your earnings; your KYC and background information with vendors engaged for identity or background verification, under contract; your information with government or law enforcement authorities where required by law or to investigate fraud, safety incidents, or unlawful conduct; and your information with a successor entity in the event of a merger, acquisition, or sale of business or assets. We don&apos;t sell your personal data.
                </p>
              </section>

              {/* YOUR RIGHTS AS A DATA PRINCIPAL */}
              <section>
                <h3 className="text-lg font-bold text-navy">YOUR RIGHTS AS A DATA PRINCIPAL</h3>
                <p className="mt-2">
                  Under the Digital Personal Data Protection Act, 2023, you have the right to access a summary of the personal data we hold about you (Section 11); ask us to correct, complete, update, or erase your data (Section 12); withdraw consent at any time; nominate another individual to exercise these rights on your behalf in the event of death or incapacity (Section 14); and register a grievance with us in the first instance (Section 13), after which, if unresolved, you may approach the Data Protection Board of India. To exercise any of these rights, write to us at the contact details below.
                </p>
              </section>

              {/* WITHDRAWAL OF CONSENT */}
              <section>
                <h3 className="text-lg font-bold text-navy">WITHDRAWAL OF CONSENT</h3>
                <p className="mt-2">
                  You may decline to give us certain information, or withdraw consent already given, by writing to us. Doing so may mean we&apos;re unable to offer the part of the Service that depended on that information — for instance, a Driver-Partner who withholds vehicle documents can&apos;t be onboarded.
                </p>
              </section>

              {/* DELETION OF DATA */}
              <section>
                <h3 className="text-lg font-bold text-navy">DELETION OF DATA</h3>
                <p className="mt-2">
                  If you delete your account, or write to us asking us to erase your data, we will do so — except where we&apos;re required to retain it for safety, fraud prevention, legal compliance, dispute resolution, or to enforce our own rights. Some records, such as trip and settlement history, may need to be kept even after account deletion where law requires it. Requests for deletion can be sent to <a href="mailto:support@shifteronline.com" className="font-semibold text-royal hover:underline">support@shifteronline.com</a>.
                </p>
              </section>

              {/* DATA RETENTION AND CROSS-BORDER TRANSFER */}
              <section>
                <h3 className="text-lg font-bold text-navy">DATA RETENTION AND CROSS-BORDER TRANSFER</h3>
                <p className="mt-2">
                  We retain your personal data only for as long as is necessary for the purpose it was collected for, or such longer period as may be required under applicable law, including for safety, fraud prevention, an ongoing dispute, or a statutory obligation such as tax record-keeping. All data collected through the Application is stored and processed on servers located within India, and is not transferred to, or processed by, any vendor or server located outside India.
                </p>
              </section>

              {/* PROHIBITED CONTENT */}
              <section>
                <h3 className="text-lg font-bold text-navy">PROHIBITED CONTENT</h3>
                <p className="mt-2">
                  In line with Rule 3(1)(b) of the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021, you must not use the Application to host, upload, or transmit information that belongs to someone else without right; is obscene, defamatory, harassing, or invasive of privacy; is harmful to a child; infringes intellectual property; is knowingly false or misleading; impersonates another person; threatens public order or India&apos;s sovereignty; or carries malicious code.
                </p>
              </section>

              {/* COOKIES AND SIMILAR TECHNOLOGIES */}
              <section>
                <h3 className="text-lg font-bold text-navy">COOKIES AND SIMILAR TECHNOLOGIES</h3>
                <p className="mt-2">
                  Our mobile application doesn&apos;t use browser cookies. It may use device identifiers and analytics tools to understand usage patterns and improve the app. You can reset or limit your device&apos;s advertising identifier through your phone&apos;s privacy settings.
                </p>
              </section>

              {/* GRIEVANCE OFFICER & CONTACT US */}
              <section className="rounded-2xl border border-line bg-navy p-6 text-white sm:p-8">
                <div className="flex items-center gap-2 text-orange text-xs font-bold uppercase tracking-wider mb-2">
                  <UserCheck size={16} /> Grievance Redressal
                </div>
                <h3 className="text-xl font-bold">GRIEVANCE OFFICER</h3>
                <div className="mt-4 space-y-1.5 text-sm text-white/80">
                  <p><strong>Name:</strong> Hamid Sheikh</p>
                  <p><strong>Designation:</strong> Director</p>
                  <p><strong>Email:</strong> <a href="mailto:support@shifteronline.com" className="text-orange hover:underline">support@shifteronline.com</a></p>
                  <p><strong>Address:</strong> 52–53 New Khijrabad Colony, Khajrana, Indore, Madhya Pradesh 452016</p>
                </div>

                <div className="mt-6 border-t border-white/10 pt-4">
                  <h4 className="text-base font-bold text-white">CONTACT US</h4>
                  <p className="mt-1 text-xs text-white/70">
                    For service queries, complaints, or questions about this Policy, write to us at{' '}
                    <a href="mailto:support@shifteronline.com" className="text-orange underline font-semibold">
                      support@shifteronline.com
                    </a>.
                  </p>
                </div>
              </section>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
