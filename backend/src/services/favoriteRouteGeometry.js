// Great-circle segment distance, including endpoints (not just waypoints).
const R = 6371;
const rad = x => x * Math.PI / 180;
const clamp = x => Math.max(-1, Math.min(1, x));
function validPoint(p) {
  return p && typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}
function angle(a, b) {
  return 2 * Math.asin(Math.sqrt(Math.min(1, Math.sin(rad(b.lat-a.lat)/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lng-a.lng)/2)**2)));
}
function bearing(a,b) {
  const d=rad(b.lng-a.lng), x=rad(a.lat), y=rad(b.lat);
  return Math.atan2(Math.sin(d)*Math.cos(y), Math.cos(x)*Math.sin(y)-Math.sin(x)*Math.cos(y)*Math.cos(d));
}
function project(point, line) {
  if (!validPoint(point) || !Array.isArray(line) || line.length < 2 || !line.every(validPoint)) return null;
  let best={ distanceKm: Infinity, progressKm: 0 }, travelled=0;
  for(let i=1;i<line.length;i++) {
    const a=line[i-1], b=line[i], length=angle(a,b), d=angle(a,point), diff=bearing(a,point)-bearing(a,b);
    const along=Math.atan2(Math.sin(d)*Math.cos(diff), Math.cos(d));
    let distance, progress;
    if(along<=0 || length<1e-10) { distance=d*R; progress=0; }
    else if(along>=length) { distance=angle(b,point)*R; progress=length*R; }
    else { distance=Math.abs(Math.asin(clamp(Math.sin(d)*Math.sin(diff))))*R; progress=along*R; }
    if(distance<best.distanceKm) best={distanceKm:distance,progressKm:travelled+progress};
    travelled+=length*R;
  }
  return best;
}
function evaluate(route, pickup, drops) {
  const projections=drops.map(p=>project(p,route.geometry));
  if(!projections.length || projections.some(p=>!p)) return { matched:false, reason:'invalid_drop' };
  const maxDistanceKm=Math.max(...projections.map(p=>p.distanceKm));
  if(maxDistanceKm>route.radius_km) return {matched:false,reason:'drop_outside_coverage',distance_km:maxDistanceKm};
  if(route.forward_only) {
    const start=project(pickup,route.geometry);
    if(!start) return {matched:false,reason:'invalid_pickup'};
    let previous=start.progressKm;
    for(const p of projections) {
      // Small tolerance prevents numerical noise at one route position.
      if(p.progressKm+0.1<previous) return {matched:false,reason:'direction_mismatch',distance_km:maxDistanceKm};
      previous=p.progressKm;
    }
  }
  return {matched:true,reason:'route_match',distance_km:maxDistanceKm,route_id:route.id,route_name:route.name};
}
module.exports={validPoint,project,evaluate};
