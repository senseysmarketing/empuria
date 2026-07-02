
-- 1. Baseline aberta para todo staff atual
INSERT INTO staff_module_permissions (user_id, module_key, is_allowed)
SELECT ur.user_id, m.key, true
FROM user_roles ur
CROSS JOIN (VALUES ('cockpit'),('agenda'),('pdv'),('esteira'),('eventos'),('crm'),('clube')) AS m(key)
WHERE ur.role = 'staff'
ON CONFLICT (user_id, module_key) DO UPDATE SET is_allowed = true;

-- 2. Trocar policies que usam has_action(...) para has_module_access(...,'crm') / has_role(...,'admin')

-- crm_automation_flows
DROP POLICY IF EXISTS "Admins or managers edit CRM automation flows" ON public.crm_automation_flows;
CREATE POLICY "Admins or crm staff edit CRM automation flows"
  ON public.crm_automation_flows FOR ALL
  USING (public.has_role(auth.uid(),'admin') OR public.has_module_access(auth.uid(),'automacoes') OR public.has_module_access(auth.uid(),'crm'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_module_access(auth.uid(),'automacoes') OR public.has_module_access(auth.uid(),'crm'));

-- crm_automation_steps
DROP POLICY IF EXISTS "Admins or managers edit CRM automation steps" ON public.crm_automation_steps;
CREATE POLICY "Admins or crm staff edit CRM automation steps"
  ON public.crm_automation_steps FOR ALL
  USING (public.has_role(auth.uid(),'admin') OR public.has_module_access(auth.uid(),'automacoes') OR public.has_module_access(auth.uid(),'crm'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_module_access(auth.uid(),'automacoes') OR public.has_module_access(auth.uid(),'crm'));

-- crm_automation_executions
DROP POLICY IF EXISTS "Admins or managers edit CRM automation executions" ON public.crm_automation_executions;
CREATE POLICY "Admins or crm staff edit CRM automation executions"
  ON public.crm_automation_executions FOR ALL
  USING (public.has_role(auth.uid(),'admin') OR public.has_module_access(auth.uid(),'automacoes') OR public.has_module_access(auth.uid(),'crm'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_module_access(auth.uid(),'automacoes') OR public.has_module_access(auth.uid(),'crm'));

-- crm_automation_pending_actions
DROP POLICY IF EXISTS "Authorized staff cancel CRM automation pending actions" ON public.crm_automation_pending_actions;
DROP POLICY IF EXISTS "Admins or managers insert CRM automation pending actions" ON public.crm_automation_pending_actions;
CREATE POLICY "Crm staff manage automation pending actions"
  ON public.crm_automation_pending_actions FOR UPDATE
  USING (public.has_role(auth.uid(),'admin') OR public.has_module_access(auth.uid(),'automacoes') OR public.has_module_access(auth.uid(),'crm'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_module_access(auth.uid(),'automacoes') OR public.has_module_access(auth.uid(),'crm'));
CREATE POLICY "Crm staff insert automation pending actions"
  ON public.crm_automation_pending_actions FOR INSERT
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_module_access(auth.uid(),'automacoes') OR public.has_module_access(auth.uid(),'crm'));

-- crm_automation_execution_logs
DROP POLICY IF EXISTS "Admins or managers insert CRM automation logs" ON public.crm_automation_execution_logs;
CREATE POLICY "Crm staff insert automation logs"
  ON public.crm_automation_execution_logs FOR INSERT
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_module_access(auth.uid(),'automacoes') OR public.has_module_access(auth.uid(),'crm'));

-- 3. Limpar linhas de action_permissions obsoletas
DELETE FROM staff_action_permissions
WHERE action_key IN (
  'pdv.void_sale','pdv.remove_tab_item','pdv.cancel_tab',
  'esteira.cancel_order','esteira.refund_order',
  'crm.automations.view','crm.automations.manage','crm.automations.pause',
  'crm.automations.logs','crm.automations.cancel_pending_action'
);
