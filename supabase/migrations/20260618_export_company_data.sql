-- ════════════════════════════════════════════════════════════════════════
-- export_company_data — human-readable bulk export of a tenant's core data.
-- Powers the in-app "Download as Excel" bulk export (backup.js). Returns one
-- jsonb object with an array per business entity, curated + joined to readable
-- names (not raw FK uuids). Company-scoped exactly like every other admin RPC
-- (trusts p_company_id, the app's established model). SECURITY DEFINER so it
-- can read across the tenant's tables regardless of RLS.
--
-- NOTE: this is the *human* snapshot. The *machine* full-fidelity backup is the
-- nightly pg_dump (see .github/workflows/nightly-backup.yml + docs/BACKUP.md).
-- ════════════════════════════════════════════════════════════════════════
create or replace function export_company_data(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if p_company_id is null then
    raise exception 'p_company_id is required';
  end if;

  select jsonb_build_object(
    'meta', jsonb_build_object(
      'exported_at', now(),
      'company_id', p_company_id,
      'company', (select jsonb_build_object('code',company_code,'name',company_name,'status',status)
                  from companies where id = p_company_id)
    ),

    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'Project Code', project_code, 'Project Name', project_name,
        'City', city, 'Status', status, 'Total Units', total_units,
        'Delivery Date', delivery_date)
        order by project_name)
      from projects where company_id = p_company_id), '[]'::jsonb),

    'units', coalesce((
      select jsonb_agg(jsonb_build_object(
        'Unit No', u.unit_no, 'Project', p.project_name,
        'Floor', u.floor_label, 'Type', t.type_name, 'Status', st.status_name,
        'Area', u.area, 'Area Unit', u.area_unit, 'Base Price', u.base_price)
        order by p.project_name, u.unit_no)
      from units u
      left join projects p on p.id = u.project_id
      left join category_unit_types t on t.id = u.unit_type_id
      left join category_unit_statuses st on st.id = u.status_id
      where u.company_id = p_company_id), '[]'::jsonb),

    'clients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'Client Code', client_code, 'Full Name', full_name, 'Father Name', father_name,
        'CNIC', cnic, 'Phone', phone_primary, 'WhatsApp', whatsapp, 'Email', email,
        'City', city, 'Address', address, 'Occupation', occupation,
        'Status', status, 'Blacklisted', is_blacklisted, 'Defaulter', is_defaulter)
        order by full_name)
      from clients where company_id = p_company_id), '[]'::jsonb),

    'sales', coalesce((
      select jsonb_agg(jsonb_build_object(
        'Sale No', s.sale_number, 'Unit', u.unit_no, 'Project', p.project_name,
        'Client', c.full_name, 'Agent', a.full_name, 'Sale Date', s.sale_date,
        'Total Amount', s.total_amount, 'Discount', s.discount, 'Net Amount', s.net_amount,
        'Down Payment', s.down_payment, 'Installments', s.installment_count,
        'Commission %', s.commission_rate, 'Commission Notes', s.commission_notes,
        'Status', s.status)
        order by s.sale_date desc nulls last, s.sale_number)
      from sales s
      left join units u on u.id = s.unit_id
      left join projects p on p.id = s.project_id
      left join clients c on c.id = s.client_id
      left join agents a on a.id = s.agent_id
      where s.company_id = p_company_id), '[]'::jsonb),

    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'Payment Code', pm.payment_code, 'Date', pm.payment_date,
        'Sale No', s.sale_number, 'Client', c.full_name, 'Unit', u.unit_no,
        'Amount', pm.amount, 'Method', pm.payment_method, 'Reference', pm.reference_no,
        'Bank', pm.bank_name, 'Category', pm.payment_category, 'Status', pm.status,
        'Notes', pm.notes)
        order by pm.payment_date desc nulls last)
      from payments pm
      left join sales s on s.id = pm.sale_id
      left join clients c on c.id = pm.client_id
      left join units u on u.id = s.unit_id
      where pm.company_id = p_company_id), '[]'::jsonb),

    'installments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'Sale No', s.sale_number, 'Client', c.full_name, 'Unit', u.unit_no,
        'Inst #', i.installment_number, 'Type', i.installment_type,
        'Due Date', i.due_date, 'Amount Due', i.amount_due, 'Amount Paid', i.amount_paid,
        'Outstanding', i.outstanding, 'Status', i.status)
        order by s.sale_number, i.installment_number)
      from installments i
      left join sales s on s.id = i.sale_id
      left join clients c on c.id = s.client_id
      left join units u on u.id = s.unit_id
      where i.company_id = p_company_id), '[]'::jsonb),

    'agents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'Agent Code', agent_code, 'Full Name', full_name, 'Father Name', father_name,
        'Phone', phone, 'CNIC', cnic, 'Sales Count', total_sales_count,
        'Sales Amount', total_sales_amount, 'Commission Earned', total_commission_earned,
        'Commission Paid', total_commission_paid, 'Status', status)
        order by total_sales_amount desc nulls last, full_name)
      from agents where company_id = p_company_id), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

grant execute on function export_company_data(uuid) to anon, authenticated;

comment on function export_company_data(uuid) is
  'Human-readable bulk export of a tenant''s core entities as jsonb (one array per sheet). Powers backup.js "Download as Excel". Company-scoped by p_company_id (app''s standard admin-RPC trust model). Machine-grade full backup = nightly pg_dump, see docs/BACKUP.md.';
