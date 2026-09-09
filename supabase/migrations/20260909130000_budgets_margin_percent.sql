-- Margen/comisión que la org añade sobre el coste del profesional para el PVP del cliente.
alter table budgets add column if not exists margin_percent numeric default 0;
