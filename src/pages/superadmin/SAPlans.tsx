import { useEffect, useState } from 'react'
import { Settings, Save } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface PlanCfg {
  id: string
  plan: string
  max_orgs: number
  max_boards: number
  max_leads: number
  max_members: number
  price_monthly: number
}

const PLAN_META: Record<string, { label: string; color: string; ring: string }> = {
  free:       { label: 'FREE',       color: 'text-gray-600',    ring: 'border-gray-200' },
  pro:        { label: 'PRO',        color: 'text-blue-600',    ring: 'border-blue-300' },
  enterprise: { label: 'ENTERPRISE', color: 'text-purple-600',  ring: 'border-purple-300' },
}

export function SAPlans() {
  const [plans, setPlans]     = useState<PlanCfg[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('plan_config').select('*').order('price_monthly')
    setPlans(data ?? [])
    setLoading(false)
  }

  function updateField(planId: string, field: keyof PlanCfg, value: number) {
    setPlans(prev => prev.map(p => p.id === planId ? { ...p, [field]: value } : p))
  }

  async function savePlan(plan: PlanCfg) {
    setSaving(plan.id)
    const { error } = await supabase.from('plan_config').update({
      max_orgs: plan.max_orgs,
      max_boards: plan.max_boards,
      max_leads: plan.max_leads,
      max_members: plan.max_members,
      price_monthly: plan.price_monthly,
      updated_at: new Date().toISOString(),
    }).eq('id', plan.id)
    if (error) toast.error('Error al guardar')
    else toast.success(`Plan ${plan.plan.toUpperCase()} actualizado`)
    setSaving(null)
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Configuración de Planes</h1>
        <p className="text-gray-400 text-sm">Límites y precios de cada plan</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map(plan => {
            const meta = PLAN_META[plan.plan] ?? PLAN_META.free
            return (
              <Card key={plan.id} className={`border-2 ${meta.ring}`}>
                <CardHeader className="pb-3">
                  <CardTitle className={`text-base font-bold ${meta.color} flex items-center gap-2`}>
                    <Settings className="h-4 w-4" />{meta.label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { key: 'max_orgs' as const,    label: 'Organizaciones máximas' },
                    { key: 'max_boards' as const,  label: 'Tableros por org' },
                    { key: 'max_leads' as const,   label: 'Leads totales máximos' },
                    { key: 'max_members' as const, label: 'Colaboradores máximos' },
                  ].map(f => (
                    <div key={f.key} className="space-y-1">
                      <label className="text-xs text-gray-500">{f.label}</label>
                      <Input
                        type="number" min="0"
                        value={plan[f.key]}
                        onChange={e => updateField(plan.id, f.key, parseInt(e.target.value) || 0)}
                        className="h-8 text-sm"
                      />
                    </div>
                  ))}
                  <div className="space-y-1">
                    <label className="text-xs text-gray-500">Precio mensual (€)</label>
                    <Input
                      type="number" min="0" step="0.01"
                      value={plan.price_monthly}
                      onChange={e => updateField(plan.id, 'price_monthly', parseFloat(e.target.value) || 0)}
                      className="h-8 text-sm font-semibold"
                    />
                  </div>
                  <Button
                    size="sm"
                    className="w-full gap-1.5 mt-2"
                    onClick={() => savePlan(plan)}
                    disabled={saving === plan.id}
                  >
                    <Save className="h-3.5 w-3.5" />
                    {saving === plan.id ? 'Guardando…' : 'Guardar cambios'}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Card className="border-dashed">
        <CardContent className="p-4">
          <p className="text-xs text-gray-400">
            ℹ️ Los límites se aplicarán cuando se implemente el control de cuotas en la app cliente.
            Por ahora son informativos y sirven para calcular el MRR.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
