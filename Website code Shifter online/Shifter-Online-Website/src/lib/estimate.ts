import { Bike, CarTaxiFront, Truck, TruckElectric, Zap, type LucideIcon } from 'lucide-react';
import type { CategoryItem, PackageEstimateItem } from './api';

export const cities = [
  'Mumbai',
  'Delhi NCR',
  'Bengaluru',
  'Indore',
  'Bhopal',
  'Pune',
  'Ahmedabad',
  'Hyderabad',
  'Chennai',
  'Kolkata',
  'Jaipur',
  'Lucknow',
];

export function getCategoryIcon(catName: string): LucideIcon {
  const name = String(catName || '').toLowerCase();
  if (name.includes('bike') || name.includes('scooter') || name.includes('two') || name.includes('2')) {
    return Bike;
  }
  if (name.includes('loader') || name.includes('electric') || name.includes('e-loader') || name.includes('e loader')) {
    return Zap;
  }
  if (name.includes('3') || name.includes('auto') || name.includes('three') || name.includes('rickshaw')) {
    return CarTaxiFront;
  }
  if (name.includes('4') || name.includes('truck') || name.includes('four') || name.includes('van') || name.includes('ace')) {
    return Truck;
  }
  return TruckElectric;
}

export function getFallbackVehicleImage(catName: string): string {
  const name = String(catName || '').toLowerCase();
  if (name.includes('bike') || name.includes('scooter') || name.includes('two') || name.includes('2')) {
    return '/vehicles/bike.svg';
  }
  if (name.includes('loader') || name.includes('electric') || name.includes('e-loader') || name.includes('e loader') || name.includes('ev')) {
    return '/vehicles/eloader.svg';
  }
  if (name.includes('3') || name.includes('auto') || name.includes('three') || name.includes('rickshaw')) {
    return '/vehicles/3wheeler.svg';
  }
  if (name.includes('4') || name.includes('truck') || name.includes('four') || name.includes('van') || name.includes('ace')) {
    return '/vehicles/4wheeler.svg';
  }
  return '/vehicles/3wheeler.svg';
}



const RENDER_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'https://shifteronline-nodejs-dev.onrender.com';

export function getCategoryImageUrl(imgPath?: string | null): string | null {
  if (!imgPath) return null;
  if (/^https?:\/\//.test(imgPath)) return imgPath;
  const cleanPath = imgPath.replace(/^\//, '');
  return `${RENDER_BASE_URL.replace(/\/$/, '')}/${cleanPath}`;
}

export type { CategoryItem, PackageEstimateItem };


