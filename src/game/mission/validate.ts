// Check every id a mission refers to against its level and itself. Returns readable problems.
import type { Level } from '../../level/load';
import { CREW_BARK_MAX, type Action, type Condition, type MissionDef, type PostureDef, type UnitDef } from './types';

export function validateMission(def: MissionDef, level: Level): string[] {
  const p: string[] = [];
  const markers = new Set(level.data.markers.map((m) => m.id));
  const zones = new Set(level.data.zones.map((z) => z.id));
  const paths = new Set(level.data.paths.map((x) => x.id));
  const places = new Set([...markers, ...zones]);
  const objectives = new Set(def.objectives.map((o) => o.id));
  const triggers = new Set<string>();
  const units = new Set<string>();

  if (def.level !== level.data.id) p.push(`mission level "${def.level}" does not match loaded level "${level.data.id}"`);
  if (def.start && !markers.has(def.start)) p.push(`start marker "${def.start}" does not exist`);

  const posture = (where: string, ps: PostureDef | undefined) => {
    if (!ps) return;
    if ('patrol' in ps && !paths.has(ps.patrol)) p.push(`${where}: path "${ps.patrol}" does not exist`);
    if ('guard' in ps && !markers.has(ps.guard)) p.push(`${where}: marker "${ps.guard}" does not exist`);
    if ('hold' in ps && !markers.has(ps.hold)) p.push(`${where}: marker "${ps.hold}" does not exist`);
  };
  const unit = (u: UnitDef, where: string) => {
    if (units.has(u.id)) p.push(`${where}: duplicate unit id "${u.id}"`);
    units.add(u.id);
    if (u.id === 'player' || u.id === 'any-enemy') p.push(`${where}: unit id "${u.id}" is reserved`);
    if (!markers.has(u.marker)) p.push(`${where}: unit "${u.id}" spawn marker "${u.marker}" does not exist`);
    posture(`${where} unit "${u.id}"`, u.posture);
  };
  def.units.forEach((u) => unit(u, 'units'));

  // Units spawned by triggers are valid targets too: collect them before checking references.
  const visitActions = (as: Action[], fn: (a: Action) => void) => {
    for (const a of as) {
      fn(a);
      if ('choice' in a) a.choice.options.forEach((o) => visitActions(o.do, fn));
    }
  };
  if (def.alarmRadius !== undefined && !(def.alarmRadius > 0)) p.push('alarmRadius must be a positive number');
  for (const t of def.triggers) {
    if (triggers.has(t.id)) p.push(`duplicate trigger id "${t.id}"`);
    triggers.add(t.id);
    visitActions(t.do, (a) => {
      if ('spawn' in a) (Array.isArray(a.spawn) ? a.spawn : [a.spawn]).forEach((u) => unit(u, `trigger "${t.id}" spawn`));
    });
  }

  const cond = (c: Condition, where: string) => {
    if ('all' in c) c.all.forEach((x) => cond(x, where));
    else if ('any' in c) c.any.forEach((x) => cond(x, where));
    else if ('not' in c) cond(c.not, where);
    else if ('enter' in c) {
      if (!zones.has(c.enter)) p.push(`${where}: zone "${c.enter}" does not exist`);
      if (c.who && c.who !== 'player' && c.who !== 'any-enemy' && !units.has(c.who)) p.push(`${where}: unit "${c.who}" does not exist`);
    } else if ('destroyed' in c) (Array.isArray(c.destroyed) ? c.destroyed : [c.destroyed]).forEach((u) => !units.has(u) && p.push(`${where}: unit "${u}" does not exist`));
    else if ('after' in c) {
      if (c.since && !triggers.has(c.since)) p.push(`${where}: trigger "${c.since}" does not exist`);
    } else if ('objective' in c && !objectives.has(c.objective)) p.push(`${where}: objective "${c.objective}" does not exist`);
  };
  for (const t of def.triggers) {
    const where = `trigger "${t.id}"`;
    cond(t.when, where);
    visitActions(t.do, (a) => {
      if ('bark' in a && a.bark.length > CREW_BARK_MAX) p.push(`${where}: bark "${a.bark}" is ${a.bark.length} characters (at most ${CREW_BARK_MAX}: say less, or use the intro dialogue)`);
      if ('objective' in a && !objectives.has(a.objective)) p.push(`${where}: objective "${a.objective}" does not exist`);
      if ('order' in a) {
        if (!units.has(a.order)) p.push(`${where}: unit "${a.order}" does not exist`);
        posture(where, a.posture);
      }
      if ('alarm' in a && a.at && !places.has(a.at)) p.push(`${where}: alarm location "${a.at}" does not exist`);
      if ('checkpoint' in a && !markers.has(a.checkpoint)) p.push(`${where}: checkpoint marker "${a.checkpoint}" does not exist`);
      if ('choice' in a) {
        const c = a.choice;
        if (c.options.length < 2) p.push(`${where}: a choice needs at least two options`);
        if (c.default !== undefined && (c.default < 0 || c.default >= c.options.length)) p.push(`${where}: choice default ${c.default} is out of range`);
      }
    });
  }
  return p;
}
