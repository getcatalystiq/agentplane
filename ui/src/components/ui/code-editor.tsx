"use client";

import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";

function getLanguage(filename: string) {
  if (filename.endsWith(".md")) return markdown();
  if (filename.endsWith(".json")) return json();
  if (filename.endsWith(".js") || filename.endsWith(".ts") || filename.endsWith(".tsx")) return javascript({ typescript: filename.endsWith(".ts") || filename.endsWith(".tsx") });
  return markdown();
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  filename: string;
}

export default function CodeEditor({ value, onChange, filename }: Props) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={[getLanguage(filename)]}
      theme={oneDark}
      height="100%"
      minHeight="300px"
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        autocompletion: false,
      }}
      className="text-sm rounded overflow-hidden border border-border"
    />
  );
}
