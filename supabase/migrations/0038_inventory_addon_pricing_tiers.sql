-- Replaces the single inventory_standard_monthly placeholder price
-- (KES 500/30 days, seeded in 0034 before real pricing was decided)
-- with the actual commercial pricing: 4 duration tiers a tenant picks
-- from at checkout (features/settings/components/inventory-module-card.tsx's
-- plan picker). Monthly stays the same code/duration, price only
-- changes; the other three are new rows.

update public.addon_plans
set price = 1000, name = 'Monthly (30 days)'
where code = 'inventory_standard_monthly';

insert into public.addon_plans (addon_key, code, name, price, currency, duration_days) values
  ('inventory', 'inventory_quarterly', 'Quarterly (90 days)', 2500, 'KES', 90),
  ('inventory', 'inventory_semiannual', '6 Months (180 days)', 4800, 'KES', 180),
  ('inventory', 'inventory_annual', 'Annual (365 days)', 8000, 'KES', 365)
on conflict (code) do nothing;
