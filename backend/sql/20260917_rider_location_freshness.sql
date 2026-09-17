-- Track when a rider's rlats/rlongs were last written, so dispatch can tell
-- a fresh GPS fix apart from a stale one left over from a previous online
-- session (a driver who closed the app at location A and reopened it at
-- location B was showing as eligible at location A until a new ping arrived).
ALTER TABLE tbl_rider
  ADD COLUMN rloc_updated_at DATETIME NULL;

-- Going offline now blanks rlats/rlongs/rloc_updated_at (see riderController.setStatus),
-- so any row still carrying old coordinates while a_status = 0 predates this
-- change - clear it once so it can't be picked up before its next real ping.
UPDATE tbl_rider SET rlats = NULL, rlongs = NULL, rloc_updated_at = NULL WHERE a_status = 0;
