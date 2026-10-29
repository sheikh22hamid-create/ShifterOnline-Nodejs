# Service area and No Entry Zones: implementation plan

Spec: `docs/superpowers/specs/2026-10-29-service-area-and-no-entry-zones-design.md`. Execute inline, TDD for backend, one commit per task.

## Global constraints
- Switch OFF (default) = no behavioural change anywhere; existing duty zones and `pickupCityService` untouched.
- Server is the judge; the apps only help the customer early.
- A point on an edge is inside. Pickup and drop validated independently with their own kind and the selected category.
- City admin scoped server-side; hand-applied migration; the user's uncommitted app edits are never committed.

## Review focus
- Switch OFF: createOrderCore and zone routes behave exactly as before.
- Indore pickup valid + Ujjain drop in a Three-Wheeler drop No Entry Zone: only the drop is refused, with the drop message.
- A Two-Wheeler No Entry Zone never blocks a Three-Wheeler; a pickup zone never blocks a drop.
- Missing coverage (no zone) with the switch ON blocks, with the "No service zone" message.
- A city admin cannot touch another city's zone (create, update, delete, list).

## Tasks
1. **Schema**: `service_zone.zone_kind`, table `vehicle_no_entry_zone`, migration `20261029010000_add_service_area_zones`. `prisma validate && generate`.
2. **Rules + settings** (`serviceAreaRules.js` pure: parseShape, containsPoint incl. edge, messages; `serviceAreaSettings.js` switch). Tests.
3. **Service** `serviceAreaService.validateLocation({lat,lng,kind,category})` with db; tests (cross-city, category isolation, kind isolation, missing coverage, edge).
4. **Enforcement**: `createOrderCore` + `POST /api/order/validate-location`. Tests; existing orderController suites green.
5. **Admin backend**: city scoping for `/service-zones` (+ `zone_kind`), `/no-entry-zones` CRUD. Tests.
6. **Admin UI**: ServiceZones "Pickup Allowed in City" flow, No Entry Zones screen, Settings switch. `vite build`.
7. **Customer app**: validation service, location-confirm and vehicle-select checks, messages.
8. **Wrap-up**: full backend suite, memory, report (migration, drawing coverage before turning the switch on).
