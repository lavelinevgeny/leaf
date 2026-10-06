/** Example checker ONLY, not the leaf scheduling engine. No UI, storage or incomplete-graph support. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

function numericalExample(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  assert.equal(byId.size, tasks.length, 'Duplicate fixture IDs');
  const successors = Object.fromEntries(tasks.map((t) => [t.id, []]));
  const degrees = Object.fromEntries(tasks.map((t) => [t.id, t.predecessors.length]));
  for (const t of tasks) {
    assert.ok(Number.isInteger(t.duration) && t.duration > 0);
    for (const p of t.predecessors) {
      assert.ok(byId.has(p), 'Unknown fixture predecessor');
      successors[p].push(t.id);
    }
  }
  const queue = tasks.filter((t) => degrees[t.id] === 0).map((t) => t.id);
  const order = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]; order.push(id);
    for (const s of successors[id]) if (--degrees[s] === 0) queue.push(s);
  }
  if (order.length !== tasks.length) return { error: 'DEPENDENCY_CYCLE' };
  const ES = {}, EF = {}, LS = {}, float = {}, constrainedLS = {}, constraintFloat = {};
  for (const id of order) {
    const t = byId.get(id);
    const earliest = Math.max(0, t.notBefore ?? 0, ...t.predecessors.map((p) => EF[p]));
    if (t.fixedStart !== undefined) {
      assert.equal(t.fixedFinish - t.fixedStart, t.duration);
      if (earliest > t.fixedStart) return { error: 'FIXED_PRECEDENCE_CONFLICT' };
    }
    ES[id] = t.fixedStart ?? earliest;
    EF[id] = ES[id] + t.duration;
  }
  const finish = tasks.length ? Math.max(...Object.values(EF)) : null;
  for (const id of [...order].reverse()) {
    const t = byId.get(id);
    const lf = successors[id].length ? Math.min(...successors[id].map((s) => LS[s])) : finish;
    LS[id] = lf - t.duration;
    float[id] = LS[id] - ES[id];
    const constrainedFinish = successors[id].length ? Math.min(...successors[id].map((s) => constrainedLS[s])) : finish;
    constrainedLS[id] = t.fixedStart ?? (constrainedFinish - t.duration);
    constraintFloat[id] = constrainedLS[id] - ES[id];
  }
  const criticalTasks = order.filter((id) => float[id] === 0).sort();
  const criticalEdges = tasks.flatMap((t) => t.predecessors.filter((p) => float[p] === 0 && float[t.id] === 0 && EF[p] === ES[t.id]).map((p) => `${p}>${t.id}`)).sort();
  return { finish, criticalTasks, criticalEdges, ES, float, constraintFloat };
}
function calendarExample(c) {
  const date = new Date(`${c.start}T12:00:00.000Z`);
  const working = (d) => c.calendar === 'all-days' || (d.getUTCDay() !== 0 && d.getUTCDay() !== 6);
  assert.ok(working(date), 'Fixture starts on a nonworking day');
  for (let remaining = c.duration - 1; remaining > 0;) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (working(date)) remaining--;
  }
  const finishInclusive = date.toISOString().slice(0, 10);
  do { date.setUTCDate(date.getUTCDate() + 1); } while (!working(date));
  return { finishInclusive, nextFSStart: date.toISOString().slice(0, 10) };
}
export function checkFixtures(root) {
  const cpm = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/scheduling/cpm-cases.json'), 'utf8'));
  for (const c of cpm.cases) {
    const got = numericalExample(c.tasks);
    for (const [key, wanted] of Object.entries(c.expected)) assert.deepEqual(got[key], wanted, `CPM example ${c.id}: ${key}`);
  }
  const cal = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/scheduling/calendar-cases.json'), 'utf8'));
  for (const c of cal.cases) {
    const got = calendarExample(c);
    assert.equal(got.finishInclusive, c.finishInclusive, c.id);
    assert.equal(got.nextFSStart, c.nextFSStart, c.id);
  }
  return { cpm: cpm.cases.length, calendar: cal.cases.length };
}
