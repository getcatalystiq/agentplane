"use client";

import { useState, useMemo, useCallback } from "react";
import { useAgentPlaneClient } from "../../hooks/use-client";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { SectionHeader } from "../ui/section-header";
import { lazy, Suspense } from "react";

const CodeEditor = lazy(() => import("../ui/code-editor"));

interface AgentSkill {
  folder: string;
  files: Array<{ path: string; content: string }>;
}

interface FlatFile {
  path: string;
  content: string;
}

interface Props {
  agentId: string;
  initialSkills: AgentSkill[];
  onSaved?: () => void;
}

/**
 * Simplified skills editor that works without CodeMirror (which is a heavy
 * dependency). Uses plain textareas for editing skill content.
 */
export function AgentSkillManager({ agentId, initialSkills, onSaved }: Props) {
  const client = useAgentPlaneClient();

  const initialFiles = useMemo<FlatFile[]>(() =>
    initialSkills.flatMap(s =>
      s.files.map(f => ({
        path: s.folder === "(root)" ? f.path : `${s.folder}/${f.path}`,
        content: f.content,
      })),
    ),
    [initialSkills],
  );

  const [files, setFiles] = useState<FlatFile[]>(initialFiles);
  const [selectedPath, setSelectedPath] = useState<string | null>(files[0]?.path ?? null);
  const [saving, setSaving] = useState(false);
  const [addingFile, setAddingFile] = useState(false);
  const [newFileName, setNewFileName] = useState("");

  const isDirty = useMemo(
    () => JSON.stringify(files) !== JSON.stringify(initialFiles),
    [files, initialFiles],
  );

  const selectedFile = files.find(f => f.path === selectedPath);

  function updateFileContent(path: string, content: string) {
    setFiles(prev => prev.map(f => f.path === path ? { ...f, content } : f));
  }

  function addFile() {
    const name = newFileName.trim();
    if (!name || files.some(f => f.path === name)) return;
    const content = name.endsWith(".md")
      ? "---\nname: New Skill\ndescription: Describe when this skill should be triggered\n---\n\n# Instructions\n\nDescribe what this skill does...\n"
      : "";
    setFiles(prev => [...prev, { path: name, content }]);
    setSelectedPath(name);
    setAddingFile(false);
    setNewFileName("");
  }

  function removeFile(path: string) {
    setFiles(prev => prev.filter(f => f.path !== path));
    if (selectedPath === path) {
      setSelectedPath(files.find(f => f.path !== path)?.path ?? null);
    }
  }

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // Convert flat files back to grouped { folder, files }[]
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

      await client.agents.update(agentId, { skills });
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }, [files, agentId, client, onSaved]);

  return (
    <div className="rounded-lg border border-muted-foreground/25 p-5">
      <SectionHeader title="Skills">
        <div className="flex items-center gap-2">
          {isDirty && <Badge variant="destructive" className="text-xs">Unsaved</Badge>}
          <Button size="sm" variant="outline" onClick={() => setAddingFile(true)}>Add File</Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !isDirty}>
            {saving ? "Saving..." : "Save Skills"}
          </Button>
        </div>
      </SectionHeader>

      {addingFile && (
        <div className="flex items-center gap-2 mb-3">
          <Input
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            placeholder="folder/SKILL.md"
            className="max-w-xs text-sm"
            onKeyDown={(e) => e.key === "Enter" && addFile()}
          />
          <Button size="sm" onClick={addFile}>Add</Button>
          <Button size="sm" variant="ghost" onClick={() => { setAddingFile(false); setNewFileName(""); }}>Cancel</Button>
        </div>
      )}

      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No skills defined. Click &quot;Add File&quot; to create a skill.
        </p>
      ) : (
        <div className="flex gap-4 min-h-[300px]">
          {/* File list sidebar */}
          <div className="w-48 shrink-0 border-r border-border pr-3 space-y-1">
            {files.map((f) => (
              <div
                key={f.path}
                className={`flex items-center justify-between group rounded px-2 py-1 text-xs cursor-pointer ${
                  selectedPath === f.path ? "bg-accent text-accent-foreground" : "hover:bg-muted/50"
                }`}
                onClick={() => setSelectedPath(f.path)}
              >
                <span className="truncate">{f.path}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeFile(f.path); }}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive ml-1"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>

          {/* Editor */}
          <div className="flex-1 min-w-0">
            {selectedFile ? (
              <Suspense fallback={<div className="h-[300px] animate-pulse bg-muted/50 rounded" />}>
                <CodeEditor
                  value={selectedFile.content}
                  onChange={(val) => updateFileContent(selectedFile.path, val)}
                  filename={selectedFile.path}
                />
              </Suspense>
            ) : (
              <p className="text-sm text-muted-foreground">Select a file to edit</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
