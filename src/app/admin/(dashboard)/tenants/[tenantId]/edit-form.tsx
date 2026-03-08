"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SectionHeader } from "@/components/ui/section-header";
import { FormField } from "@/components/ui/form-field";
import { isValidTimezone } from "@/lib/timezone";

interface Tenant {
  id: string;
  name: string;
  status: string;
  monthly_budget_usd: number;
  timezone: string;
}

export function TenantEditForm({ tenant }: { tenant: Tenant }) {
  const router = useRouter();
  const [name, setName] = useState(tenant.name);
  const [budget, setBudget] = useState(tenant.monthly_budget_usd.toString());
  const [status, setStatus] = useState(tenant.status);
  const [timezone, setTimezone] = useState(tenant.timezone);
  const [saving, setSaving] = useState(false);
  const [timezoneError, setTimezoneError] = useState<string | null>(null);

  const isDirty =
    name !== tenant.name ||
    status !== tenant.status ||
    budget !== tenant.monthly_budget_usd.toString() ||
    timezone !== tenant.timezone;

  async function handleSave() {
    if (!isValidTimezone(timezone)) {
      setTimezoneError("Invalid timezone");
      return;
    }
    setTimezoneError(null);
    setSaving(true);
    try {
      await fetch(`/api/admin/tenants/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          status,
          monthly_budget_usd: parseFloat(budget),
          timezone,
        }),
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <SectionHeader title="Edit Tenant" />
      <div>
        <div className="grid grid-cols-4 gap-4">
          <FormField label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField label="Monthly Budget (USD)">
            <Input type="number" step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </FormField>
          <FormField label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">active</option>
              <option value="suspended">suspended</option>
            </Select>
          </FormField>
          <FormField label="Timezone" error={timezoneError}>
            <Input
              value={timezone}
              onChange={(e) => { setTimezone(e.target.value); setTimezoneError(null); }}
              placeholder="UTC"
            />
          </FormField>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={handleSave} disabled={saving || !isDirty} size="sm">
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
