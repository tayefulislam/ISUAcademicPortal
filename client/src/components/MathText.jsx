import { useMemo } from 'react';
import katex from 'katex';

// Renders plain text containing LaTeX delimited by $$...$$ (display) or
// $...$ (inline), falling back to the raw segment if KaTeX can't parse it —
// a bad expression should never crash the whole page. This is deliberately
// lighter than a full "auto-render" extension: quiz text only ever needs
// these two delimiter styles, entered via the editor's snippet buttons
// (see QuestionForm.jsx), never hand-written HTML.
function renderSegments(text) {
  const segments = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = re.exec(text))) {
    if (match.index > lastIndex) segments.push({ key: key++, type: 'text', value: text.slice(lastIndex, match.index) });
    const display = match[1] !== undefined;
    const expr = display ? match[1] : match[2];
    segments.push({ key: key++, type: 'math', value: expr, display });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) segments.push({ key: key++, type: 'text', value: text.slice(lastIndex) });
  return segments;
}

export default function MathText({ text, className = '' }) {
  const segments = useMemo(() => renderSegments(String(text || '')), [text]);

  return (
    <span className={className}>
      {segments.map((seg) => {
        if (seg.type === 'text') return <span key={seg.key} style={{ whiteSpace: 'pre-wrap' }}>{seg.value}</span>;
        let html;
        try {
          html = katex.renderToString(seg.value, { throwOnError: false, displayMode: seg.display });
        } catch {
          html = seg.value;
        }
        const Tag = seg.display ? 'div' : 'span';
        return <Tag key={seg.key} dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </span>
  );
}
