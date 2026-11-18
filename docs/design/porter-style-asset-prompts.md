# Shifter v2 — Image Prompts (Porter-style redesign)

For the owner: paste each prompt into your image AI, generate at the size given, and send back the PNG with
the exact file name. Claude drops it into `ShifterOnline/assets/v2/`. Until then the app shows simple placeholders.

**Rules for every image**
- Transparent background (PNG). If your AI can't do transparent, use plain white and say so.
- Same style for all images, so the app looks like one family. That's why every prompt repeats the same style line.
- No text, no numbers, no logos, no other company names inside the image.

## The asset table

| ID | File name | Size (px) | Where it shows |
|---|---|---|---|
| H1 | `home_header.png` | 1080 × 480 | Home, top header |
| T1 | `tile_book_now.png` | 600 × 400 | Home tile "Book Now" |
| T2 | `tile_schedule.png` | 600 × 400 | Home tile "Schedule" |
| T3 | `tile_low_fare.png` | 600 × 400 | Home tile "Low Fare" |
| T4 | `tile_customise.png` | 600 × 400 | Home tile "Customise Order" |
| F1 | `free_ride_icon.png` | 256 × 256 | Home "Free Ride Chance" strip |
| E1 | `empty_not_serviceable.png` | 900 × 600 | Home, when the pickup area isn't served |
| E2 | `empty_no_orders.png` | 900 × 600 | Orders, when there are no orders |
| E3 | `empty_no_driver.png` | 900 × 600 | When no driver is found |
| W1 | `wallet_icon.png` | 256 × 256 | Wallet balance card |
| V1 | `vehicle_bike.png` | 800 × 560 | "Finding your driver" screen, centre (Bike / 2 wheeler) |
| V2 | `vehicle_e_loader.png` | 800 × 560 | "Finding your driver" screen, centre (E-Loader / e-rickshaw) |
| V3 | `vehicle_three_wheeler.png` | 800 × 560 | "Finding your driver" screen, centre (3 Wheeler / tempo) |
| V4 | `vehicle_four_wheeler.png` | 800 × 560 | "Finding your driver" screen, centre (4 Wheeler / mini truck) — also the default |

## Style line (already inside every prompt below)

> Soft 3D clay illustration, clean and premium, gentle studio lighting, soft shadow, main colour orange #FF6B35 with deep navy #1A2B4C and white accents, no text, no letters, no logos, no brand names, transparent background, centred subject with margin.

## Prompts

**H1 — `home_header.png` (1080 × 480)**
> Soft 3D clay illustration, clean and premium, gentle studio lighting, soft shadow, main colour orange #FF6B35 with deep navy #1A2B4C and white accents, no text, no letters, no logos, no brand names, transparent background, centred subject with margin. A wide scene of a small Indian city street corner with a compact orange goods truck and a few neat cardboard parcels beside it. Keep the left 45% of the image completely empty for text; all objects on the right side. Generate at 1080x480 px.

**T1 — `tile_book_now.png` (600 × 400)**
> Soft 3D clay illustration, clean and premium, gentle studio lighting, soft shadow, main colour orange #FF6B35 with deep navy #1A2B4C and white accents, no text, no letters, no logos, no brand names, transparent background, centred subject with margin. A small Indian mini goods truck (three-quarter side view) moving fast, with a few soft motion lines behind it and a parcel in the open back. Generate at 600x400 px.

**T2 — `tile_schedule.png` (600 × 400)**
> Soft 3D clay illustration, clean and premium, gentle studio lighting, soft shadow, main colour orange #FF6B35 with deep navy #1A2B4C and white accents, no text, no letters, no logos, no brand names, transparent background, centred subject with margin. A small Indian mini goods truck parked next to a big desk calendar page and a round wall clock, calm and organised feeling. No numbers on the calendar or clock. Generate at 600x400 px.

**T3 — `tile_low_fare.png` (600 × 400)**
> Soft 3D clay illustration, clean and premium, gentle studio lighting, soft shadow, main colour orange #FF6B35 with deep navy #1A2B4C and white accents, no text, no letters, no logos, no brand names, transparent background, centred subject with margin. A small Indian mini goods truck with a large price tag hanging from it, the tag showing only a downward arrow, plus a small moon in the corner to suggest next-day delivery. No numbers. Generate at 600x400 px.

**T4 — `tile_customise.png` (600 × 400)**
> Soft 3D clay illustration, clean and premium, gentle studio lighting, soft shadow, main colour orange #FF6B35 with deep navy #1A2B4C and white accents, no text, no letters, no logos, no brand names, transparent background, centred subject with margin. Two friendly hands shaking over a small cardboard parcel, suggesting a fair deal agreed between customer and driver. Generate at 600x400 px.

