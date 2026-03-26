"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FileTreeEditor } from "@/components/file-tree-editor";
import type { FlatFile } from "@/components/file-tree-editor";
import { adminFetch } from "@/app/admin/lib/api";
import { ImportSkillDialog } from "./import-skill-dialog";

interface AgentSkill {
  folder: string;
  files: Array<{ path: string; content: string }>;
}

export function SkillsEditor({ agentId, initialSkills }: { agentId: string; initialSkills: AgentSkill[] }) {
  const router = useRouter();
  const [importOpen, setImportOpen] = useState(false);
  const [extraSkills, setExtraSkills] = useState<AgentSkill[]>([]);

  // Merge server skills + locally imported (unsaved) skills into flat files
  const allSkills = useMemo(() => [...initialSkills, ...extraSkills], [initialSkills, extraSkills]);

  const flatFiles = useMemo<FlatFile[]>(() =>
    allSkills.flatMap(s =>
      s.files.map(f => ({
        path: s.folder === "(root)" ? f.path : `${s.folder}/${f.path}`,
        content: f.content,
      })),
    ),
    [allSkills],
  );

  const existingFolders = useMemo(
    () => allSkills.map((s) => s.folder),
    [allSkills],
  );

  function handleImported(skill: { folder: string; files: Array<{ path: string; content: string }> }) {
    setExtraSkills((prev) => [...prev, skill]);
  }

  async function handleSave(files: FlatFile[]) {
    // Convert flat files back to grouped { folder, files }[] for the API
    const folderMap = new Map<string, Array<{ path: string; content: string }>>();
    for (const file of files) {
      const slashIdx = file.path.lastIndexOf("/");
      if (slashIdx === -1) {
        const existing = folderMap.get("(root)") ?? [];
        existing.push({ path: file.path, content: file.content });
        folderMap.set("(root)", existing);
      } else {
        const folder = file.path.slice(0, slashIdx);
        const fileName = file.path.slice(slashIdx + 1);
        const existing = folderMap.get(folder) ?? [];
        existing.push({ path: fileName, content: file.content });
        folderMap.set(folder, existing);
      }
    }
    const skills = Array.from(folderMap.entries()).map(([folder, files]) => ({ folder, files }));

    await adminFetch(`/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify({ skills }),
    });
    setExtraSkills([]); // Clear local imports after save
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-muted-foreground/25 p-5">
      <div className="flex items-center justify-between mb-4">
        <div />
        <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
          Import from skills.sh
        </Button>
      </div>
      <FileTreeEditor
        initialFiles={flatFiles}
        onSave={handleSave}
        title="Skills"
        saveLabel="Save Skills"
        addFolderLabel="Folder"
        newFileTemplate={{ filename: "SKILL.md", content: "---\nname: New Skill\ndescription: Describe when this skill should be triggered\n---\n\n# Instructions\n\nDescribe what this skill does...\n" }}
      />
      <ImportSkillDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={handleImported}
        existingFolders={existingFolders}
      />
    </div>
  );
}
