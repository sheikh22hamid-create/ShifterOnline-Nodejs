# City-wise pickup coverage and vehicle-wise No Entry Zones: design

Spec source: the manager's brief of 2026-10-29. The owner delegated the open choices ("jo better lge wo kr"); those are marked **My call**.

## Intent
Every city has a configured pickup service area. Inside a city, admins can mark vehicle-category-specific Pickup and Drop No Entry Zones. When a customer picks a pickup or drop, the app (and, as the final word, the order API) checks the location against the coverage and the selected vehicle's rules and answers with a plain message.

## Today (verified in code)
- `service_zone` (name, city_id, centre + radius or polygon_geojson, status) is the only zone table. Admin page `ServiceZones.jsx` + `ZoneMapDrawer` draw circle / square / polygon. It is also used for Daily Driver duty zones (`assigned_zone_id`).
- `pickupCityService` finds the city from the first active zone containing the pickup and, when none matches, silently falls back to the first active city. So today nothing is ever "out of area".
- `tbl_geofence_zones` (city_boundary / no_entry) exists in the schema, is used by no code and has no vehicle category or pickup/drop split. Left alone.
- `/service-zones` routes are not city-scoped: any admin can edit any city's zones.
- City admins are role `admin` with a `city_id`; `scopeFilter` already binds them to it.

## Decisions
- **My call: coverage is its own zone kind.** `service_zone.zone_kind` ('duty' default, 'coverage'). Existing zones stay 'duty' and behave exactly as before; "Pickup Allowed in City" creates 'coverage' zones (circle/square/polygon, many per city). Coverage zones also feed the existing pickup to city lookup.
- **My call: rollout switch.** `app_settings.service_area_enforcement_enabled`, default OFF, read errors count as OFF. OFF = every existing behaviour unchanged (no new check anywhere). ON = the rules below. Reason: turning the rule on blocks every city that has no coverage zone drawn yet.
- **No Entry Zones** are a new table `vehicle_no_entry_zone` (city_id, category_id, kind pickup|drop, name, status, same shape fields as `service_zone`). One row = one area for one city + vehicle category + kind. Pickup and drop never share rows. Many per combination.
- **Validation (switch ON)**, per location with its own kind and the selected vehicle category:
  1. Coverage: the point must be inside an active coverage zone of any city (this is the "supported drop coverage" too, so Indore to Ujjain works only if Ujjain has coverage). No coverage anywhere or none matching = blocked.
  2. No Entry: the point must not be inside an active No Entry Zone of the same kind, the same vehicle category and a city whose coverage contains the point. Other categories and the other kind are never consulted. The pickup's city rules never apply to the drop and vice versa.
  3. A point on a polygon edge counts as inside (coverage allows it, No Entry blocks it); a circle includes its radius.
  4. Without a vehicle category the check is coverage only (used when a location is first confirmed); it is repeated with the category when the vehicle is chosen or changed.
- Messages (exact): pickup out of coverage "No service zone available for this pickup location."; pickup in a No Entry Zone "Pickup is not allowed in this area for the selected vehicle type."; drop out of coverage "No service zone available for this drop location."; drop in a No Entry Zone "Drop location is a no-entry zone for the selected vehicle type. Please choose another location."
- **Enforcement point:** `createOrderCore` runs both checks before anything is charged or created (stops are not checked, the brief does not ask for it). A new `POST /api/order/validate-location` runs the same code for the apps. Both use one service.
- **Permissions:** zone and No Entry routes use `scopeFilter`. A city admin can only create, edit, delete and list their own city's coverage and No Entry zones; a superadmin any city. Deleting a 'duty' zone stays superadmin only.

## Non-goals
Stops are not validated. `tbl_geofence_zones` is not migrated or removed. Driver-side zone rules, pricing by zone, and the duty-zone behaviour are untouched. Wallet-prepaid orders keep their normal refunds because nothing is charged before the check.

## Parts
1. Backend: schema, rules, settings, service, order enforcement and validate endpoint, admin controllers and routes.
2. Admin panel: "Mark Zone on Map" asks for the city first and saves a coverage zone; a "No Entry Zones" screen (city, vehicle category, pickup/drop, list, map draw, edit, delete, status); the enforcement switch on Settings.
3. Customer app: validate on location confirm (coverage) and on vehicle select/change (with the category); show the exact message and let the customer change the location.
