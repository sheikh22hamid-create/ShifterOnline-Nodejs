const prisma=require('../config/db');
const service=require('../services/favoriteRouteService');
const {evaluate}=require('../services/favoriteRouteGeometry');
const logger=require('../utils/logger');
const recent=new Map();
function fail(message,statusCode=400){throw Object.assign(new Error(message),{statusCode});}
const wrap=fn=>async(req,res)=>{try{res.json({success:true,data:await fn(req)});}catch(e){if(!e.statusCode)logger.error('Favorite routes failed',e);res.status(e.statusCode||500).json({success:false,message:e.statusCode?e.message:'Favorite routes unavailable. Please retry.'});}};
async function driver(req){
  const id=Number(req.body.rider_id);
  if(!Number.isSafeInteger(id)||id<=0)fail('Invalid driver');
  const rider=await prisma.tbl_rider.findUnique({where:{id},select:{id:true,city_id:true,device_id:true}});
  if(!rider?.device_id||rider.device_id!==String(req.body.device_id||''))fail('Please sign in on this device again',403);
  return rider;
}
function city(req){
  const value=req.user.role==='superadmin'?Number(req.query.city_id||req.body.city_id||0):Number(req.user.city_id);
  if(!Number.isSafeInteger(value)||value<0||req.user.role!=='superadmin'&&!value)fail('Invalid city scope',403);
  return value;
}
async function scopedRoute(req){
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<=0)fail('Invalid route');
  const c=city(req),route=await prisma.driver_favorite_route.findFirst({where:{id,...(c?{city_id:c}:{})}});
  if(!route)fail('Route not found',404);return route;
}
exports.driver=wrap(async req=>{
  const rider=await driver(req),action=req.body.action||'list';
  if(action==='list')return service.driverList(rider);
  if(!['preview','save','activate','pause','delete'].includes(action))fail('Unknown action');
  if(action==='preview'||action==='save'){
    const now=Date.now(),last=recent.get(rider.id)||0;
    if(now-last<2000)fail('Please wait a moment before retrying',429);
    recent.set(rider.id,now);
    if(recent.size>10000)for(const [id,time] of recent)if(now-time>60000)recent.delete(id);
  }
  return service.mutate(rider,action,req.body);
});
exports.list=wrap(async req=>{
  const c=city(req),where={...(c?{city_id:c}:{}),...(req.query.rider_id?{rider_id:Number(req.query.rider_id)}:{})};
  if(req.query.rider_id&&(!Number.isSafeInteger(where.rider_id)||where.rider_id<=0))fail('Invalid driver');
  const page=Math.max(1,Number(req.query.page)||1);
  const [routes,total,config,audit]=await Promise.all([
    prisma.driver_favorite_route.findMany({where,orderBy:{updated_at:'desc'},skip:(page-1)*50,take:50}),
    prisma.driver_favorite_route.count({where}),service.settings(c),
    prisma.favorite_route_audit.findMany({where:{...(c?{city_id:c}:{}),...(where.rider_id?{rider_id:where.rider_id}:{})},orderBy:{id:'desc'},take:30})]);
  const states=await prisma.driver_favorite_route_state.findMany({where:{route_id:{in:routes.map(r=>r.id)}}});
  return {routes:routes.map(r=>({...r,active:states.some(s=>s.route_id===r.id)&&!r.disabled&&(!r.expires_at||r.expires_at>new Date())})),total,page,config,audit,city_id:c,deployment_enabled:process.env.FAVORITE_ROUTES_ENABLED==='true'};
});
exports.settings=wrap(async req=>{
  const c=city(req),config=service.validateSettings(req.body.config);
  await prisma.$transaction(async tx=>{
    await tx.favorite_route_settings.upsert({where:{city_id:c},create:{city_id:c,config},update:{config}});
    await tx.favorite_route_audit.create({data:{city_id:c,actor:`admin:${req.user.id}`,action:'settings',detail:config}});
  });return config;
});
exports.disable=wrap(async req=>{
  const route=await scopedRoute(req),reason=String(req.body.reason||'').trim();
  if(!reason||reason.length>255)fail('Enter a reason (1–255 characters)');
  await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM tbl_rider WHERE id = ${route.rider_id} FOR UPDATE`;
    await tx.driver_favorite_route.update({where:{id:route.id},data:{disabled:true,disabled_reason:reason,version:{increment:1}}});
    await tx.driver_favorite_route_state.updateMany({where:{route_id:route.id},data:{route_id:null}});
    await tx.favorite_route_audit.create({data:{city_id:route.city_id,rider_id:route.rider_id,route_id:route.id,actor:`admin:${req.user.id}`,action:'disable',detail:{reason}}});
  });return {id:route.id};
});
exports.metrics=wrap(async req=>{
  const c=city(req),where=c?{city_id:c}:{};
  const [routes,states,byMode]=await Promise.all([
    prisma.driver_favorite_route.findMany({where,select:{id:true,mode:true,disabled:true,expires_at:true}}),
    prisma.driver_favorite_route_state.findMany({where:{route_id:{not:null}}}),
    prisma.driver_favorite_route.groupBy({by:['mode'],where,_count:true})
  ]);
  const now=new Date();
  const active=new Set(states.map(s=>s.route_id));
  const live=routes.filter(r=>active.has(r.id)&&!r.disabled&&(!r.expires_at||r.expires_at>now));
  return {
    saved_routes:routes.length,
    active_route_drivers:live.length,
    disabled_routes:routes.filter(r=>r.disabled).length,
    expired_routes:routes.filter(r=>r.expires_at&&r.expires_at<=now&&!r.disabled).length,
    mode_split:Object.fromEntries(byMode.map(m=>[m.mode,m._count])),
    dispatch:service.metrics.snapshot(c||undefined),
  };
});
exports.diagnose=wrap(async req=>{
  const route=await scopedRoute(req),orderId=Number(req.body.order_id);
  if(!Number.isSafeInteger(orderId)||orderId<=0)fail('Invalid order');
  const order=await prisma.pkg_order.findUnique({where:{id:orderId}});
  if(!order||order.city_id!==route.city_id)fail('Order not found in route city',404);
  const stops=await prisma.pkg_order_stops.findMany({where:{order_id:orderId},orderBy:[{sequence:'asc'},{id:'asc'}]});
  const result=evaluate(route,{lat:Number(order.plat),lng:Number(order.plong)},[...stops.map(s=>({lat:Number(s.lat),lng:Number(s.lng)})),{lat:Number(order.dlat),lng:Number(order.dlong)}]);
  return {...result,disabled:route.disabled,expired:!!route.expires_at&&route.expires_at<=new Date(),note:'Route geometry check only. Normal dispatch eligibility and priority still apply.'};
});
