"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface FileTreeFile {
  path: string;
  content: string;
}

export interface FileTreeFolder {
  folder: string;
  files: FileTreeFile[];
}

function getLanguageExtension(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "md":
      return [markdown()];
    case "json":
      return [json()];
    case "js":
    case "ts":
    case "jsx":
    case "tsx":
      return [javascript({ typescript: ext === "ts" || ext === "tsx", jsx: ext === "jsx" || ext === "tsx" })];
    default:
      return [];
  }
}

interface FileTreeEditorProps {
  initialFiles: FileTreeFolder[];
  onSave: (files: FileTreeFolder[]) => Promise<void>;
  onChange?: (files: FileTreeFolder[]) => void;
  readOnly?: boolean;
  hideSave?: boolean;
  title?: string;
  saveLabel?: string;
  addFolderLabel?: string;
  newFolderTemplate?: FileTreeFile;
}

export function FileTreeEditor({
  initialFiles,
  onSave,
  onChange,
  readOnly = false,
  hideSave = false,
  title = "Files",
  saveLabel = "Save",
  addFolderLabel = "Folder",
  newFolderTemplate = { path: "SKILL.md", content: "# New\n\nDescribe this...\n" },
}: FileTreeEditorProps) {
  const [folders, setFolders] = useState<FileTreeFolder[]>(initialFiles);
  const [selectedFolder, setSelectedFolder] = useState<number>(initialFiles.length > 0 ? 0 : -1);
  const [selectedFile, setSelectedFile] = useState<number>(initialFiles.length > 0 && initialFiles[0].files.length > 0 ? 0 : -1);
  const [saving, setSaving] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFileName, setNewFileName] = useState("");
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [showAddFile, setShowAddFile] = useState(false);
  const savedSnapshot = useRef(JSON.stringify(initialFiles));

  useEffect(() => {
    savedSnapshot.current = JSON.stringify(initialFiles);
    setFolders(initialFiles);
  }, [initialFiles]);

  // Notify parent of changes
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (onChangeRef.current && JSON.stringify(folders) !== savedSnapshot.current) {
      onChangeRef.current(folders);
    }
  }, [folders]);

  const isDirty = useMemo(
    () => JSON.stringify(folders) !== savedSnapshot.current,
    [folders],
  );

  const activeFile = selectedFolder >= 0 && selectedFile >= 0
    ? folders[selectedFolder]?.files[selectedFile]
    : null;

  function handleEditorChange(value: string) {
    if (readOnly || selectedFolder < 0 || selectedFile < 0) return;
    setFolders((prev) =>
      prev.map((folder, fi) =>
        fi === selectedFolder
          ? {
              ...folder,
              files: folder.files.map((file, si) =>
                si === selectedFile ? { ...file, content: value } : file,
              ),
            }
          : folder,
      ),
    );
  }

  function addFolder() {
    const name = newFolderName.trim();
    if (!name || folders.some((f) => f.folder === name)) return;
    const newFolder: FileTreeFolder = {
      folder: name,
      files: [{ ...newFolderTemplate, content: newFolderTemplate.content.replace("# New", `# ${name}`) }],
    };
    setFolders((prev) => [...prev, newFolder]);
    setSelectedFolder(folders.length);
    setSelectedFile(0);
    setNewFolderName("");
    setShowAddFolder(false);
  }

  function removeFolder(index: number) {
    if (!confirm(`Remove folder "${folders[index].folder}" and all its files?`)) return;
    setFolders((prev) => prev.filter((_, i) => i !== index));
    if (selectedFolder === index) {
      setSelectedFolder(folders.length > 1 ? 0 : -1);
      setSelectedFile(folders.length > 1 ? 0 : -1);
    } else if (selectedFolder > index) {
      setSelectedFolder((prev) => prev - 1);
    }
  }

  function addFile() {
    const name = newFileName.trim();
    if (!name || selectedFolder < 0) return;
    if (folders[selectedFolder].files.some((f) => f.path === name)) return;
    setFolders((prev) =>
      prev.map((folder, i) =>
        i === selectedFolder
          ? { ...folder, files: [...folder.files, { path: name, content: "" }] }
          : folder,
      ),
    );
    setSelectedFile(folders[selectedFolder].files.length);
    setNewFileName("");
    setShowAddFile(false);
  }

  function removeFile(folderIndex: number, fileIndex: number) {
    const file = folders[folderIndex].files[fileIndex];
    if (!confirm(`Remove file "${file.path}"?`)) return;
    setFolders((prev) =>
      prev.map((folder, i) =>
        i === folderIndex
          ? { ...folder, files: folder.files.filter((_, fi) => fi !== fileIndex) }
          : folder,
      ),
    );
    if (selectedFolder === folderIndex && selectedFile === fileIndex) {
      setSelectedFile(folders[folderIndex].files.length > 1 ? 0 : -1);
    } else if (selectedFolder === folderIndex && selectedFile > fileIndex) {
      setSelectedFile((prev) => prev - 1);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(folders);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <CardTitle className="text-base">{title}</CardTitle>
          {isDirty && !readOnly && <Badge variant="destructive" className="text-xs">Unsaved changes</Badge>}
          {readOnly && <Badge variant="secondary" className="text-xs">Read-only</Badge>}
        </div>
        {!readOnly && !hideSave && (
          <Button onClick={handleSave} disabled={saving || !isDirty} size="sm">
            {saving ? "Saving..." : saveLabel}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <div className="flex gap-4 min-h-[500px]">
          {/* File tree */}
          <div className="w-64 shrink-0 border border-border rounded-md overflow-hidden">
            <div className="p-2 bg-muted/50 border-b border-border flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{title}</span>
              {!readOnly && (
                <button
                  onClick={() => setShowAddFolder(!showAddFolder)}
                  className="text-xs text-primary hover:underline"
                >
                  + {addFolderLabel}
                </button>
              )}
            </div>
            {showAddFolder && !readOnly && (
              <div className="p-2 border-b border-border flex gap-1">
                <Input
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="folder-name"
                  className="h-7 text-xs"
                  onKeyDown={(e) => e.key === "Enter" && addFolder()}
                />
                <Button onClick={addFolder} size="sm" className="h-7 text-xs px-2">Add</Button>
              </div>
            )}
            <div className="text-sm">
              {folders.map((folder, fi) => (
                <div key={folder.folder}>
                  <div
                    className={`flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-muted/50 ${
                      selectedFolder === fi ? "bg-muted" : ""
                    }`}
                    onClick={() => {
                      setSelectedFolder(fi);
                      setSelectedFile(folder.files.length > 0 ? 0 : -1);
                    }}
                  >
                    <span className="font-medium text-xs truncate">{folder.folder}/</span>
                    {!readOnly && (
                      <button
                        onClick={(e) => { e.stopPropagation(); removeFolder(fi); }}
                        className="text-muted-foreground hover:text-destructive text-xs ml-1"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                  {selectedFolder === fi && (
                    <div className="ml-3 border-l border-border">
                      {folder.files.map((file, si) => (
                        <div
                          key={file.path}
                          className={`flex items-center justify-between px-3 py-1 cursor-pointer hover:bg-muted/30 ${
                            selectedFile === si ? "bg-primary/10 text-primary" : ""
                          }`}
                          onClick={() => setSelectedFile(si)}
                        >
                          <span className="text-xs truncate">{file.path}</span>
                          {!readOnly && (
                            <button
                              onClick={(e) => { e.stopPropagation(); removeFile(fi, si); }}
                              className="text-muted-foreground hover:text-destructive text-xs ml-1"
                            >
                              &times;
                            </button>
                          )}
                        </div>
                      ))}
                      {!readOnly && selectedFolder === fi && (
                        <div className="px-3 py-1">
                          {showAddFile ? (
                            <div className="flex gap-1">
                              <Input
                                value={newFileName}
                                onChange={(e) => setNewFileName(e.target.value)}
                                placeholder="file.md"
                                className="h-6 text-xs"
                                onKeyDown={(e) => e.key === "Enter" && addFile()}
                              />
                              <Button onClick={addFile} size="sm" className="h-6 text-xs px-2">+</Button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setShowAddFile(true)}
                              className="text-xs text-primary hover:underline"
                            >
                              + File
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {folders.length === 0 && (
                <p className="p-3 text-xs text-muted-foreground">
                  {readOnly ? "No files." : `No ${title.toLowerCase()} yet. Add a ${addFolderLabel.toLowerCase()} to get started.`}
                </p>
              )}
            </div>
          </div>

          {/* Editor */}
          <div className="flex-1 border border-border rounded-md overflow-hidden">
            {activeFile ? (
              <div className="h-full flex flex-col">
                <div className="px-3 py-1.5 bg-muted/50 border-b border-border text-xs text-muted-foreground">
                  {folders[selectedFolder].folder}/{activeFile.path}
                </div>
                <CodeMirror
                  value={activeFile.content}
                  onChange={handleEditorChange}
                  readOnly={readOnly}
                  theme={oneDark}
                  extensions={getLanguageExtension(activeFile.path)}
                  height="100%"
                  className="flex-1 overflow-auto"
                  basicSetup={{
                    lineNumbers: true,
                    foldGutter: true,
                    bracketMatching: true,
                  }}
                />
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                Select a file to {readOnly ? "view" : "edit"}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
