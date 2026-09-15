import { useEffect, useState, type FormEvent } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  ArrowLeftRight,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  Moon,
  Package as PackageIcon,
  Phone,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { ScrollReveal } from '../components/ui/ScrollReveal';
import { Button } from '../components/ui/Button';
import { LocationAutocompleteInput } from '../components/estimate/LocationAutocompleteInput';
import { RouteMap } from '../components/estimate/RouteMap';
import type { LayoutContext } from '../components/Layout';
import { cities, getCategoryIcon, getCategoryImageUrl, getFallbackVehicleImage } from '../lib/estimate';
import { getRouteEstimate, type RouteResult, type SelectedPlace } from '../lib/route';
import {
  api,
  ApiError,
  type CategoryItem,
  type FareEstimateResponse,
  type PackageEstimateItem,
  type CreateOrderResponse,
} from '../lib/api';

const inputClass =
  'flex w-full items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 focus-within:border-navy focus-within:ring-1 focus-within:ring-navy/20 transition-all';
const fieldTextClass = 'w-full bg-transparent text-[15px] text-ink placeholder:text-muted focus:outline-none';

const RADIUS_OPTIONS = [
  { value: 3, label: '3 km', desc: 'Local driver search radius' },
  { value: 5, label: '5 km (Recommended)', desc: 'Standard driver search radius' },
  { value: 10, label: '10 km', desc: 'Wider driver search radius' },
  { value: 15, label: '15 km', desc: 'Extended driver search radius' },
];

const GOODS_CATEGORIES = [
  'House Shifting / Furniture',
  'Electronics & Appliances',
  'Commercial Goods / Cartons',
  'Loose Goods / Parcels',
  'Building Materials',
  'Other / General Parcel',
];

const FLOW_STEPS = [
  { step: 1, title: 'Pickup' },
  { step: 2, title: 'Drop' },
  { step: 3, title: 'Search Radius' },
  { step: 4, title: 'Vehicle Categories' },
  { step: 5, title: 'Vehicle Models' },
  { step: 6, title: 'Select Model' },
  { step: 7, title: 'Exact Price' },
  { step: 8, title: 'Book Order' },
];

function samePlace(a: SelectedPlace, b: SelectedPlace): boolean {
  if (a.placeId && b.placeId) return a.placeId === b.placeId;
  return Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5;
}

function VehicleCategoryCard({
  cat,
  isSelected,
  onSelect,
  showSelectAction = false,
}: {
  cat: CategoryItem;
  isSelected: boolean;
  onSelect: (catId: number) => void;
  showSelectAction?: boolean;
}) {
  const fallbackImg = getFallbackVehicleImage(cat.cat_name);
  const initialImg = cat.cat_img ? getCategoryImageUrl(cat.cat_img) || fallbackImg : fallbackImg;
  const [imgSrc, setImgSrc] = useState<string>(initialImg);

  useEffect(() => {
    const primary = cat.cat_img ? getCategoryImageUrl(cat.cat_img) || fallbackImg : fallbackImg;
    setImgSrc(primary);
  }, [cat.cat_img, cat.cat_name, fallbackImg]);

  const catCapacity = (cat as any).capacity || (cat as any).payload || null;

  return (
    <button
      type="button"
      onClick={() => onSelect(cat.id)}
      className={`group relative flex flex-col items-center justify-between rounded-2xl border p-4 text-center transition-all duration-200 cursor-pointer overflow-hidden ${
        isSelected
          ? 'border-navy bg-gradient-to-b from-navy/5 to-white ring-2 ring-navy/30 shadow-md font-bold'
          : 'border-line bg-white hover:border-navy/50 hover:shadow-soft'
      }`}
    >
      {isSelected && (
        <div className="absolute top-2.5 right-2.5 rounded-full bg-navy text-white p-1 shadow-xs z-10 flex items-center justify-center">
          <CheckCircle2 size={14} />
        </div>
      )}

      {/* Render capacity tag ONLY if backend response provides it */}
      {catCapacity ? (
        <div className="mb-2 self-start rounded-md bg-navy/10 px-2 py-0.5 text-[10px] font-bold text-navy border border-navy/10">
          {catCapacity}
        </div>
      ) : null}

      {/* Vehicle Image Container */}
      <div className="relative my-1 flex h-24 w-full items-center justify-center rounded-xl bg-slate-50 p-2 border border-line/60 overflow-hidden shadow-inner group-hover:scale-[1.03] transition-transform duration-200">
        <img
          src={imgSrc}
          alt={cat.cat_name}
          className="h-full w-full object-contain drop-shadow-sm"
          onError={() => {
            if (imgSrc !== fallbackImg) {
              setImgSrc(fallbackImg);
            }
          }}
        />
      </div>

      {/* Category Name */}
      <div className="mt-2 w-full text-center">
        <div className="text-sm font-extrabold text-ink group-hover:text-navy transition-colors">
          {cat.cat_name}
        </div>
      </div>

      {/* Action Badge */}
      <div className="mt-3 w-full">
        <span
          className={`block w-full rounded-xl py-1.5 text-center text-xs font-bold transition-all ${
            isSelected
              ? 'bg-navy text-white shadow-xs'
              : 'bg-offwhite text-navy group-hover:bg-navy group-hover:text-white'
          }`}
        >
          {isSelected ? '✓ Selected' : showSelectAction ? 'Select Category →' : 'Choose Vehicle'}
        </span>
      </div>
    </button>
  );
}