**F1 — `free_ride_icon.png` (256 × 256)**
> Soft 3D clay illustration, clean and premium, gentle studio lighting, soft shadow, main colour orange #FF6B35 with deep navy #1A2B4C and white accents, no text, no letters, no logos, no brand names, transparent background, centred subject with margin. A single shiny golden-orange coin with a tiny truck shape embossed on it and two small sparkles. Generate at 256x256 px.

**E1 — `empty_not_serviceable.png` (900 × 600)**
> Soft 3D clay illustration, clean and premium, gentle studio lighting, soft shadow, main colour orange #FF6B35 with deep navy #1A2B4C and white accents, no text, no letters, no logos, no brand names, transparent background, centred subject with margin. A friendly delivery person in a navy cap looking through binoculars at a map pin with a small cross on it, soft hills behind. Generate at 900x600 px.

**E2 — `empty_no_orders.png` (900 × 600)**
> Soft 3D clay illustration, clean and premium, gentle studio lighting, soft shadow, main colour orange #FF6B35 with deep navy #1A2B4C and white accents, no text, no letters, no logos, no brand names, transparent background, centred subject with margin. An empty open cardboard box with flaps open and a small paper plane floating above it. Generate at 900x600 px.

**E3 — `empty_no_driver.png` (900 × 600)**
> Soft 3D clay illustration, clean and premium, gentle studio lighting, soft shadow, main colour orange #FF6B35 with deep navy #1A2B4C and white accents, no text, no letters, no logos, no brand names, transparent background, centred subject with margin. A small Indian mini goods truck with a big magnifying glass in front of it, searching, a few soft map pins around. Generate at 900x600 px.

**W1 — `wallet_icon.png` (256 × 256)**
> Soft 3D clay illustration, clean and premium, gentle studio lighting, soft shadow, main colour orange #FF6B35 with deep navy #1A2B4C and white accents, no text, no letters, no logos, no brand names, transparent background, centred subject with margin. A navy wallet, slightly open, with one orange coin peeking out. Generate at 256x256 px.

### Vehicles for the "Finding your driver" screen (V1–V4)

Keep all four the same angle and size so they look like one set.

**V1 — `vehicle_bike.png` (800 × 560)**
> Soft 3D clay illustration, clean and premium, gentle studio lighting, soft shadow, main colour orange #FF6B35 with deep navy #1A2B4C and white accents, no text, no letters, no logos, no brand names, transparent background, centred subject with margin. An Indian delivery motorbike with a large orange delivery box strapped on the back seat. Three-quarter front view facing right, wheels visible, sitting on an invisible floor (the app draws its own shadow, so keep the ground shadow very light), plain unbranded body with no number plate text. Generate at 800x560 px.

**V2 — `vehicle_e_loader.png` (800 × 560)**
> Soft 3D clay illustration, clean and premium, gentle studio lighting, soft shadow, main colour orange #FF6B35 with deep navy #1A2B4C and white accents, no text, no letters, no logos, no brand names, transparent background, centred subject with margin. An Indian electric cargo three-wheeler (e-loader) with an open orange cargo tray carrying two cardboard parcels. Three-quarter front view facing right, wheels visible, sitting on an invisible floor (the app draws its own shadow, so keep the ground shadow very light), plain unbranded body with no number plate text. Generate at 800x560 px.

**V3 — `vehicle_three_wheeler.png` (800 × 560)**
> Soft 3D clay illustration, clean and premium, gentle studio lighting, soft shadow, main colour orange #FF6B35 with deep navy #1A2B4C and white accents, no text, no letters, no logos, no brand names, transparent background, centred subject with margin. An Indian three-wheeler goods carrier (tempo) with an orange cabin and an open cargo bed holding a few parcels. Three-quarter front view facing right, wheels visible, sitting on an invisible floor (the app draws its own shadow, so keep the ground shadow very light), plain unbranded body with no number plate text. Generate at 800x560 px.

**V4 — `vehicle_four_wheeler.png` (800 × 560)**
> Soft 3D clay illustration, clean and premium, gentle studio lighting, soft shadow, main colour orange #FF6B35 with deep navy #1A2B4C and white accents, no text, no letters, no logos, no brand names, transparent background, centred subject with margin. An Indian small four-wheeler mini goods truck with an orange cabin and an open cargo bed holding a few parcels. Three-quarter front view facing right, wheels visible, sitting on an invisible floor (the app draws its own shadow, so keep the ground shadow very light), plain unbranded body with no number plate text. Generate at 800x560 px.

