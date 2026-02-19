"use client";

import { useRouter } from "next/navigation";
import { FileTreeEditor } from "@/components/file-tree-editor";
import type { FileTreeFolder } from "@/components/file-tree-editor";

interface AgentSkill {
  folder: string;
  files: Array<{ path: string; content: string }>;
}

export function SkillsEditor({ agentId, initialSkills }: { agentId: string; initialSkills: AgentSkill[] }) {
  const router = useRouter();

  async function handleSave(skills: FileTreeFolder[]) {
    await fetch(`/api/admin/agents/${agentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skills }),
    });
    router.refresh();
  }

  return (
    <FileTreeEditor
      initialFiles={initialSkills}
      onSave={handleSave}
      title="Skills"
      saveLabel="Save Skills"
      addFolderLabel="Folder"
      newFolderTemplate={{ path: "SKILL.md", content: "# New\n\nDescribe this skill...\n" }}
    />
  );
}
