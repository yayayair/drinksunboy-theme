// Which VIP brands count for each flavor (single flavor + the variety pack it's in).
export const FLAVORS = {
  'passion-fruit': { label: 'Passion Fruit', match: [/passion/i], packs: ['classic'] },
  pineapple: { label: 'Pineapple', match: [/pineapple/i], packs: ['classic', 'refresher'] },
  tangerine: { label: 'Tangerine', match: [/tangerine/i], packs: ['classic'] },
  mango: { label: 'Mango', match: [/mango/i], packs: ['classic'] },
  coconut: { label: 'Coconut', match: [/\bcoconut\b(?!\s*water)/i, /\bcoco\b/i], packs: ['refresher'] },
  peach: { label: 'Peach', match: [/peach/i], packs: ['refresher'] },
  guava: { label: 'Guava', match: [/guava/i], packs: ['refresher'] }
};
const PACKS = { classic: [/classic/i], refresher: [/refresh/i] };

export function brandsFor(flavor, all) {
  const f = FLAVORS[flavor];
  if (!f) return [];
  const rx = [...f.match, ...f.packs.flatMap(p => PACKS[p] || [])];
  return all.filter(b => rx.some(r => r.test(b)));
}
