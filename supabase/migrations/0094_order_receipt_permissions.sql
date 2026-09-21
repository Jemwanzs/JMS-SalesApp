-- ============================================================================
-- 0094_order_receipt_permissions.sql
--
-- CUSTOMER ORDERS MODULE — PHASE 3a: POS-STYLE ORDER RECEIPT.
--
-- Two new granular permissions for the order receipt feature (View/
-- Download, spec section 14). No new tables/columns -- the receipt is
-- generated entirely client-side from data already reachable through
-- OrderService.getOrderDetail() plus a handful of new tenant_settings
-- keys (no migration-time seed needed, see TenantService.getSetting's
-- own "missing row = null, defaults are call-site" behavior already
-- used by every other settings card in this module).
--
-- Same shape as 0092's own permission-insertion block: both marked
-- is_read_only = true (informational/export, not a mutation), backfilled
-- to the system "Tenant Administrator" role only, same as every other
-- orders.* permission so far.
--
-- The WhatsApp-related permissions from spec section 14 (sending/
-- resending notifications) are deliberately NOT added here -- WhatsApp
-- was simplified to a plain wa.me click-to-chat link (no send/deliver/
-- read tracking possible), and belongs to its own later phase.
-- ============================================================================

insert into public.permissions (key, module, description, is_read_only) values
  ('orders.view_receipts', 'orders', 'View order receipts', true),
  ('orders.download_receipts', 'orders', 'Download order receipts as PDF', true);

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r
cross join public.permissions p
where r.is_system_default and r.name = 'Tenant Administrator'
  and p.key in ('orders.view_receipts', 'orders.download_receipts')
on conflict do nothing;
