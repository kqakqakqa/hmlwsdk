import { DEPENDS, findTask } from "./registerTasks.js";

/**
 * 按需构建 —— 给一个入口任务名，只跑它依赖的那些，不是把 16 个从头扫一遍
 *
 * 跟 Gradle 的行为一致：`gradlew packageReleaseApp` 不会带出资源编译那条链，
 * 因为它不在依赖图里。
 *
 * 依赖数据在 src/registerTasks.js 的 DEPENDS 表里，出处是报告的 kids 字段。
 *
 * 两个导出：resolveOrder / plan 只算顺序，runBuild 真跑整条依赖链。
 */

/**
 * 解析出执行顺序（拓扑排序，前置任务在前）
 * @param {string} target 入口任务名，例如 signReleaseApp
 * @returns {string[]}
 */
export function resolveOrder(target) {
  if (!DEPENDS[target]) {
    throw new Error(`no such task: ${target}\navailable entry tasks: ${Object.keys(DEPENDS).join(", ")}`);
  }

  const order = [];
  const done = new Set();
  const stack = new Set();

  function visit(name) {
    if (done.has(name)) return;
    if (stack.has(name)) throw new Error(`dependency cycle: ${name}`);
    if (!DEPENDS[name]) throw new Error(`task missing from the DEPENDS table: ${name}`);

    stack.add(name);
    for (const dep of DEPENDS[name]) visit(dep);
    stack.delete(name);

    done.add(name);
    order.push(name);
  }

  visit(target);
  return order;
}

/**
 * 只算不跑，看某个入口会执行哪些任务
 * @returns {string[]}
 */
export function plan(target) {
  return resolveOrder(target);
}

/**
 * 跑单个任务并计时，失败不抛而是收进返回值
 *
 * async：compileReleaseJsWithNode 要 await wasm 版的 jerry-snapshot 生成 .bc，
 * 所以任务函数允许返回 Promise，这里统一 await。同步任务照旧直接返回，不受影响。
 *
 * @returns {{name:string, ok:boolean, ms:number, error?:string}}
 */
async function runOne(taskContext, name, log) {
  const task = findTask(name);
  if (!task) throw new Error(`task not registered: ${name}`);

  const t0 = Date.now();

  try {
    await task.run(taskContext);
    const ms = Date.now() - t0;
    log(`✓ ${name.padEnd(32)} ${String(ms).padStart(6)} ms`);
    return { name, ok: true, ms };
  } catch (e) {
    const ms = Date.now() - t0;
    const first = String(e.message ?? e).split("\n")[0];
    log(`✗ ${name.padEnd(32)} ${String(ms).padStart(6)} ms  ${first}`);
    return { name, ok: false, ms, error: String(e.message ?? e) };
  }
}

/**
 * 真跑
 *
 * @param {object} taskContext 见 src/createTaskContext.js 的 createTaskContext
 * @param {string} target 入口任务名
 * @param {(line:string)=>void} [log] 进度回调，默认打控制台
 * @returns {{ok:boolean, results:Array, failedAt?:string}}
 */
export async function runBuild(taskContext, target, log = console.log) {
  const order = resolveOrder(target);
  const results = [];

  log(`── ${target}: ${order.length} task(s) to run ────────────────`);

  for (const name of order) {
    const r = await runOne(taskContext, name, log);
    results.push(r);
    if (!r.ok) return { ok: false, results, failedAt: name };
  }

  log(`── done: all ${results.length} task(s) executed ────────────────`);
  return { ok: true, results };
}
