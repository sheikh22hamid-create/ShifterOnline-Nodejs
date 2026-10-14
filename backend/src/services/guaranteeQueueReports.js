const { Prisma } = require("@prisma/client");
const prisma = require("../config/db");

const n = (v) => Number(v ?? 0);
const cityClause = (cityId, col = "c.city_id") => (cityId === null || cityId === undefined ? Prisma.empty : Prisma.sql`AND ${Prisma.raw(col)} = ${Number(cityId)}`);

async function queueList({ cityId = null, state = null, limit = 100 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const rows = await prisma.$queryRaw(Prisma.sql`
    SELECT c.id, c.order_id, c.city_id, c.status, c.queue_state, c.unassigned_reason, c.opened_at, c.deadline_at, c.owner_admin_id,
           c.first_action_at, c.last_action_at, c.reminded_at, c.escalated_at, a.name AS owner_name, a.username AS owner_username
    FROM booking_guarantee_case c LEFT JOIN admin a ON a.id = c.owner_admin_id
    WHERE c.queue_state IS NOT NULL ${cityClause(cityId)} ${state ? Prisma.sql`AND c.queue_state = ${state}` : Prisma.empty}
    ORDER BY (c.status = 'open') DESC, c.deadline_at ASC LIMIT ${take}`);
  return rows;
}

async function workload({ cityId = null } = {}) {
  const rows = await prisma.$queryRaw(Prisma.sql`
    SELECT a.id AS admin_id, COALESCE(a.name, a.username) AS name, a.city_id AS city_id, a.status AS status,
      COALESCE(p.available, 1) AS available, p.capacity AS capacity, ce.exec_default_capacity AS city_capacity,
      (SELECT COUNT(*) FROM guarantee_assignment ga JOIN booking_guarantee_case c ON c.id = ga.case_id WHERE ga.admin_id = a.id AND ga.active = 1 AND c.status = 'open') AS active,
      (SELECT COUNT(*) FROM guarantee_assignment ga JOIN booking_guarantee_case c ON c.id = ga.case_id WHERE ga.admin_id = a.id AND ga.active = 1 AND c.status = 'open' AND c.escalated_at IS NOT NULL) AS escalated,
      (SELECT COUNT(*) FROM guarantee_assignment ga JOIN booking_guarantee_case c ON c.id = ga.case_id WHERE ga.admin_id = a.id AND ga.active = 1 AND c.status = 'open' AND c.reminded_at IS NOT NULL) AS reminded,
      (SELECT COUNT(*) FROM booking_guarantee_case c WHERE c.resolved_by_admin_id = a.id) AS resolved,
      (SELECT COUNT(DISTINCT ga.case_id) FROM guarantee_assignment ga WHERE ga.admin_id = a.id) AS owned_total,
      (SELECT COUNT(*) FROM guarantee_assignment ga WHERE ga.admin_id = a.id AND ga.end_reason IN ('reassigned','unavailable','idle_auto_reassign')) AS reassigned_away
    FROM admin a
    LEFT JOIN executive_guarantee_profile p ON p.admin_id = a.id
    LEFT JOIN city_order_settings ce ON ce.city_id = a.city_id
    WHERE a.role = 'executive' ${cityId === null || cityId === undefined ? Prisma.empty : Prisma.sql`AND a.city_id = ${Number(cityId)}`}
    ORDER BY a.city_id, name`);
  return rows.map((r) => ({
    admin_id: n(r.admin_id), name: r.name, city_id: r.city_id, active_account: n(r.status) === 1,
    available: n(r.available) === 1, capacity: r.capacity == null ? null : n(r.capacity),
    effective_capacity: r.capacity != null ? n(r.capacity) : n(r.city_capacity) || 5,
    active: n(r.active), escalated: n(r.escalated), reminded: n(r.reminded), resolved: n(r.resolved),
    owned_total: n(r.owned_total), reassigned_away: n(r.reassigned_away),
  }));
}

/**
 * Aggregates for the supervisor dashboard (server-side). Expiries are split by cause so an SLA miss is never
 * read as staff negligence: no executive was ever assigned / an executive never acted / an executive acted.
 */
async function report({ cityId = null, from, to } = {}) {
  const [row] = await prisma.$queryRaw(Prisma.sql`
    SELECT COUNT(*) AS total,
      SUM(c.status = 'resolved_assigned') AS resolved, SUM(c.status = 'expired_compensated') AS expired, SUM(c.status = 'cancelled') AS cancelled,
      SUM(c.status = 'open' AND c.queue_state = 'unassigned') AS unassigned_now,
      SUM(EXISTS (SELECT 1 FROM guarantee_assignment ga WHERE ga.case_id = c.id AND ga.source = 'auto')) AS auto_assigned,
      SUM((SELECT COUNT(*) FROM guarantee_assignment ga WHERE ga.case_id = c.id) > 1) AS reassigned_cases,
      AVG(CASE WHEN c.first_action_at IS NOT NULL THEN TIMESTAMPDIFF(SECOND, c.opened_at, c.first_action_at) END) AS avg_first_action,
      SUM(c.status = 'expired_compensated' AND NOT EXISTS (SELECT 1 FROM guarantee_assignment ga WHERE ga.case_id = c.id)) AS exp_no_owner,
      SUM(c.status = 'expired_compensated' AND EXISTS (SELECT 1 FROM guarantee_assignment ga WHERE ga.case_id = c.id) AND c.first_action_at IS NULL) AS exp_no_action,
      SUM(c.status = 'expired_compensated' AND c.first_action_at IS NOT NULL) AS exp_acted
    FROM booking_guarantee_case c
    WHERE c.queue_state IS NOT NULL AND c.opened_at >= ${new Date(from)} AND c.opened_at <= ${new Date(to)} ${cityClause(cityId)}`);
  return {
    total: n(row.total), resolved: n(row.resolved), expired: n(row.expired), cancelled: n(row.cancelled), unassigned_now: n(row.unassigned_now),
    auto_assigned: n(row.auto_assigned), reassigned_cases: n(row.reassigned_cases),
    avg_seconds_to_first_action: row.avg_first_action == null ? null : Math.round(Number(row.avg_first_action)),
    failure_breakdown: { expired_no_owner: n(row.exp_no_owner), expired_owner_no_action: n(row.exp_no_action), expired_owner_acted: n(row.exp_acted) },
  };
}

module.exports = { queueList, workload, report };
