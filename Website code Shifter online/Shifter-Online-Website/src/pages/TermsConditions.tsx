import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, FileText, Users, Truck, UserCheck } from 'lucide-react';

export function TermsConditions() {
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
            <FileText size={14} /> Shifter Online · Terms of Use
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl md:text-5xl">
            Terms &amp; Conditions
          </h1>
          <p className="mt-3 text-base text-white/75 max-w-2xl">
            Movigo Logistic Aggregator Private Limited (CIN: U52219MP2025PTC079643).
            Please select your role below to view the applicable Terms of Use.
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
                  <span>Viewing Terms of Use for: <strong>Customers</strong></span>
                </>
              ) : (
                <>
                  <Truck size={18} className="text-orange" />
                  <span>Viewing Terms of Use for: <strong>Driver-Partners</strong></span>
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
          {/* TAB 1: CUSTOMERS TERMS */}
          {/* ========================================================== */}
          {activeTab === 'customers' && (
            <div className="space-y-7 text-[15px] leading-relaxed text-ink/85">
              <div>
                <span className="text-xs font-extrabold uppercase tracking-widest text-orange">
                  Customer Service Agreement
                </span>
                <h2 className="mt-1 text-2xl font-extrabold text-navy sm:text-3xl">
                  TERMS OF USE — CUSTOMERS
                </h2>
                <p className="mt-1 text-xs text-muted">
                  Shifter Online — operated by Movigo Logistic Aggregator Private Limited · Last updated: 01 October 2025
                </p>
              </div>

              <div className="rounded-2xl border border-line bg-[#F8FAFC] p-5">
                <p>
                  These Terms of Use (“Terms”) govern access to and use of the website{' '}
                  <a href="https://shifteronline.com" className="text-royal font-semibold hover:underline">
                    https://shifteronline.com
                  </a>{' '}
                  and the “Shifter Online” customer application (together, the “Application”) by Customers booking transportation of goods, operated by <strong>Movigo Logistic Aggregator Private Limited</strong> (“Company”, “Shifter Online”, “we”, “us”), a company incorporated under the Companies Act, 2013, <strong>CIN U52219MP2025PTC079643</strong>, registered office at 52–53 New Khijrabad Colony, Khajrana, Indore, Madhya Pradesh 452016. These Terms are to be read together with the Shifter Online Privacy Policy for Customers. Driver-Partners are governed by a separate Terms of Use for Driver-Partners.
                </p>
                <p className="mt-3">
                  By using the Application, you agree to be bound by these Terms. If you do not agree, uninstall the Application and discontinue use.
                </p>
              </div>

              {/* GENERAL TERMS AND CONDITIONS */}
              <section>
                <h3 className="text-lg font-bold text-navy">GENERAL TERMS AND CONDITIONS</h3>
                <div className="mt-3 space-y-3">
                  <p><strong>1. No guarantee of booking; access only.</strong> The Company does not guarantee, warrant, or assure any Customer of receiving a booking. The Application is a technology platform that facilitates a connection between Customers and independent Driver-Partners; any booking is subject entirely to real-time availability. Any fee charged by the Company — whether described as a Platform Fee or otherwise — is charged solely for access to the Application and its matching functionality, and is not, and must not be construed as, a guarantee of a booking or of any particular service outcome.</p>
                  <p><strong>2. Eligibility.</strong> A Customer must be at least 18 years of age and competent to contract under the Indian Contract Act, 1872, to register and book Services on the Application.</p>
                  <p><strong>3. Nature of the Company&apos;s role.</strong> The Company is a technology intermediary that connects Customers with independent Driver-Partners for the transportation of goods. The Company owns no vehicles, employs no drivers, and is not a common carrier, freight forwarder, or bailee of the Goods. As between a Customer and a Driver-Partner, the contract of carriage, where one arises, is between them alone; the Company is not a party to it.</p>
                  <p><strong>4. Plans, offers, and pricing — Company&apos;s discretion.</strong> The Company may, at its sole discretion and without prior notice, introduce, modify, or discontinue any plan, promotional offer, or pricing structure applicable to Customers. Any such change takes effect immediately upon being reflected on the Application, and does not affect a booking already confirmed before the change took effect. Continued use of the Application after a change constitutes acceptance of it.</p>
                  <p><strong>5. Amendment.</strong> The Company may vary, amend, or update these Terms at its own discretion, from time to time, by publishing the revised version on the Application. Where a change is material, the Company will make reasonable efforts to flag it on the Application at the time of posting. It remains the Customer&apos;s responsibility to check these Terms periodically. Continued use of the Application after any amendment constitutes acceptance of the amended Terms.</p>
                  <p><strong>6. Statutory Taxes.</strong> Customers agree that use of the Application is subject to all prevailing statutory taxes, duties, and charges as applicable from time to time, and it is each Customer&apos;s responsibility to comply with Applicable Law, including payment of applicable taxes.</p>
                </div>
              </section>

              {/* GRIEVANCE OFFICER */}
              <section className="rounded-2xl border border-line bg-[#F8FAFC] p-5">
                <h3 className="text-lg font-bold text-navy flex items-center gap-2">
                  <UserCheck size={18} className="text-orange" />
                  GRIEVANCE OFFICER
                </h3>
                <p className="mt-2 text-xs text-muted">
                  In accordance with Rule 3(2) of the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021 and Rule 5 of the Consumer Protection (E-Commerce) Rules, 2020:
                </p>
                <div className="mt-3 space-y-1 text-sm text-ink/90">
                  <p><strong>Name:</strong> Hamid Sheikh</p>
                  <p><strong>Designation:</strong> Director</p>
                  <p><strong>Email:</strong> <a href="mailto:support@shifteronline.com" className="text-royal font-semibold hover:underline">support@shifteronline.com</a></p>
                  <p><strong>Address:</strong> 52–53 New Khijrabad Colony, Khajrana, Indore, Madhya Pradesh 452016</p>
                </div>
                <p className="mt-3 text-xs text-muted">
                  The Grievance Officer will acknowledge a complaint within 24 hours and endeavour to resolve it within 15 days, without prejudice to a Customer&apos;s right to approach the appropriate consumer forum or the National Consumer Helpline directly.
                </p>
              </section>

              {/* GOVERNING LAW AND DISPUTE RESOLUTION */}
              <section>
                <h3 className="text-lg font-bold text-navy">GOVERNING LAW AND DISPUTE RESOLUTION</h3>
                <p className="mt-2">
                  <strong>8.</strong> These Terms are governed by the laws of India. Subject to clause 7 above, and without prejudice to a Customer&apos;s statutory right under the Consumer Protection Act, 2019 to approach the consumer forum having jurisdiction over their own residence or place of business, the courts at Indore, Madhya Pradesh have exclusive jurisdiction over any other dispute arising out of or in connection with these Terms or use of the Application. There is no arbitration clause and no other forum applies.
                </p>
              </section>

              {/* CLAIMS & LIABILITY */}
              <section>
                <h3 className="text-lg font-bold text-navy">CLAIMS &amp; LIABILITY</h3>
                <div className="mt-3 space-y-3">
                  <p><strong>9. Claim Timelines.</strong> Any claim for loss of, or damage to, Goods must be made in writing within 24 hours of the scheduled delivery time, to support@shifteronline.com, accompanied by photographs of the damage and a description of the loss. Where the damage is latent or concealed and could not reasonably have been discovered within that window, the claim must instead be made within 24 hours of discovery, and in any event no later than 7 days from the date of delivery. Claims made outside these windows will not ordinarily be processed. The claimant must be able to verify their identity as the Customer who made the original booking; where identity cannot be verified, the claim will not be processed.</p>
                  <p><strong>10. Liability for loss of or damage to Goods.</strong> Where the Company is found liable for loss of, or damage to, Goods in transit, its liability is limited to the actual, evidenced value of the loss or damage suffered, and shall not exceed the value of the Goods as declared by the Customer at the time of booking under clause 16. A claim must be supported by satisfactory evidence of the loss — including, without limitation, purchase invoices, valuation records, or photographs — and the Company may reject, or reduce the amount payable on, any claim that is inflated, unsubstantiated, inconsistent with the declared value, or otherwise appears false or exaggerated.</p>
                  <p><strong>11. Aggregate cap for other claims.</strong> For any dispute not covered by clause 10 — including technical malfunction, delay, wallet discrepancy, or any other claim not involving loss of or damage to Goods — the Company&apos;s total aggregate liability to a Customer shall not exceed ₹500 (Rupees Five Hundred). This cap does not extend to a Driver-Partner&apos;s own liability to the Customer under the contract of carriage between them, nor does it apply to any liability that cannot lawfully be excluded under Applicable Law, including liability arising from the Company&apos;s own fraud or wilful misconduct.</p>
                  <p><strong>12. Consequential Loss.</strong> Under no circumstances is the Company, its directors, officers, employees, or agents liable for any indirect, incidental, consequential, or special loss or damage, including loss of profit, business, or goodwill, arising from use of the Application, except to the extent such liability cannot be excluded under Applicable Law.</p>
                  <p><strong>13. Delivery Estimates.</strong> No commitment is made to time-bound completion of any booking. Any pickup or delivery time shown on the Application is an estimate only; the Company is not liable for delay caused by traffic, weather, regulatory restriction, or any other factor outside its control.</p>
                </div>
              </section>

              {/* GOODS-RELATED OBLIGATIONS */}
              <section>
                <h3 className="text-lg font-bold text-navy">GOODS-RELATED OBLIGATIONS</h3>
                <div className="mt-3 space-y-3">
                  <p><strong>14. Ownership.</strong> The Customer warrants that the Goods tendered for transportation are owned by, or lawfully in the possession and control of, the Customer, and that the Customer is entitled to deal with them as contemplated by these Terms. The Customer agrees to indemnify the Company against any loss, claim, or liability arising from a lack of such authority.</p>
                  <p><strong>15. Packaging.</strong> The Customer is solely responsible for packaging the Goods adequately for transit. The Company is not liable for damage arising from inadequate packaging by the Customer, except to the extent the damage is directly attributable to the Driver-Partner&apos;s failure to handle adequately packaged Goods with reasonable care.</p>
                  <p><strong>16. Said-to-contain.</strong> All consignments are accepted on a “said-to-contain” basis — the Company has the right, but no obligation, to verify the declared contents. The Customer must make a true, accurate, and complete declaration of the description and value of the Goods at the time of booking, and that declaration binds the Customer.</p>
                  <p><strong>17. Restricted items.</strong> The Customer must not book transportation of: explosives, firearms, flammable or hazardous materials, narcotics or illegal drugs, livestock or animals, human remains, currency or coins, jewellery or precious stones, gambling devices, or any item whose transportation is unlawful under Applicable Law. Where a booking is found to contain any such item, the Company or the Driver-Partner may report the matter to law enforcement, and the Customer bears full responsibility, including indemnifying the Company for any resulting loss, penalty, or claim.</p>
                  <p><strong>18. Reverse liability for mis-declaration.</strong> Where Goods are mis-declared — including goods that are already damaged, that damage other goods in transit, or that are illegal — the Customer is liable for all resulting loss, including third-party and consequential loss. The Company bears no liability arising from such mis-declaration, except to the extent it arises directly from the Company&apos;s own gross negligence or wilful misconduct, and clause 11&apos;s cap does not limit the Customer&apos;s indemnity obligation to the Company in this respect.</p>
                  <p><strong>19. GST and e-way bill.</strong> Where the Customer falls within a category required under the Central Goods and Services Tax Act, 2017 to pay GST under reverse charge mechanism on goods transport agency services, the Customer is solely responsible for such registration and payment. The Customer is solely responsible for generating and updating the e-way bill (Parts A and B) correctly and in a timely manner, and for affixing the relevant documentation to the consignment before handing it to the Driver-Partner. Any delay, seizure, detention, or penalty arising from the Customer&apos;s failure to comply with e-way bill requirements is the Customer&apos;s sole responsibility. The Customer indemnifies the Company against any loss, penalty, or cost arising from non-compliance under this clause.</p>
                  <p><strong>20. Non-acceptance, lien, and disposal.</strong> Where a consignee is unavailable or refuses the consignment, the Customer remains liable for all charges, and the Company will attempt to notify the Customer to arrange re-delivery or collection. The Company has a lien over any undelivered Goods for sums due to it, and may levy reasonable demurrage for storage beyond 7 days from the failed delivery attempt. If the Goods remain unclaimed and the Customer remains unreachable for a further 15 days after such notice, the Company may sell or otherwise dispose of the Goods in a commercially reasonable manner to recover its dues and demurrage; any surplus proceeds, after deducting sums due to the Company, will be remitted to the Customer if they can be reasonably traced.</p>
                  <p><strong>21. High-value goods — insurance requirement.</strong> Where the declared value of the Goods under clause 16 exceeds ₹10,000 (Rupees Ten Thousand), the Customer must independently obtain transit insurance covering the Goods from pickup to delivery, at the Customer&apos;s own cost.</p>
                </div>
              </section>

              {/* CASH PAYMENTS, CANCELLATION, CONDUCT & BLOCKING */}
              <section>
                <h3 className="text-lg font-bold text-navy">PAYMENTS, CANCELLATIONS &amp; ACCESS</h3>
                <div className="mt-3 space-y-3">
                  <p><strong>22. Cash Payments.</strong> Where a Customer opts for cash payment, the full amount shown on the Application must be paid to the Driver-Partner on completion of service; such payment is deemed received on the Company&apos;s behalf. The Company is not liable for any additional amount a Customer voluntarily pays the Driver-Partner. Any dispute over short payment or an amount collected in excess of what is shown on the Application must be reported to support@shifteronline.com within 24 hours of completion of service.</p>
                  <p><strong>23. Cancellation by the Customer.</strong> Where a Customer cancels a confirmed booking, the Customer is liable to pay a cancellation charge, calculated with reference to the distance already covered by the Driver-Partner toward the pickup location and the category of vehicle assigned to the booking. The applicable cancellation amount will be deducted from the advance payment made by the Customer for that booking. Where the Driver-Partner cancels a confirmed booking instead, no cancellation charge is payable by the Customer.</p>
                  <p><strong>24. No vicarious liability for Driver-Partner conduct.</strong> The Driver-Partner is an independent contractor and a third party who independently provides transportation services to the Customer; the Company&apos;s role is limited to that of a technology intermediary connecting the two. Accordingly, the Company bears no vicarious liability for any act, omission, negligence, accident, theft, or misconduct of a Driver-Partner arising during the performance of transportation services. This clause does not exclude liability that cannot lawfully be excluded under Applicable Law, including where loss or damage arises directly from the Company&apos;s own negligence in Driver-Partner document verification, or while Goods are in the Company&apos;s own possession under clause 20. In any such exceptional case where the Company is found liable, that liability is limited to the value of the Goods as declared by the Customer at the time of booking.</p>
                  <p><strong>25. Blocking of Access.</strong> The Company may immediately suspend or terminate a Customer&apos;s account, without prior notice, where it reasonably believes there has been fraud, a safety risk, or a breach of Applicable Law. In any other case, the Company retains sole discretion to deny service or suspend or terminate an account, and will, where reasonably practicable, make an effort to inform the Customer of the reason.</p>
                </div>
              </section>

              {/* CONSUMER WALLET */}
              <section>
                <h3 className="text-lg font-bold text-navy">CONSUMER WALLET</h3>
                <div className="mt-3 space-y-3">
                  <p><strong>26.</strong> The Consumer Wallet is a closed-loop stored value facility provided solely to facilitate booking of Services on the Application. Amounts added are held as stored value and applied as consideration only on confirmation of a booking; they do not constitute a “deposit” under Section 45-I(bb) of the Reserve Bank of India Act, 1934, and no interest accrues. The Consumer Wallet is not a deposit, bank account, or cash balance, and must not be described, advertised, or represented as a facility from which money can be withdrawn on demand.</p>
                  <p><strong>27.</strong> The Consumer Wallet balance is non-transferable, cannot be redeemed for cash, and can be used only for bookings on the Application. It is account-specific and not interoperable with any other wallet.</p>
                  <p><strong>28. Goodwill amounts.</strong> The Company may, at its sole discretion, credit an amount to the Consumer Wallet as a goodwill gesture for cancellations, failed transactions, or service issues. Such a credit does not constitute a refund entitlement or a monetary obligation owed by the Company, creates no expectation of a similar credit in future, and may be revoked if credited in error or obtained through misuse.</p>
                  <p><strong>29. Promotional credits and cashback.</strong> Any promotional credit, cashback, or referral benefit offered on the Application may carry its own validity period and conditions, is non-transferable, is not redeemable for cash, and may be revoked in case of fraud or abuse.</p>
                  <p><strong>30. Withdrawal and refunds.</strong> The Consumer Wallet is not a savings or withdrawal facility, and a Customer cannot withdraw the wallet balance as cash at will. Refunds and adjustments to the wallet are instead governed as follows:
                    <br />(a) Promotional credits, cashback, and referral benefits credited under clause 29 are non-refundable and non-withdrawable under all circumstances.
                    <br />(b) Goodwill credits under clause 28 are non-refundable, unless the Company expressly states otherwise at the time such credit is given.
                    <br />(c) Where a transaction fails, is duplicated, or is otherwise erroneously debited, the affected amount will be refunded to the original payment method or credited back to the Consumer Wallet, in accordance with the Company&apos;s refund process.
                    <br />(d) Where a refund is required under Applicable Law, it will be processed as required by that law.
                    <br />(e) Upon closure of a Consumer Wallet or the associated account, any genuine paid-in balance remaining, after adjustment of dues owed to the Company and exclusion of any promotional or goodwill credit, will be refunded to the original payment method, subject to verification of the Customer&apos;s identity.
                  </p>
                  <p><strong>31. Validity.</strong> Amounts in the Consumer Wallet are valid for 365 days from the date of the last transaction. Before a wallet is classified as dormant on that basis, the Company will notify the Customer and provide a further reasonable period to use the balance or request a refund of the paid-in balance in accordance with clause 30, before any lapse takes effect.</p>
                  <p><strong>32. Account Security.</strong> The Customer is responsible for the confidentiality of their account credentials. All activity through the account is deemed authorised unless the Company is promptly notified of unauthorised access.</p>
                  <p><strong>33.</strong> The Company may suspend, restrict, or close a wallet where fraud, misuse, or unlawful activity is suspected, or where required by Applicable Law or a competent authority.</p>
                </div>
              </section>

              {/* DATA PROTECTION, IP, FORCE MAJEURE & TERMINATION */}
              <section>
                <h3 className="text-lg font-bold text-navy">FINAL PROVISIONS</h3>
                <div className="mt-3 space-y-3">
                  <p><strong>34. Data Protection.</strong> Personal data is collected and processed in accordance with the Digital Personal Data Protection Act, 2023 and the Shifter Online Privacy Policy for Customers, available on the Application.</p>
                  <p><strong>35. Intellectual Property.</strong> All intellectual property in the Application, including the “Shifter Online” mark, belongs to the Company. Use of the Application grants no licence beyond what is needed to use it as intended.</p>
                  <p><strong>36. Force Majeure.</strong> The Company is not liable for any failure or delay in performance of its obligations under these Terms caused by circumstances beyond its reasonable control, including act of God, fire, flood, earthquake, or other natural disaster; epidemic or pandemic; war, invasion, act of foreign enemies, or terrorism; strike, lockout, or other industrial action; riot, civil commotion, or breakdown of public order; act, order, or restriction of any government or regulatory authority; and failure of telecommunications, internet, or payment-network infrastructure not attributable to the Company. Where such an event continues for more than 30 days, either party may treat any affected booking as cancelled without penalty.</p>
                  <p><strong>37. Severability.</strong> If any provision of these Terms is found by a court or tribunal of competent jurisdiction to be invalid, illegal, or unenforceable, that provision will be severed, and the remaining provisions of these Terms will continue in full force and effect.</p>
                  <p><strong>38. Termination.</strong> The Company may terminate or suspend a Customer&apos;s account at its discretion, with or without cause. Clauses 8 (Governing Law and Dispute Resolution), 9–11 (Claims and Liability), 18 (Reverse Liability for Mis-declaration), 24 (No Vicarious Liability for Driver-Partner Conduct), and this clause survive termination.</p>
                  <p><strong>39. Indemnity.</strong> The Customer indemnifies the Company against any claim, loss, or expense arising from the Customer&apos;s breach of these Terms, violation of Applicable Law, or dispute with a Driver-Partner arising from a booking, to the extent permitted under Applicable Law.</p>
                </div>
              </section>
            </div>
          )}

          {/* ========================================================== */}
          {/* TAB 2: DRIVER-PARTNERS TERMS */}
          {/* ========================================================== */}
          {activeTab === 'drivers' && (
            <div className="space-y-7 text-[15px] leading-relaxed text-ink/85">
              <div>
                <span className="text-xs font-extrabold uppercase tracking-widest text-orange">
                  Driver-Partner Service Agreement
                </span>
                <h2 className="mt-1 text-2xl font-extrabold text-navy sm:text-3xl">
                  TERMS OF USE — DRIVER-PARTNERS
                </h2>
                <p className="mt-1 text-xs text-muted">
                  Shifter Partner — operated by Movigo Logistic Aggregator Private Limited · Last updated: 01 October 2025
                </p>
              </div>

              <div className="rounded-2xl border border-line bg-[#F8FAFC] p-5">
                <p>
                  These Terms of Use (“Terms”) govern access to and use of the “Shifter Partner” driver application (the “Application”) by Driver-Partners, operated by <strong>Movigo Logistic Aggregator Private Limited</strong> (“Company”, “Shifter Online”, “we”, “us”), a company incorporated under the Companies Act, 2013, <strong>CIN U52219MP2025PTC079643</strong>, registered office at 52–53 New Khijrabad Colony, Khajrana, Indore, Madhya Pradesh 452016. These Terms are to be read together with the Shifter Online Privacy Policy for Driver-Partners. Customers are governed by a separate Terms of Use for Customers.
                </p>
                <p className="mt-3">
                  By using the Application, you agree to be bound by these Terms. If you do not agree, uninstall the Application and discontinue use.
                </p>
              </div>

              {/* GENERAL TERMS AND CONDITIONS */}
              <section>
                <h3 className="text-lg font-bold text-navy">GENERAL TERMS AND CONDITIONS</h3>
                <div className="mt-3 space-y-3">
                  <p><strong>1. No guarantee of orders or earnings; access only.</strong> The Company does not guarantee, warrant, or assure any Driver-Partner of receiving orders or a minimum volume of work. The Application is a technology platform that facilitates a connection between Driver-Partners and Customers; any order is subject entirely to real-time availability. All fees charged by the Company — whether described as a Platform Fee, commission, or subscription charge (including under any Super Driver Membership or Premium Driver Subscription) — are charged solely for access to the Application and its matching functionality, and are not, and must not be construed as, a guarantee of orders, earnings, or any particular volume or frequency of use.</p>
                  <p><strong>2. No employer-employee relationship.</strong> Nothing in these Terms, and nothing arising from a Driver-Partner&apos;s registration, use of the Application, or receipt of orders through it, creates any relationship of employer and employee, master and servant, principal and agent, or partnership between the Company and the Driver-Partner. A Driver-Partner is at all times an independent contractor, operating their own vehicle and business, responsible for their own taxes, licences, insurance, and statutory compliance. The Company does not control the manner, means, hours, or method by which a Driver-Partner performs transportation services, beyond what is necessary to operate the matching platform itself.</p>
                  <p><strong>3. Eligibility and Registration.</strong> A Driver-Partner must, at the time of registration and at all times thereafter, be at least 18 years of age and provide, and keep current: a valid driving licence appropriate to the vehicle category; the vehicle&apos;s registration certificate, fitness certificate, permit (where applicable), insurance, and PUC certificate; and such KYC documentation (PAN, Aadhaar, or other valid government-issued photo identity document) as the Company may require. The Company will exercise reasonable care in verifying documents submitted at registration, but is not obliged to independently investigate their authenticity beyond such reasonable verification, and may rely on the documents as submitted. The Company may refuse, suspend, or revoke registration where a document is incomplete, expired, or inauthentic, or where eligibility criteria are not met, without being obliged to provide reasons.</p>
                  <p><strong>4. Plans and pricing — Company&apos;s discretion.</strong> The Company may, at its sole discretion and without prior notice, introduce a new plan, subscription tier, or pricing structure; modify or vary the terms, benefits, or pricing of any existing plan; or discontinue any plan altogether. Any such change takes effect immediately upon being reflected on the Application, and does not affect a subscription cycle already paid for before the change took effect. Continued use of the Application after a change constitutes acceptance of it, and Driver-Partners are responsible for checking the Application for the current terms of any plan they are enrolled in.</p>
                  <p><strong>5. Nature of the Company&apos;s role.</strong> The Company is a technology intermediary that connects Driver-Partners with Customers for the transportation of goods. The Company owns no vehicles and is not a common carrier, freight forwarder, or bailee of the Goods. As between a Driver-Partner and a Customer, the contract of carriage, where one arises, is between them alone; the Company is not a party to it.</p>
                  <p><strong>6. Amendment.</strong> The Company may vary, amend, or update these Terms at its own discretion, from time to time, by publishing the revised version on the Application. Where a change is material, the Company will make reasonable efforts to flag it on the Application at the time of posting. It remains the Driver-Partner&apos;s responsibility to check these Terms periodically. Continued use of the Application after any amendment constitutes acceptance of the amended Terms.</p>
                  <p><strong>7. Statutory Taxes.</strong> Driver-Partners agree that use of the Application is subject to all prevailing statutory taxes, duties, and charges as applicable from time to time, and it is each Driver-Partner&apos;s responsibility to comply with Applicable Law, including their own registration and payment of applicable taxes on income earned through the Application.</p>
                </div>
              </section>

              {/* GRIEVANCE OFFICER */}
              <section className="rounded-2xl border border-line bg-[#F8FAFC] p-5">
                <h3 className="text-lg font-bold text-navy flex items-center gap-2">
                  <UserCheck size={18} className="text-orange" />
                  GRIEVANCE OFFICER
                </h3>
                <p className="mt-2 text-xs text-muted">
                  In accordance with Rule 3(2) of the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021:
                </p>
                <div className="mt-3 space-y-1 text-sm text-ink/90">
                  <p><strong>Name:</strong> Hamid Sheikh</p>
                  <p><strong>Designation:</strong> Director</p>
                  <p><strong>Email:</strong> <a href="mailto:support@shifteronline.com" className="text-royal font-semibold hover:underline">support@shifteronline.com</a></p>
                  <p><strong>Address:</strong> 52–53 New Khijrabad Colony, Khajrana, Indore, Madhya Pradesh 452016</p>
                </div>
                <p className="mt-3 text-xs text-muted">
                  The Grievance Officer will acknowledge a complaint within 24 hours and endeavour to resolve it within 15 days.
                </p>
              </section>

              {/* GOVERNING LAW AND DISPUTE RESOLUTION */}
              <section>
                <h3 className="text-lg font-bold text-navy">GOVERNING LAW AND DISPUTE RESOLUTION</h3>
                <p className="mt-2">
                  <strong>9.</strong> These Terms are governed by the laws of India. Subject to clause 8 above, the courts at Indore, Madhya Pradesh have exclusive jurisdiction over any dispute arising out of or in connection with these Terms or use of the Application. There is no arbitration clause and no other forum applies.
                </p>
              </section>

              {/* DRIVER-PARTNER OBLIGATIONS & LIABILITY */}
              <section>
                <h3 className="text-lg font-bold text-navy">DRIVER-PARTNER OBLIGATIONS &amp; LIABILITY</h3>
                <div className="mt-3 space-y-3">
                  <p><strong>10. Statutory compliance.</strong> Each Driver-Partner must, at all times: hold a valid driving licence and vehicle registration, fitness certificate, permit (where applicable), insurance, and PUC certificate for the vehicle used; hold any licence required by Applicable Law for the goods category carried; handle Goods with reasonable care; and comply with traffic law and load limits.</p>
                  <p><strong>11. No vicarious liability; Driver-Partner&apos;s direct liability to Customer.</strong> The Driver-Partner is an independent contractor and not an employee or agent of the Company. As between the Driver-Partner and the Customer, the Driver-Partner is directly and solely liable for any act, omission, negligence, accident, theft, or misconduct occurring during the performance of transportation services, and for any loss of or damage to Goods caused by the Driver-Partner&apos;s own conduct. The Company bears no liability for such conduct, except to the extent it arises directly from the Company&apos;s own negligence in the document verification under clause 3. The Driver-Partner indemnifies the Company against any claim, loss, or expense arising from the Driver-Partner&apos;s breach of these Terms, violation of Applicable Law, or dispute with a Customer arising from a booking.</p>
                </div>
              </section>

              {/* CASH PAYMENTS, CANCELLATION & ACCESS */}
              <section>
                <h3 className="text-lg font-bold text-navy">PAYMENTS, CANCELLATIONS &amp; ACCESS</h3>
                <div className="mt-3 space-y-3">
                  <p><strong>12. Cash Payments.</strong> Where a Customer opts for cash payment, the Driver-Partner must collect the full amount shown on the Application on completion of service; such amount is deemed received on the Company&apos;s behalf. The Driver-Partner must not demand or accept any amount beyond what is shown on the Application without the Customer&apos;s voluntary consent. Any shortfall or discrepancy reported by a Customer may result in an adjustment against the Driver-Partner&apos;s payment cycle, additional charges, or suspension of the Driver-Partner&apos;s account, at the Company&apos;s discretion.</p>
                  <p><strong>13. Cancellation by the Driver-Partner.</strong> Where a Driver-Partner cancels a confirmed booking, the Driver-Partner is liable to pay a cancellation charge, calculated with reference to the distance already covered by the Driver-Partner toward the pickup location and the category of vehicle assigned to the booking. The applicable cancellation amount will be deducted from the Driver-Partner&apos;s next payment cycle. Where the Customer cancels a confirmed booking instead, the cancellation amount payable by the Customer is deducted from the Customer&apos;s advance payment under the Terms of Use for Customers, and does not by itself entitle the Driver-Partner to any payment unless the Company decides otherwise.</p>
                  <p><strong>14. Blocking of Access.</strong> The Company may immediately suspend or terminate a Driver-Partner&apos;s account, without prior notice, where it reasonably believes there has been fraud, a safety risk, or a breach of Applicable Law. In any other case, the Company retains sole discretion to suspend or terminate an account, and will, where reasonably practicable, make an effort to inform the Driver-Partner of the reason.</p>
                </div>
              </section>

              {/* DRIVER WALLET */}
              <section>
                <h3 className="text-lg font-bold text-navy">DRIVER WALLET</h3>
                <div className="mt-3 space-y-3">
                  <p><strong>15. Ledger display only.</strong> The Driver Wallet is a ledger display only. All Driver-Partner earnings are collected and settled by Razorpay Software Private Limited, or such other RBI-authorised Payment Aggregator engaged by the Company, split at source directly to the Driver-Partner&apos;s linked or sub-merchant account. The Company&apos;s own bank account is at no point in this flow of funds. The Company is not a custodian of Driver-Partner earnings and cannot freeze, redirect, or otherwise control any amount reflected in the Driver Wallet. Any dispute over settlement timing or amount must be raised with the Payment Aggregator; the Company&apos;s role is limited to facilitation.</p>
                  <p><strong>16. Wallet indemnity.</strong> The Driver-Partner indemnifies the Company against loss arising from the Driver-Partner&apos;s breach of these Terms, breach of Applicable Law, or the Driver-Partner&apos;s own fraud, negligence, or misrepresentation in connection with the Driver Wallet. The Company is not liable for loss arising from the Driver-Partner&apos;s failure to protect their own credentials, network failure, technical interruption, phishing, or any event beyond the Company&apos;s reasonable control.</p>
                  <p><strong>17. General limitation of liability.</strong> For any claim against the Company not covered by clause 11 — including technical malfunction, delay in the Application, or a wallet-related discrepancy — the Company&apos;s total aggregate liability to a Driver-Partner shall not exceed ₹500 (Rupees Five Hundred), except to the extent such liability cannot be excluded under Applicable Law, including liability arising from the Company&apos;s own fraud or wilful misconduct.</p>
                </div>
              </section>

              {/* DATA PROTECTION, IP, FORCE MAJEURE & TERMINATION */}
              <section>
                <h3 className="text-lg font-bold text-navy">FINAL PROVISIONS</h3>
                <div className="mt-3 space-y-3">
                  <p><strong>18. Account Security.</strong> The Driver-Partner is responsible for the confidentiality of their account credentials. All activity through the account is deemed authorised unless the Company is promptly notified of unauthorised access.</p>
                  <p><strong>19. Data Protection.</strong> Personal data is collected and processed in accordance with the Digital Personal Data Protection Act, 2023 and the Shifter Online Privacy Policy for Driver-Partners, available on the Application.</p>
                  <p><strong>20. Intellectual Property.</strong> All intellectual property in the Application, including the “Shifter Online” and “Shifter Partner” marks, belongs to the Company. Use of the Application grants no licence beyond what is needed to use it as intended.</p>
                  <p><strong>21. Force Majeure.</strong> The Company is not liable for any failure or delay in performance of its obligations under these Terms caused by circumstances beyond its reasonable control, including act of God, fire, flood, earthquake, or other natural disaster; epidemic or pandemic; war, invasion, act of foreign enemies, or terrorism; strike, lockout, or other industrial action; riot, civil commotion, or breakdown of public order; act, order, or restriction of any government or regulatory authority; and failure of telecommunications, internet, or payment-network infrastructure not attributable to the Company.</p>
                  <p><strong>22. Severability.</strong> If any provision of these Terms is found by a court or tribunal of competent jurisdiction to be invalid, illegal, or unenforceable, that provision will be severed, and the remaining provisions of these Terms will continue in full force and effect.</p>
                  <p><strong>23. Termination and Survival.</strong> The Company may terminate or suspend a Driver-Partner&apos;s account at its discretion, with or without cause. Clauses 9 (Governing Law and Dispute Resolution), 11 (No Vicarious Liability; Driver-Partner&apos;s Direct Liability to Customer), 16 (Wallet Indemnity), 17 (General Limitation of Liability), and this clause survive termination.</p>
                  <p><strong>24. Indemnity.</strong> The Driver-Partner indemnifies the Company against any claim, loss, or expense arising from the Driver-Partner&apos;s breach of these Terms, violation of Applicable Law, or dispute with a Customer arising from a booking, to the extent permitted under Applicable Law.</p>
                </div>
              </section>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
