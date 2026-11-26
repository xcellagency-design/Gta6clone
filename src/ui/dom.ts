/** Tiny DOM helper: el('div.hud-cash', 'text') or el('button', { onclick }, child…). */
export function el<K extends keyof HTMLElementTagNameMap>(
  spec: K | `${K}.${string}`,
  ...rest: (string | Node | Partial<HTMLElementTagNameMap[K]> | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const [tag, ...cls] = (spec as string).split('.');
  const e = document.createElement(tag) as HTMLElementTagNameMap[K];
  if (cls.length) e.className = cls.join(' ');
  for (const r of rest) {
    if (r == null) continue;
    if (typeof r === 'string') e.append(r);
    else if (r instanceof Node) e.append(r);
    else Object.assign(e, r);
  }
  return e;
}
