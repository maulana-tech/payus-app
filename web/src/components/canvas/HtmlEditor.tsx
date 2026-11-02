"use client";

import { html as htmlLanguage } from "@codemirror/lang-html";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { createTheme } from "@uiw/codemirror-themes";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { useMemo, useRef } from "react";
import { useDashMode } from "@/components/dashboard/DashboardBackground";
import { MAX_HTML } from "@/features/storefront/config";

// A real editor for the one field that holds markup: line numbers, a gutter,
// highlighting, tags that close themselves. It is loaded only by the canvas
// (see CanvasEditor's dynamic import), so no other page pays for it.

const ink = {
  light: {
    bg: "#ffffff",
    fg: "#1d2318",
    gutter: "#9aa391",
    line: "#f4f5f1",
    tag: "#3f6212",
    attr: "#9a3412",
    text: "#1d2318",
    comment: "#8b9382",
    selection: "#dde4d4",
  },
  dark: {
    bg: "#14170f",
    fg: "#e8ebe2",
    gutter: "#6c7463",
    line: "#1b1f16",
    tag: "#a3c585",
    attr: "#e0a86b",
    text: "#e8ebe2",
    comment: "#79816f",
    selection: "#2c3323",
  },
} as const;

/** Nudges the editor's own metrics to the dashboard's type. */
const metrics = EditorView.theme({
  "&": { fontSize: "13px", height: "100%" },
  ".cm-scroller": {
    fontFamily: "var(--font-landing-mono), ui-monospace, monospace",
    lineHeight: "1.7",
    padding: "14px 0 40vh",
  },
  ".cm-content": { paddingInline: "4px" },
  ".cm-gutters": { border: "0", paddingRight: "6px" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 6px 0 14px" },
  ".cm-activeLine, .cm-activeLineGutter": { background: "transparent" },
  ".cm-focused .cm-activeLine": { background: "var(--cm-active, transparent)" },
});

export type HtmlEditorHandle = {
  /** Puts text where the caret is, which is what a toolbar button wants. */
  insert: (snippet: string) => void;
};

export default function HtmlEditor({
  value,
  onChange,
  handle,
}: {
  value: string;
  onChange: (next: string) => void;
  handle?: (api: HtmlEditorHandle | null) => void;
}) {
  const mode = useDashMode();
  const editor = useRef<ReactCodeMirrorRef>(null);

  const theme = useMemo(() => {
    const c = ink[mode];
    return createTheme({
      theme: mode,
      settings: {
        background: c.bg,
        foreground: c.fg,
        caret: c.fg,
        selection: c.selection,
        selectionMatch: c.selection,
        gutterBackground: c.bg,
        gutterForeground: c.gutter,
        gutterBorder: "transparent",
        lineHighlight: c.line,
      },
      styles: [
        { tag: tags.comment, color: c.comment, fontStyle: "italic" },
        { tag: [tags.tagName, tags.angleBracket], color: c.tag },
        { tag: tags.attributeName, color: c.attr },
        { tag: [tags.attributeValue, tags.string], color: c.fg },
        { tag: tags.content, color: c.text },
      ],
    });
  }, [mode]);

  return (
    <CodeMirror
      ref={(instance) => {
        editor.current = instance;
        handle?.(
          instance?.view
            ? {
                insert: (snippet) => {
                  const view = instance.view;
                  if (!view) return;
                  const at = view.state.selection.main;
                  view.dispatch({
                    changes: { from: at.from, to: at.to, insert: snippet },
                    selection: { anchor: at.from + snippet.length },
                  });
                  view.focus();
                },
              }
            : null,
        );
      }}
      value={value}
      height="100%"
      theme={theme}
      extensions={[
        htmlLanguage({ autoCloseTags: true }),
        EditorView.lineWrapping,
        metrics,
      ]}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: true,
        autocompletion: true,
        bracketMatching: true,
        closeBrackets: true,
        searchKeymap: false,
      }}
      onChange={(next) => onChange(next.slice(0, MAX_HTML))}
      className="h-full [&_.cm-editor]:h-full [&_.cm-editor]:outline-none"
    />
  );
}
