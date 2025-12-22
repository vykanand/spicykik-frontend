/*
  Bulk-sanitizes navigation links in mirrored HTML.

  What it changes:
  - Replaces ALL <a href=...> with href="#" (disables navigation)
  - Replaces ALL <area href=...> with href="#" (disables image-map navigation)
  - Replaces ALL <form action=...> with action="#" and adds onsubmit="return false" (prevents submits)
  - Replaces ALL formaction="..." (on buttons/inputs) with formaction="#" (prevents submit overrides)
  - Replaces <link rel="canonical"> href with "#"
  - Replaces <link rel="alternate" ...> href with "#" (only if it points to thesnacksmackindia.com)
  - Replaces <meta property="og:url"> content with "#" (only if it points to thesnacksmackindia.com)

  What it does NOT touch:
  - CSS loading (<link rel="stylesheet" ...>)
  - JS loading (<script src=...>)

  Usage:
    node scripts/sanitize-snack-html-links.js            (defaults to websites/snack)
    node scripts/sanitize-snack-html-links.js websites   (sanitizes all html under websites)
*/

const fs = require('fs');
const path = require('path');

const defaultRoot = path.join(__dirname, '..', 'websites', 'snack');
const argRoot = process.argv[2];
const ROOT = argRoot ? path.resolve(path.join(__dirname, '..', argRoot)) : defaultRoot;

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      const allowed = ['.html', '.htm', '.atom', '.xml'];
      if (allowed.includes(ext)) files.push(fullPath);
    }
  }
  return files;
}

function setAttrToHash(tag, attrName) {
  // Replace attrName="..." or attrName='...' or attrName=unquoted
  const quoted = new RegExp(`\\b${attrName}\\s*=\\s*(["'])([^"']*)\\1`, 'i');
  if (quoted.test(tag)) {
    return tag.replace(quoted, (m, q) => `${attrName}=${q}#${q}`);
  }
  const unquoted = new RegExp(`\\b${attrName}\\s*=\\s*([^\\s"'<>` + "`" + `]+)`, 'i');
  if (unquoted.test(tag)) {
    return tag.replace(unquoted, `${attrName}="#"`);
  }
  return tag;
}

function ensureOnSubmitReturnFalse(formTag) {
  // If already has onsubmit, leave it alone.
  if (/\bonsubmit\s*=\s*/i.test(formTag)) return formTag;
  // Insert onsubmit right after <form
  return formTag.replace(/^<form\b/i, '<form onsubmit="return false"');
}

function sanitizeHtml(html) {
  let out = html;

  // 1) Disable ALL anchor navigation.
  out = out.replace(/<a\b[^>]*>/gi, (tag) => setAttrToHash(tag, 'href'));

  // 1b) Disable ALL image-map navigation.
  out = out.replace(/<area\b[^>]*>/gi, (tag) => setAttrToHash(tag, 'href'));

  // 2) Disable ALL form navigation.
  out = out.replace(/<form\b[^>]*>/gi, (tag) => {
    let updated = setAttrToHash(tag, 'action');
    updated = ensureOnSubmitReturnFalse(updated);
    return updated;
  });

  // 2b) Disable submit overrides.
  out = out.replace(/<\w+\b[^>]*>/gi, (tag) => setAttrToHash(tag, 'formaction'));

  // 3) Canonical links are effectively navigation/SEO pointers.
  out = out.replace(/<link\b[^>]*\brel\s*=\s*(["'])canonical\1[^>]*>/gi, (tag) => {
    return setAttrToHash(tag, 'href');
  });

  // 4) OEmbed alternate links that point to thesnacksmackindia.com.
  out = out.replace(/<link\b[^>]*\brel\s*=\s*(["'])alternate\1[^>]*>/gi, (tag) => {
    const hrefMatch = tag.match(/\bhref\s*=\s*(["'])([^"']*)\1/i);
    if (!hrefMatch) return tag;
    const hrefVal = hrefMatch[2] || '';
    if (/^https?:\/\/thesnacksmackindia\.com\b/i.test(hrefVal)) {
      return setAttrToHash(tag, 'href');
    }
    return tag;
  });

  // 5) og:url meta tags that point to thesnacksmackindia.com.
  out = out.replace(/<meta\b[^>]*>/gi, (tag) => {
    if (!/\bproperty\s*=\s*(["'])og:url\1/i.test(tag)) return tag;
    const contentMatch = tag.match(/\bcontent\s*=\s*(["'])([^"']*)\1/i);
    if (!contentMatch) return tag;
    const contentVal = contentMatch[2] || '';
    if (/^https?:\/\/thesnacksmackindia\.com\b/i.test(contentVal)) {
      return setAttrToHash(tag, 'content');
    }
    return tag;
  });

  return out;
}

function main() {
  if (!fs.existsSync(ROOT)) {
    console.error(`Folder not found: ${ROOT}`);
    process.exit(1);
  }

  const files = walk(ROOT);
  let changed = 0;

  for (const filePath of files) {
    const before = fs.readFileSync(filePath, 'utf8');
    const after = sanitizeHtml(before);
    if (after !== before) {
      fs.writeFileSync(filePath, after, 'utf8');
      changed++;
    }
  }

  console.log(`Sanitized navigation links in ${changed}/${files.length} HTML files under ${ROOT}`);
}

main();
