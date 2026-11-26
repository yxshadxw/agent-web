import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdownLanguage from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { Marked, type Token, type TokensList } from 'marked';
import { highlightQuotaWarningsHtml } from '../data';
import { copyText } from './clipboard';

const langs: Record<string, any> = {
  bash,
  c,
  cpp,
  css,
  diff,
  go,
  ini,
  java,
  javascript,
  json,
  markdown: markdownLanguage,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
};
for (const [name, definition] of Object.entries(langs)) {
  hljs.registerLanguage(name, definition);
}

const aliases: Record<string, string> = {
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rs: 'rust',
  html: 'xml',
  svelte: 'xml',
  vue: 'xml',
  toml: 'ini',
  yml: 'yaml',
  md: 'markdown',
  'c++': 'cpp',
};

function langFromFilename(filenameOrLang?: string): string {
  if (!filenameOrLang) return '';
  const clean = filenameOrLang.trim().toLowerCase();
  const dot = clean.lastIndexOf('.');
  const key = dot >= 0 ? clean.slice(dot + 1) : clean;
  return aliases[key] ?? key;
}

/**
 * Highlight source code and split into balanced per-line HTML strings so
 * multi-line spans (comments, template literals) never break across lines.
 */
export function highlightCodeLines(code: string, filenameOrLang?: string): string[] {
  const lang = langFromFilename(filenameOrLang);
  const rawHtml =
    lang && hljs.getLanguage(lang)
      ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      : escapeHtml(code);
  const safeHtml = DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: ['span'],
    ALLOWED_ATTR: ['class'],
  });
  const rawLines = safeHtml.split('\n');
  const openTags: string[] = [];
  return rawLines.map((line) => {
    const prefix = openTags.join('');
    const tagRegex = /<\/?span(?:\s+class="[^"]*")?>/g;
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(line)) !== null) {
      if (match[0] === '</span>') openTags.pop();
      else openTags.push(match[0]);
    }
    const suffix = '</span>'.repeat(openTags.length);
    return prefix + line + suffix;
  });
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]!,
  );

function highlight(code: string, lang?: string): string {
  const name = lang ? (aliases[lang.toLowerCase()] ?? lang.toLowerCase()) : '';
  if (name && hljs.getLanguage(name)) {
    return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
  }
  return escapeHtml(code);
}

const markdown = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }) {
      const label = (lang ?? '').split(/\s/)[0] || 'code';
      return (
        `<div class="code"><div class="code-bar"><span>${escapeHtml(label)}</span>` +
        `<button type="button" data-copy aria-label="코드 복사">복사</button></div>` +
        `<pre><code class="hljs">${highlight(text, label)}</code></pre></div>`
      );
    },
  },
});

let hooksInstalled = false;
if (!hooksInstalled) {
  hooksInstalled = true;
  // A remote image in generated text would be fetched as soon as it is drawn.
  // Keep inline data: images, but turn any other image into a deliberate link.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') ?? '';
      if (!/^data:image\//i.test(src)) {
        const link = node.ownerDocument.createElement('a');
        link.setAttribute('href', src);
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        link.className = 'remote-img';
        link.textContent = `🖼 ${node.getAttribute('alt') || src}`;
        node.replaceWith(link);
      }
      return;
    }
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

const sanitize = (html: string) =>
  DOMPurify.sanitize(html, {
    ADD_TAGS: ['button'],
    ADD_ATTR: ['target', 'data-copy'],
    FORBID_TAGS: ['style', 'form', 'input'],
  });

function render(src: string): string {
  return sanitize(markdown.parse(src, { async: false }) as string);
}

// Finished answers are redrawn when a session is reopened or the layout
// changes. Parsing and sanitising the same text again is wasted work.
const memo = new Map<string, string>();
const MEMO_ENTRIES = 300;
const MEMO_MAX_CHARS = 40_000;

// While an answer streams, only its last block changes. Keep every earlier
// block rendered so a long answer costs the same at the end as at the start.
const blocks = new Map<string, string>();
const BLOCK_ENTRIES = 400;

function renderBlock(token: Token, links: TokensList['links'], keep: boolean): string {
  if (keep) {
    const hit = blocks.get(token.raw);
    if (hit !== undefined) return hit;
  }
  const one = Object.assign([token], { links }) as TokensList;
  const out = sanitize(markdown.parser(one));
  if (keep) {
    blocks.set(token.raw, out);
    if (blocks.size > BLOCK_ENTRIES) {
      blocks.delete(blocks.keys().next().value as string);
    }
  }
  return out;
}

function renderStreaming(src: string): string {
  const tokens = markdown.lexer(src);
  if (tokens.length < 2) return render(src);
  let out = '';
  for (let index = 0; index < tokens.length; index += 1) {
    out += renderBlock(tokens[index], tokens.links, index < tokens.length - 1);
  }
  return out;
}

export function renderMarkdown(src: string, finished = false): string {
  if (!finished) return highlightQuotaWarningsHtml(renderStreaming(src));
  if (src.length > MEMO_MAX_CHARS) return highlightQuotaWarningsHtml(render(src));

  const hit = memo.get(src);
  if (hit !== undefined) {
    memo.delete(src);
    memo.set(src, hit);
    return hit;
  }

  const out = highlightQuotaWarningsHtml(render(src));
  memo.set(src, out);
  if (memo.size > MEMO_ENTRIES) {
    memo.delete(memo.keys().next().value as string);
  }
  return out;
}

export function handleMarkdownClick(event: { target: EventTarget | null }) {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLButtonElement>('button[data-copy]');
  if (!button) return;

  const code = button.closest('.code')?.querySelector('code')?.textContent ?? '';
  void copyText(code).then((ok) => {
    button.textContent = ok ? '복사됨' : '복사 실패';
    window.setTimeout(() => {
      if (button.isConnected) button.textContent = '복사';
    }, 1400);
  });
}
