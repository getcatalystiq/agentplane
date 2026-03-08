import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

interface Props {
  agentId: string;
  tenantId: string;
}

export function AgentHeaderActions({ agentId }: Props) {
  return (
    <Link
      href={`/admin/agents/${agentId}/playground`}
      className={buttonVariants({ variant: "outline", size: "sm" })}
    >
      Open Playground
    </Link>
  );
}