export function GetEstimate() {
  const { openSignup } = useOutletContext<LayoutContext>();

  // STEP Tracker (1 to 8)
  const [currentStep, setCurrentStep] = useState<number>(1);

  // Dynamic backend categories state (Loaded via GET /api/order/categories)
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [selectedCatId, setSelectedCatId] = useState<number | null>(null);
  const [categoriesLoading, setCategoriesLoading] = useState(true);

  // STEP 1: Pickup Location & Coordinates
  const [pickupText, setPickupText] = useState('');
  const [pickupPlace, setPickupPlace] = useState<SelectedPlace | null>(null);
  const [pickupHno, setPickupHno] = useState('');
  const [pickupLandmark, setPickupLandmark] = useState('');
  const [pickName, setPickName] = useState('');
  const [pmobile, setPmobile] = useState('');

  // STEP 2: Drop Location & Coordinates
  const [dropText, setDropText] = useState('');
  const [dropPlace, setDropPlace] = useState<SelectedPlace | null>(null);
  const [dropHno, setDropHno] = useState('');
  const [dropLandmark, setDropLandmark] = useState('');
  const [dropName, setDropName] = useState('');
  const [dmobile, setDmobile] = useState('');

  // STEP 3: Search Radius & Booking Options
  const [radiusKm, setRadiusKm] = useState<number>(5);
  const [city, setCity] = useState(cities[0] || 'Indore');
  const [bookingType, setBookingType] = useState<number>(1); // 1 = Instant, 3 = Schedule Later
  const [goodsCategory, setGoodsCategory] = useState<string>(GOODS_CATEGORIES[0]);
  const [approxWeight, setApproxWeight] = useState<string>('5.0');

  // STEP 5 & 6: Selected Vehicle Model
  const [selectedModelPkg, setSelectedModelPkg] = useState<PackageEstimateItem | null>(null);

  // STEP 7 & 8: Backend Result State (Calculated by Render Backend pricingEngine)
  const [result, setResult] = useState<{
    route: RouteResult;
    city: string;
    estimate: FareEstimateResponse;
    packages: PackageEstimateItem[];
  } | null>(null);

  // STEP 9: Booking Confirmation State
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState<CreateOrderResponse | null>(null);

  // UI status state
  const [error, setError] = useState<string | null>(null);
  const [mapsUnavailable, setMapsUnavailable] = useState(false);
  const [loading, setLoading] = useState(false);

  // 1. Load active categories dynamically from Render Backend API on mount (STEP 4 prerequisite)
  useEffect(() => {
    let mounted = true;
    async function loadCategories() {
      try {
        const res = await api.getCategories();
        if (mounted && res && Boolean(res.Result) && Array.isArray(res.categories) && res.categories.length > 0) {
          setCategories(res.categories);
          if (!selectedCatId) {
            setSelectedCatId(res.categories[0].id);
          }
        }
      } catch (err) {
        console.warn('Backend categories fetch warning, using active vehicle categories:', err);
      } finally {
        if (mounted) setCategoriesLoading(false);
      }
    }
    loadCategories();
    return () => {
      mounted = false;
    };
  }, []);

  const swapLocations = () => {
    const prevPickupText = pickupText;
    const prevPickupPlace = pickupPlace;
    const prevPickupHno = pickupHno;
    const prevPickupLandmark = pickupLandmark;
    const prevPickName = pickName;
    const prevPmobile = pmobile;

    setPickupText(dropText);
    setPickupPlace(dropPlace);
    setPickupHno(dropHno);
    setPickupLandmark(dropLandmark);
    setPickName(dropName);
    setPmobile(dmobile);

    setDropText(prevPickupText);
    setDropPlace(prevPickupPlace);
    setDropHno(prevPickupHno);
    setDropLandmark(prevPickupLandmark);
    setDropName(prevPickName);
    setDmobile(prevPmobile);
  };

  // STEP 5: Fetch Available Vehicle Models & Rates for Chosen Category via Render Backend
  const fetchEstimateForCategory = async (
    catId: number,
    pPlace: SelectedPlace,
    dPlace: SelectedPlace,
    radius: number
  ) => {
    const route = await getRouteEstimate(pPlace, dPlace);
    const fareRes = await api.getFareEstimate({
      cat_id: catId,
      plat: pPlace.lat,
      plong: pPlace.lng,
      dlat: dPlace.lat,
      dlong: dPlace.lng,
      radius_km: radius,
    });
    return { route, fareRes };
  };

  // STEP 4 -> STEP 5 Transition
  const handleSelectCategory = async (catId: number) => {
    if (!pickupPlace || !dropPlace) {
      setError('Please select Pickup and Drop locations first.');
      return;
    }
    setSelectedCatId(catId);
    setSelectedModelPkg(null);
    setLoading(true);
    setError(null);

    try {
      const { route, fareRes } = await fetchEstimateForCategory(catId, pickupPlace, dropPlace, radiusKm);
      setResult({
        route,
        city,
        estimate: fareRes,
        packages: fareRes.packages || [],
      });
      setCurrentStep(5);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to calculate fare estimate right now.');
    } finally {
      setLoading(false);
    }
  };

  // STEP 6 -> STEP 7 & 8 Transition: Model Selection & Exact Price Confirmation
  const handleSelectModel = (pkg: PackageEstimateItem) => {
    setSelectedModelPkg(pkg);
    setCurrentStep(7); // Advance to STEP 7 & 8: Price Confirmation
  };

  // STEP 1 -> STEP 2 Validation
  const handleNextFromPickup = () => {
    setError(null);
    if (!pickupText.trim() || !pickupPlace) {
      setError('Please select a valid Pickup Location from suggestions.');
      return;
    }
    setCurrentStep(2);
  };

  // STEP 2 -> STEP 3 Validation
  const handleNextFromDrop = () => {
    setError(null);
    if (!dropText.trim() || !dropPlace) {
      setError('Please select a valid Drop Location from suggestions.');
      return;
    }
    if (samePlace(pickupPlace!, dropPlace)) {
      setError('Pickup and drop locations cannot be the same.');
      return;
    }
    setCurrentStep(3);
  };

  // STEP 3 -> STEP 4 Validation
  const handleNextFromRadius = () => {
    setError(null);
    setCurrentStep(4);
  };

  // STEP 9: Final Order Booking Submission via Render Backend (POST /api/order/create)
  const handleConfirmOrder = async (e: FormEvent) => {
    e.preventDefault();
    if (!pickupPlace || !dropPlace || !selectedModelPkg) return;
    if (!pmobile.trim() || !/^[6-9]\d{9}$/.test(pmobile.trim())) {
      setError('Please enter a valid 10-digit Sender mobile number.');
      return;
    }

    const currentCatName = categories.find((c) => c.id === selectedCatId)?.cat_name || 'Vehicle';

    setBookingSubmitting(true);
    setError(null);
    try {
      const payload = {
        category: currentCatName,
        delivery_type: [selectedModelPkg.package_id],
        booking_type: bookingType,
        plat: pickupPlace.lat,
        plong: pickupPlace.lng,
        paddress: pickupHno ? `${pickupHno}, ${pickupText}` : pickupText,
        pick_name: pickName || 'Website Customer',
        pmobile: pmobile.trim(),
        dlat: dropPlace.lat,
        dlong: dropPlace.lng,
        daddress: dropHno ? `${dropHno}, ${dropText}` : dropText,
        drop_name: dropName || 'Receiver',
        dmobile: dmobile.trim() || pmobile.trim(),
        package_weight: approxWeight || '5.0',
        radius_km: radiusKm,
      };

      const res = await api.createOrder(payload);
      if (res.Result === 'true' || res.Result === true) {
        setBookingSuccess(res);
        setCurrentStep(9);
      } else {
        setError(res.msg || res.message || 'Order creation failed. Please try again.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to place booking order on Render backend.');
    } finally {
      setBookingSubmitting(false);
    }
  };

  const currentCategoryName = categories.find((c) => c.id === selectedCatId)?.cat_name || 'Vehicle';

  return (
    <main>
      <section className="relative overflow-hidden pt-36 pb-16 md:pt-44">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[#EEF3FC] via-white to-white" />
        <div className="absolute inset-0 -z-10 bg-grid-fade" />

        <div className="container-shifter">
          <ScrollReveal className="mx-auto max-w-4xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-xs font-semibold tracking-wide text-navy shadow-soft">
              <Sparkles size={13} className="text-orange" />
              OFFICIAL FARE ESTIMATE & BOOKING ENGINE
            </span>
            <h1 className="mt-5 text-balance text-[32px] font-extrabold leading-[1.15] text-ink sm:text-[44px]">
              Shifter Online <span className="text-orange">Fixed Booking Flow</span>
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-muted max-w-2xl mx-auto">
              Follow our exact 9-step booking sequence — powered live by our Render Backend pricing engine (`pricingEngine`).
            </p>
          </ScrollReveal>

          {/* 9-STEP SEQUENTIAL PROGRESS BAR */}
          <div className="mx-auto mt-8 max-w-4xl overflow-x-auto pb-2">
            <div className="flex items-center justify-between min-w-[650px] rounded-2xl border border-line bg-white p-3 shadow-soft">
              {FLOW_STEPS.map((s, idx) => {
                const isActive = currentStep === s.step;
                const isCompleted = currentStep > s.step;
                return (
                  <div key={s.step} className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        if (isCompleted) setCurrentStep(s.step);
                      }}
                      disabled={!isCompleted && !isActive}
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-all ${
                        isActive
                          ? 'bg-navy text-white shadow-xs'
                          : isCompleted
                          ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 cursor-pointer'
                          : 'bg-offwhite text-muted cursor-not-allowed'
                      }`}
                    >
                      <span
                        className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${
                          isActive ? 'bg-white text-navy font-extrabold' : isCompleted ? 'bg-emerald-600 text-white' : 'bg-line text-muted'
                        }`}
                      >
                        {isCompleted ? '✓' : s.step}
                      </span>
                      <span>{s.title}</span>
                    </button>
                    {idx < FLOW_STEPS.length - 1 && (
                      <ChevronRight size={12} className="text-muted/40 shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <ScrollReveal delay={0.1} className="mx-auto mt-6 max-w-3xl rounded-2xl border border-line bg-white p-6 shadow-card sm:p-8">
            {mapsUnavailable && (
              <p className="mb-4 rounded-lg bg-offwhite px-3 py-2 text-xs font-medium text-muted">
                Location search is temporarily unavailable. Please try again shortly.
              </p>
            )}

            {error && (
              <div className="mb-5 rounded-xl bg-orange/10 border border-orange/20 p-3.5 text-xs font-semibold text-orange flex items-center justify-between">
                <span>{error}</span>
                <button type="button" onClick={() => setError(null)} className="text-orange hover:text-ink">
                  <X size={14} />
                </button>
              </div>
            )}

            {/* STEP 1 — PICKUP LOCATION & MAIN FORM */}
            {currentStep === 1 && (
              <div className="flex flex-col gap-5">
                <div className="flex items-center justify-between border-b border-line pb-3">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-navy">Step 1 of 9</span>
                    <h2 className="text-xl font-extrabold text-ink">Select Pickup Location & Vehicle Category</h2>
                  </div>
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-navy/10 text-navy font-bold text-sm">
                    1
                  </span>
                </div>

                {/* City Selection */}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">
                    Select City
                  </label>
                  <label className={inputClass}>
                    <Building2 size={17} className="shrink-0 text-muted" />
                    <select
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className={`${fieldTextClass} appearance-none`}
                    >
                      {cities.map((c) => (
                        <option key={c} value={c} className="text-ink">
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {/* VEHICLE CATEGORIES SELECTION BOXES (Visible on Step 1) */}
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted flex items-center justify-between">
                    <span>Select Vehicle Category (Loaded Live from Render Backend)</span>
                    <span className="text-navy font-bold">{currentCategoryName} Selected</span>
                  </label>

                  {categoriesLoading ? (
                    <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted">
                      <Loader2 size={16} className="animate-spin text-navy" /> Fetching categories from Render Backend...
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {categories.map((cat) => (
                        <VehicleCategoryCard
                          key={cat.id}
                          cat={cat}
                          isSelected={selectedCatId === cat.id}
                          onSelect={(catId) => {
                            setSelectedCatId(catId);
                            setError(null);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Pickup Location */}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">
                    Pickup Location (Select & Obtain Coordinates)
                  </label>
                  <label className={inputClass}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-navy" />
                    <LocationAutocompleteInput
                      value={pickupText}
                      onTextChange={setPickupText}
                      onPlaceSelected={(place) => {
                        setPickupPlace(place);
                        setError(null);
                      }}
                      onLoadError={() => setMapsUnavailable(true)}
                      placeholder="Search pickup address, area, or landmark..."
                      className={fieldTextClass}
                    />
                  </label>
                </div>

                {pickupPlace && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-xs font-medium text-emerald-800 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                      Coordinates Captured: [{pickupPlace.lat.toFixed(5)}, {pickupPlace.lng.toFixed(5)}]
                    </span>
                    <span className="font-bold text-emerald-900">Step 1 Ready</span>
                  </div>
                )}

                <Button size="lg" onClick={handleNextFromPickup} className="mt-2 w-full">
                  Proceed to Step 2: Drop Location →
                </Button>
              </div>
            )}

            {/* STEP 2 — DROP LOCATION */}
            {currentStep === 2 && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-line pb-3">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-orange">Step 2 of 8</span>
                    <h2 className="text-xl font-extrabold text-ink">Enter Drop Location</h2>
                  </div>
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-orange/10 text-orange font-bold text-sm">
                    2
                  </span>
                </div>

                <div className="rounded-xl border border-line bg-offwhite p-3 text-xs text-muted">
                  <strong>Pickup:</strong> {pickupText} [{pickupPlace?.lat.toFixed(4)}, {pickupPlace?.lng.toFixed(4)}]
                </div>

                <div className="relative">
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">
                    Drop Location (Select & Obtain Coordinates)
                  </label>
                  <label className={inputClass}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-orange" />
                    <LocationAutocompleteInput
                      value={dropText}
                      onTextChange={setDropText}
                      onPlaceSelected={(place) => {
                        setDropPlace(place);
                        setError(null);
                      }}
                      onLoadError={() => setMapsUnavailable(true)}
                      placeholder="Search drop address, area, or landmark..."
                      className={fieldTextClass}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={swapLocations}
                    aria-label="Swap locations"
                    className="absolute right-3 top-9 grid h-8 w-8 place-items-center rounded-full border border-line bg-white text-muted shadow-soft transition-colors hover:text-royal"
                  >
                    <ArrowLeftRight size={14} className="rotate-90" />
                  </button>
                </div>

                {dropPlace && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-xs font-medium text-emerald-800 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                      Coordinates Captured: [{dropPlace.lat.toFixed(5)}, {dropPlace.lng.toFixed(5)}]
                    </span>
                    <span className="font-bold text-emerald-900">Step 2 Ready</span>
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <Button variant="secondary" onClick={() => setCurrentStep(1)} className="w-1/3">
                    ← Back
                  </Button>
                  <Button size="lg" onClick={handleNextFromDrop} className="w-2/3">
                    Proceed to Step 3: Search Radius →
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 3 — SEARCH RADIUS */}
            {currentStep === 3 && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-line pb-3">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-navy">Step 3 of 9</span>
                    <h2 className="text-xl font-extrabold text-ink">Select Driver Search Radius</h2>
                  </div>
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-navy/10 text-navy font-bold text-sm">
                    3
                  </span>
                </div>

                <div className="rounded-xl border border-line bg-offwhite p-3.5 text-xs text-muted space-y-1">
                  <div>📍 <strong>Pickup:</strong> {pickupText}</div>
                  <div>🎯 <strong>Drop:</strong> {dropText}</div>
                  <div className="text-[11px] text-navy font-semibold pt-1">
                    ℹ️ Note: Search Radius is your search input. The corresponding <strong>Radius Charge</strong> is NOT hardcoded or calculated on frontend — it is returned dynamically by Render Backend `pricingEngine`.
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {RADIUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setRadiusKm(opt.value)}
                      className={`rounded-xl border p-3 text-center transition-all ${
                        radiusKm === opt.value
                          ? 'border-navy bg-navy text-white shadow-xs font-semibold'
                          : 'border-line bg-white text-ink hover:border-muted'
                      }`}
                    >
                      <div className="text-sm font-bold">{opt.label}</div>
                      <div className={`text-[10px] mt-0.5 ${radiusKm === opt.value ? 'text-white/80' : 'text-muted'}`}>
                        {opt.desc}
                      </div>
                    </button>
                  ))}
                </div>

                {/* Booking Options, Goods Category & Approx Weight */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 pt-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">
                      Booking Option
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setBookingType(1)}
                        className={`flex-1 rounded-xl border p-2.5 text-center text-xs font-bold transition-all ${
                          bookingType === 1 ? 'border-navy bg-navy/10 text-navy' : 'border-line text-muted'
                        }`}
                      >
                        <Clock size={13} className="inline mr-1" /> Ride Now
                      </button>
                      <button
                        type="button"
                        onClick={() => setBookingType(3)}
                        className={`flex-1 rounded-xl border p-2.5 text-center text-xs font-bold transition-all ${
                          bookingType === 3 ? 'border-orange bg-orange/10 text-orange' : 'border-line text-muted'
                        }`}
                      >
                        <Calendar size={13} className="inline mr-1" /> Schedule
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">
                      Goods Category
                    </label>
                    <label className={inputClass}>
                      <PackageIcon size={15} className="shrink-0 text-muted" />
                      <select
                        value={goodsCategory}
                        onChange={(e) => setGoodsCategory(e.target.value)}
                        className={fieldTextClass}
                      >
                        {GOODS_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">
                      Approx Weight (kg)
                    </label>
                    <label className={inputClass}>
                      <input
                        type="text"
                        value={approxWeight}
                        onChange={(e) => setApproxWeight(e.target.value)}
                        placeholder="e.g. 5.0"
                        className={fieldTextClass}
                      />
                    </label>
                  </div>
                </div>

                <div className="flex gap-3 pt-3">
                  <Button variant="secondary" onClick={() => setCurrentStep(2)} className="w-1/3">
                    ← Back
                  </Button>
                  <Button size="lg" onClick={handleNextFromRadius} className="w-2/3">
                    Proceed to Step 4: Vehicle Category →
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 4 — VEHICLE CATEGORY (Dynamic from Render Backend) */}
            {currentStep === 4 && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-line pb-3">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-navy">Step 4 of 9</span>
                    <h2 className="text-xl font-extrabold text-ink">Select Vehicle Category</h2>
                  </div>
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-navy/10 text-navy font-bold text-sm">
                    4
                  </span>
                </div>

                <p className="text-xs text-muted">
                  Categories loaded live from Render Backend (`GET /api/order/categories`). Click any vehicle category box below to fetch models & rates.
                </p>

                {categoriesLoading ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted">
                    <Loader2 size={18} className="animate-spin text-navy" /> Fetching categories from Render Backend...
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {categories.map((cat) => (
                      <VehicleCategoryCard
                        key={cat.id}
                        cat={cat}
                        isSelected={selectedCatId === cat.id}
                        onSelect={(catId) => handleSelectCategory(catId)}
                        showSelectAction={true}
                      />
                    ))}
                  </div>
                )}

                <div className="pt-2 flex justify-start">
                  <Button variant="secondary" onClick={() => setCurrentStep(3)}>
                    ← Back to Radius
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 5 & 6 — VEHICLE MODELS & MODEL SELECTION */}
            {currentStep === 5 && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-line pb-3">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-orange">Steps 5 & 6 of 9</span>
                    <h2 className="text-xl font-extrabold text-ink">Select Vehicle Model for {currentCategoryName}</h2>
                  </div>
                  {loading && <Loader2 size={18} className="animate-spin text-navy" />}
                </div>

                <div className="rounded-xl border border-line bg-offwhite p-3 text-xs text-muted flex flex-wrap justify-between items-center gap-2">
                  <span>
                    <strong>Pickup:</strong> {pickupText} → <strong>Drop:</strong> {dropText} (Radius: {radiusKm} km)
                  </span>
                  <button
                    type="button"
                    onClick={() => setCurrentStep(4)}
                    className="text-navy font-bold hover:underline text-[11px]"
                  >
                    Change Category
                  </button>
                </div>

                {loading ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted">
                    <Loader2 size={18} className="animate-spin text-navy" /> Fetching model rates from Render backend (`POST /api/order/fare-estimate`)...
                  </div>
                ) : result?.packages.length === 0 ? (
                  <div className="rounded-xl border border-line bg-offwhite p-8 text-center text-xs text-muted">
                    No active models available for {currentCategoryName} at this time. Please select another category.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {result?.packages.map((pkg, i) => {
                      const CatIcon = getCategoryIcon(currentCategoryName);
                      const displayName =
                        pkg.user_title && pkg.user_title !== pkg.title && pkg.user_title !== 'undefined'
                          ? `${pkg.title} (${pkg.user_title})`
                          : pkg.title;

                      return (
                        <div
                          key={pkg.package_id || i}
                          onClick={() => handleSelectModel(pkg)}
                          className="relative flex flex-col justify-between rounded-2xl border border-line bg-white p-5 shadow-soft transition-all duration-300 hover:shadow-card hover:border-navy cursor-pointer"
                        >
                          <div>
                            <div className="flex items-start justify-between">
                              <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy text-white">
                                <CatIcon size={20} />
                              </span>
                              {pkg.is_night === 1 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-orange/10 px-2 py-0.5 text-[10px] font-bold text-orange">
                                  <Moon size={10} /> Night Surge
                                </span>
                              )}
                            </div>

                            <h3 className="mt-3 text-base font-bold text-ink">{displayName}</h3>
                            <p className="text-[11px] text-muted">Backend ID: #{pkg.package_id}</p>

                            <div className="mt-3 border-t border-line pt-3 text-xs space-y-1">
                              <div className="flex justify-between text-muted">
                                <span>Min Charge:</span>
                                <span className="font-semibold text-ink">₹{pkg.min_charge}</span>
                              </div>
                              <div className="flex justify-between text-muted">
                                <span>Per KM Charge:</span>
                                <span className="font-semibold text-ink">₹{pkg.per_km_charge}</span>
                              </div>
                              <div className="flex justify-between text-muted">
                                <span>Radius Charge:</span>
                                <span className="font-semibold text-emerald-700">₹{pkg.radius_charge}</span>
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 pt-3 border-t border-line flex items-baseline justify-between">
                            <span className="text-xl font-extrabold text-navy">₹{pkg.estimated_fare}</span>
                            <span className="inline-flex items-center text-xs font-bold text-orange">
                              Select Model →
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="pt-2 flex justify-start">
                  <Button variant="secondary" onClick={() => setCurrentStep(4)}>
                    ← Back to Categories
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 7 & 8 — EXACT ESTIMATED PRICE & PRICE CONFIRMATION */}
            {(currentStep === 7 || currentStep === 8) && selectedModelPkg && result && (
              <div className="flex flex-col gap-5">
                <div className="flex items-center justify-between border-b border-line pb-3">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Steps 7 & 8 of 9</span>
                    <h2 className="text-xl font-extrabold text-ink">Exact Price Confirmation</h2>
                  </div>
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-100 text-emerald-800 font-bold text-sm">
                    7-8
                  </span>
                </div>

                {/* EXACT ESTIMATED FARE BANNER FROM BACKEND */}
                <div className="rounded-2xl bg-navy p-6 text-white shadow-card flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">
                      Render Backend Exact Estimated Fare
                    </span>
                    <div className="text-3xl font-extrabold text-white mt-1">₹{selectedModelPkg.estimated_fare}</div>
                    <p className="text-xs text-white/80 mt-1">
                      Calculated dynamically by `pricingEngine` for {selectedModelPkg.title} ({selectedModelPkg.user_title || 'Standard'})
                    </p>
                  </div>
                  <div className="text-right text-xs text-white/80 space-y-1">
                    <div>Route Distance: <strong>{result.estimate.distance_km || result.route.distanceKm} km</strong></div>
                    <div>Est. Time: <strong>~{result.estimate.duration_min || result.route.durationMinutes} min</strong></div>
                    <div>Driver Radius: <strong>{radiusKm} km</strong></div>
                  </div>
                </div>

                {/* DYNAMIC PRICE BREAKDOWN TABLE FROM BACKEND RESPONSE */}
                <div className="rounded-xl border border-line bg-offwhite p-4 space-y-2 text-xs">
                  <h3 className="font-bold text-ink uppercase tracking-wider text-[11px] mb-2">
                    Backend Fare Breakdown
                  </h3>
                  <div className="flex justify-between border-b border-line/60 pb-2">
                    <span className="text-muted">Vehicle Category:</span>
                    <span className="font-bold text-ink">{currentCategoryName}</span>
                  </div>
                  <div className="flex justify-between border-b border-line/60 pb-2">
                    <span className="text-muted">Selected Model Name:</span>
                    <span className="font-bold text-ink">{selectedModelPkg.title} ({selectedModelPkg.user_title || 'Standard'})</span>
                  </div>
                  <div className="flex justify-between border-b border-line/60 pb-2">
                    <span className="text-muted">Base Minimum Charge:</span>
                    <span className="font-semibold text-ink">₹{selectedModelPkg.min_charge}</span>
                  </div>
                  <div className="flex justify-between border-b border-line/60 pb-2">
                    <span className="text-muted">Per-KM Charge Rate:</span>
                    <span className="font-semibold text-ink">₹{selectedModelPkg.per_km_charge} / km</span>
                  </div>
                  <div className="flex justify-between border-b border-line/60 pb-2">
                    <span className="text-muted">Radius Search Charge (Backend):</span>
                    <span className="font-bold text-emerald-700">₹{selectedModelPkg.radius_charge}</span>
                  </div>
                  {selectedModelPkg.is_night === 1 && (
                    <div className="flex justify-between border-b border-line/60 pb-2 text-orange font-bold">
                      <span>Night Surge Charge:</span>
                      <span>Applied (22:00 - 06:00 IST)</span>
                    </div>
                  )}
                  <div className="flex justify-between items-baseline pt-2 text-sm font-bold">
                    <span>Total Exact Fare:</span>
                    <span className="text-navy font-extrabold text-xl">₹{selectedModelPkg.estimated_fare}</span>
                  </div>
                </div>

                {/* Leaflet Route Map */}
                <RouteMap
                  pickup={result.route.pickup}
                  drop={result.route.drop}
                  path={result.route.path}
                  className="h-48 w-full sm:h-56"
                />

                {/* SENDER & RECEIVER CONTACT FORM FOR STEP 9 BOOKING */}
                <form onSubmit={handleConfirmOrder} className="flex flex-col gap-4 border-t border-line pt-4">
                  <h3 className="text-sm font-extrabold text-ink uppercase tracking-wider">
                    Step 9: Sender & Receiver Details for Order Booking
                  </h3>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-muted">Sender Name</label>
                      <label className={inputClass}>
                        <User size={15} className="shrink-0 text-muted" />
                        <input
                          type="text"
                          value={pickName}
                          onChange={(e) => setPickName(e.target.value)}
                          placeholder="Sender Name"
                          className={fieldTextClass}
                        />
                      </label>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-muted">Sender Mobile (Required)</label>
                      <label className={inputClass}>
                        <Phone size={15} className="shrink-0 text-muted" />
                        <span className="shrink-0 text-xs text-muted">+91</span>
                        <input
                          required
                          type="tel"
                          maxLength={10}
                          value={pmobile}
                          onChange={(e) => setPmobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                          placeholder="10-digit Sender Mobile"
                          className={fieldTextClass}
                        />
                      </label>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-muted">Receiver Name</label>
                      <label className={inputClass}>
                        <User size={15} className="shrink-0 text-muted" />
                        <input
                          type="text"
                          value={dropName}
                          onChange={(e) => setDropName(e.target.value)}
                          placeholder="Receiver Name"
                          className={fieldTextClass}
                        />
                      </label>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-muted">Receiver Mobile</label>
                      <label className={inputClass}>
                        <Phone size={15} className="shrink-0 text-muted" />
                        <span className="shrink-0 text-xs text-muted">+91</span>
                        <input
                          type="tel"
                          maxLength={10}
                          value={dmobile}
                          onChange={(e) => setDmobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                          placeholder="Receiver Mobile"
                          className={fieldTextClass}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="flex gap-3 pt-3">
                    <Button type="button" variant="secondary" onClick={() => setCurrentStep(5)} className="w-1/3">
                      ← Change Model
                    </Button>
                    <Button type="submit" size="lg" disabled={bookingSubmitting} className="w-2/3">
                      {bookingSubmitting && <Loader2 size={18} className="animate-spin" />}
                      {bookingSubmitting ? 'Submitting Booking to Render...' : 'Confirm & Place Booking Order →'}
                    </Button>
                  </div>
                </form>
              </div>
            )}

            {/* STEP 9 — BOOKING CONFIRMATION SUCCESS */}
            {currentStep === 9 && bookingSuccess && (
              <div className="flex flex-col items-center text-center gap-4 py-6">
                <span className="grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-600">
                  <CheckCircle2 size={36} />
                </span>

                <h2 className="text-2xl font-extrabold text-ink">Order Booking Placed Successfully!</h2>
                <p className="text-xs text-muted max-w-md">
                  Your order has been recorded directly on the Render Backend (`POST /api/order/create`).
                </p>

                <div className="w-full max-w-md rounded-2xl border border-line bg-offwhite p-5 text-left text-xs space-y-2">
                  <div className="flex justify-between border-b border-line pb-2">
                    <span className="text-muted">Order ID:</span>
                    <span className="font-extrabold text-navy text-sm">#{bookingSuccess.order_id || 'CONFIRMED'}</span>
                  </div>
                  <div className="flex justify-between border-b border-line pb-2">
                    <span className="text-muted">Pickup Location:</span>
                    <span className="font-bold text-ink truncate max-w-[200px]">{pickupText}</span>
                  </div>
                  <div className="flex justify-between border-b border-line pb-2">
                    <span className="text-muted">Drop Location:</span>
                    <span className="font-bold text-ink truncate max-w-[200px]">{dropText}</span>
                  </div>
                  <div className="flex justify-between border-b border-line pb-2">
                    <span className="text-muted">Vehicle Category & Model:</span>
                    <span className="font-bold text-ink">{currentCategoryName} — {selectedModelPkg?.title}</span>
                  </div>
                  <div className="flex justify-between pt-1 text-sm font-bold">
                    <span>Total Fare:</span>
                    <span className="text-navy font-extrabold">₹{selectedModelPkg?.estimated_fare}</span>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md pt-3">
                  <Button
                    size="lg"
                    className="w-full"
                    onClick={() => {
                      setCurrentStep(1);
                      setBookingSuccess(null);
                      setSelectedModelPkg(null);
                      setResult(null);
                    }}
                  >
                    Calculate Another Estimate / Order
                  </Button>
                  <Button variant="secondary" size="lg" className="w-full" onClick={openSignup}>
                    Sign Up / App Login
                  </Button>
                </div>
              </div>
            )}
          </ScrollReveal>
        </div>
      </section>
    </main>
  );
}


