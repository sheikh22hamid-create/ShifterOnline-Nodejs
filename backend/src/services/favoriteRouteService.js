const prisma = require('../config/db');
const { validPoint, evaluate } = require('./favoriteRouteGeometry');
const metrics = require('./favoriteRouteMetrics');
const DEFAULTS = Object.freeze({ enabled:false, min_radius:1, max_radius:20, default_radius:10, max_routes:5, max_points:8, allow_only:true, allow_forward:true, preference_enabled:true });
function fail(message,statusCode=400) { throw Object.assign(new Error(message),{statusCode}); }
async function settings(cityId,db=prisma) {
  const rows=await db.favorite_route_settings.findMany({where:{city_id:{in:[0,Number(cityId)||0]}}});
  const global=rows.find(r=>r.city_id===0)?.config||{};
  const local=rows.find(r=>r.city_id===Number(cityId) && r.city_id!==0)?.config||{};
  const config={...DEFAULTS,...global,...local};
  // Global off is an explicit emergency rollback to normal dispatch.
  config.enabled=Boolean(global.enabled && (local.enabled ?? true));
  return config;
}
function validateSettings(value) {
  const c={...DEFAULTS,...value};
  for(const key of ['enabled','allow_only','allow_forward','preference_enabled']) if(typeof c[key]!=='boolean') fail(`Invalid ${key}`);
  for(const key of ['min_radius','max_radius','default_radius','max_routes','max_points']) if(!Number.isFinite(c[key])) fail(`Invalid ${key}`);
  if(c.min_radius<1 || c.max_radius>20 || c.min_radius>c.default_radius || c.default_radius>c.max_radius) fail('Radius must be within 1–20 km and default within min/max');
  if(!Number.isInteger(c.max_routes)||c.max_routes<1||c.max_routes>20||!Number.isInteger(c.max_points)||c.max_points<2||c.max_points>20) fail('Routes: 1–20; points: 2–20');
  return Object.fromEntries(Object.keys(DEFAULTS).map(k=>[k,c[k]]));
}
function validate(body,config) {
  if(!config.enabled) fail('Favorite Routes is not enabled in your city',409);
  if(!Array.isArray(body.points)||body.points.length<2||body.points.length>config.max_points||!body.points.every(validPoint)) fail(`Choose 2–${config.max_points} valid map points`);
  if(body.points.some((p,i)=>i>0 && p.lat===body.points[i-1].lat && p.lng===body.points[i-1].lng)) fail('Adjacent route points must be different');
  const name=String(body.name||'').trim();
  if(!name||name.length>80) fail('Route name must be 1–80 characters');
  const radius=Number(body.radius_km);
  if(!Number.isFinite(radius)||radius<config.min_radius||radius>config.max_radius) fail(`Coverage must be ${config.min_radius}–${config.max_radius} km`);
  if(!['prefer','only'].includes(body.mode)||body.mode==='only'&&!config.allow_only) fail('Choose an allowed matching mode');
  if(typeof body.forward_only!=='boolean'||body.forward_only&&!config.allow_forward) fail('Direction option unavailable');
  let expires_at=null;
  if(body.expires_at) {
    expires_at=new Date(body.expires_at);
    if(!Number.isFinite(expires_at.getTime())||expires_at.getTime()<=Date.now()||expires_at.getTime()>Date.now()+366*86400000) fail('Choose a future expiry within one year');
  }
  return {name,points:body.points.map(p=>({lat:p.lat,lng:p.lng,label:String(p.label||'').slice(0,160)})),radius_km:radius,mode:body.mode,forward_only:body.forward_only,expires_at};
}
async function roadRoute(points,cityId) {
  try {
    if(!process.env.GOOGLE_MAPS_API_KEY) fail('Route preview is unavailable. Contact support.',503);
    const waypoint=p=>({location:{latLng:{latitude:p.lat,longitude:p.lng}}});
    let response;
    try {
      response=await fetch('https://routes.googleapis.com/directions/v2:computeRoutes',{
        method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','X-Goog-Api-Key':process.env.GOOGLE_MAPS_API_KEY,'X-Goog-FieldMask':'routes.distanceMeters,routes.duration,routes.polyline.geoJsonLinestring'},
        body:JSON.stringify({origin:waypoint(points[0]),destination:waypoint(points.at(-1)),intermediates:points.slice(1,-1).map(waypoint),travelMode:'DRIVE',routingPreference:'TRAFFIC_UNAWARE',polylineEncoding:'GEO_JSON_LINESTRING',polylineQuality:'HIGH_QUALITY'})
      });
      if(!response.ok) fail('Road route could not be calculated. Please retry.',503);
      const route=(await response.json()).routes?.[0];
      const geometry=route?.polyline?.geoJsonLinestring?.coordinates?.map(p=>({lat:p[1],lng:p[0]}));
      if(!geometry || geometry.length<2 || geometry.length>25000 || !geometry.every(validPoint) || !(route.distanceMeters>0)) fail('No usable road route found',422);
      return {geometry,distance_km:route.distanceMeters/1000,duration_seconds:Math.round(parseFloat(route.duration)||0)};
    } catch(error) { if(error.statusCode) throw error; fail('Route preview timed out or is unavailable. Please retry.',503); }
  } catch(error) { metrics.recordRoutingError(cityId); throw error; }
}
async function driverList(rider) {
  const [config,routes,state]=await Promise.all([settings(rider.city_id),prisma.driver_favorite_route.findMany({where:{rider_id:rider.id},orderBy:{updated_at:'desc'}}),prisma.driver_favorite_route_state.findUnique({where:{rider_id:rider.id}})]);
  return {config,routes,active_route_id:state?.route_id||null};
}
async function mutate(rider,action,body) {
  const config=await settings(rider.city_id);
  let data;
  if(['preview','save'].includes(action)) {
    data=validate(body,config);
    Object.assign(data,await roadRoute(data.points,rider.city_id));
    if(action==='preview') return data;
  }
  return prisma.$transaction(async tx=>{
    // Shared per-driver lock serializes route count, activation and edits across instances.
    await tx.$queryRaw`SELECT id FROM tbl_rider WHERE id = ${rider.id} FOR UPDATE`;
    const id=Number(body.id);
    let route=id?await tx.driver_favorite_route.findFirst({where:{id,rider_id:rider.id}}):null;
    if(action!=='save' && action!=='pause' && !route || action==='save' && id && !route) fail('Route not found',404);
    if(action==='save') {
      if(route?.disabled) fail('This route was disabled by support',409);
      if(route && Number(body.version)!==route.version) fail('Route changed. Refresh before saving.',409);
      if(!route && await tx.driver_favorite_route.count({where:{rider_id:rider.id}})>=config.max_routes) fail('Saved route limit reached');
      route=route?await tx.driver_favorite_route.update({where:{id},data:{...data,version:{increment:1}}}):await tx.driver_favorite_route.create({data:{...data,rider_id:rider.id,city_id:rider.city_id}});
    } else if(action==='activate') {
      if(!config.enabled||route.disabled) fail('This route is unavailable',409);
      if(route.expires_at && route.expires_at<=new Date()) fail('Route expired. Edit expiry first.',409);
      // "only" mode excludes the rider from any non-matching order entirely -
      // blocked while on Daily Driver duty so it can't be used to sit online
      // without ever being dispatchable (mirrors the delivery-models lock).
      if(route.mode==='only') {
        const activeDuty=await tx.daily_driver_duty_log.findFirst({where:{rider_id:rider.id,status:'in_progress'}});
        if(activeDuty) fail("Only-mode routes can't be activated while on Daily Driver duty",409);
      }
      validate(route,config);
      await tx.driver_favorite_route_state.upsert({where:{rider_id:rider.id},create:{rider_id:rider.id,route_id:route.id},update:{route_id:route.id}});
    } else if(action==='pause') {
      await tx.driver_favorite_route_state.updateMany({where:{rider_id:rider.id},data:{route_id:null}});
    } else if(action==='delete') {
      await tx.driver_favorite_route_state.updateMany({where:{rider_id:rider.id,route_id:route.id},data:{route_id:null}});
      await tx.driver_favorite_route.delete({where:{id:route.id}});
    } else fail('Unknown route action');
    await tx.favorite_route_audit.create({data:{city_id:rider.city_id,rider_id:rider.id,route_id:route?.id,actor:`driver:${rider.id}`,action,detail:{name:route?.name||null}}});
    return {id:route?.id||null};
  });
}
async function matchCandidates(order,rows,config,db=prisma) {
  if(!config.enabled||!rows.length) return rows;
  const startedAt=Date.now();
  const states=await db.driver_favorite_route_state.findMany({where:{rider_id:{in:rows.map(r=>Number(r.rider_id))},route_id:{not:null}}});
  if(!states.length) return rows;
  const routes=await db.driver_favorite_route.findMany({where:{id:{in:states.map(s=>s.route_id)}}});
  const stops=await db.pkg_order_stops.findMany({where:{order_id:order.id},orderBy:[{sequence:'asc'},{id:'asc'}]});
  const drops=[...stops.map(s=>({lat:Number(s.lat),lng:Number(s.lng)})),{lat:Number(order.dlat),lng:Number(order.dlong)}];
  const byRider=new Map(routes.map(r=>[r.rider_id,r]));
  const result=rows.flatMap(row=>{
    const route=byRider.get(Number(row.rider_id));
    if(!route||route.disabled||route.expires_at && route.expires_at<=new Date()) return [row];
    const match=evaluate(route,{lat:Number(order.plat),lng:Number(order.plong)},drops);
    metrics.recordOffer(order.city_id,match.matched);
    if(route.mode==='only'&&!match.matched) { metrics.recordExcluded(order.city_id); return []; }
    return [{...row,favorite_route_match:match,route_priority:config.preference_enabled && match.matched?1:0}];
  }).sort((a,b)=>Number(b.has_priority_plan)-Number(a.has_priority_plan)||Number(b.is_favorite)-Number(a.is_favorite)||(b.route_priority||0)-(a.route_priority||0)||Number(a.distance_km)-Number(b.distance_km));
  metrics.recordMatchDuration(order.city_id,Date.now()-startedAt);
  return result;
}
module.exports={DEFAULTS,settings,validateSettings,validate,roadRoute,driverList,mutate,matchCandidates,metrics};
