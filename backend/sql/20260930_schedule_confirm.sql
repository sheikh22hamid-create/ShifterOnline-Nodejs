-- Scheduled-ride "do you still want to continue?" prompt state:
-- 0 = not asked yet, 1 = asked (awaiting answer), 2 = customer confirmed.
ALTER TABLE `pkg_order`
    ADD COLUMN `schedule_confirm_status` INTEGER NULL DEFAULT 0;
