"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";

const SOURCES = [
  { value: "", label: "All Sources" },
  { value: "api", label: "API" },
  { value: "schedule", label: "Schedule" },
  { value: "playground", label: "Playground" },
  { value: "chat", label: "Chat" },
  { value: "a2a", label: "A2A" },
];

export function SourceFilter({ current }: { current: string | null }) {
  const router = useRouter();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    const params = new URLSearchParams();
    if (value) params.set("source", value);
    router.push(`/admin/runs${params.toString() ? `?${params}` : ""}`);
  }

  return (
    <div className="w-40">
      <Select value={current ?? ""} onChange={handleChange}>
        {SOURCES.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </Select>
    </div>
  );
}
