// Minimal goal-oriented action planner (F.E.A.R.-style). Forward uniform-cost search over
// boolean world-state symbols; context-dependent costs let the same goal produce different
// plans (tap vs charge, smoke vs plain retreat).
export type Symbols = Record<string, boolean>;

export interface ActionDef<C> {
  name: string;
  pre: Symbols;
  eff: Symbols;
  cost(ctx: C): number;
  valid?(ctx: C): boolean;
}

const satisfies = (s: Symbols, req: Symbols): boolean => {
  for (const k in req) if ((s[k] ?? false) !== req[k]) return false;
  return true;
};

const keyOf = (s: Symbols): string =>
  Object.keys(s)
    .filter((k) => s[k])
    .sort()
    .join(',');

export function plan<C>(start: Symbols, goal: Symbols, actions: readonly ActionDef<C>[], ctx: C, maxDepth = 5): ActionDef<C>[] | null {
  if (satisfies(start, goal)) return [];
  const usable = actions
    .filter((a) => !a.valid || a.valid(ctx))
    .map((a) => ({ a, cost: Math.max(0.01, a.cost(ctx)) }));
  type Node = { state: Symbols; cost: number; path: ActionDef<C>[] };
  const open: Node[] = [{ state: { ...start }, cost: 0, path: [] }];
  const best = new Map<string, number>([[keyOf(start), 0]]);
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i]!.cost < open[bi]!.cost) bi = i;
    const node = open.splice(bi, 1)[0]!;
    if (satisfies(node.state, goal)) return node.path;
    if (node.path.length >= maxDepth) continue;
    for (const { a, cost } of usable) {
      if (!satisfies(node.state, a.pre)) continue;
      const next = { ...node.state, ...a.eff };
      const k = keyOf(next);
      const c = node.cost + cost;
      if ((best.get(k) ?? Infinity) <= c) continue;
      best.set(k, c);
      open.push({ state: next, cost: c, path: [...node.path, a] });
    }
  }
  return null;
}
