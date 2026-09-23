-- =====================================================================
-- MIGRATION 7a — new enum values
--
-- RUN THIS FILE ON ITS OWN, THEN RUN 7b.
-- Postgres will not let a new enum value be added and used in the same
-- transaction, so these two statements have to land before 7b runs.
-- =====================================================================

alter type quote_mode add value if not exists 'lcl';
alter type quote_pkg  add value if not exists 'LCL';
