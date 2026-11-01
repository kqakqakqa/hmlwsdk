import { DEPENDS, findTask } from "./registerTasks.js";

/**
 * 按需构建 —— 给一个入口任务名，只跑它依赖的那些，不是把 15 个从头扫一遍
 *
 * 跟 Gradle 的行为一致：`gradlew packageReleaseApp` 不会带出资源编译那条链，
 * 因为它不在依赖图里。
 *
 * 依赖数据在 src/registerTasks.js 的 DEPENDS 表里，出处是报告的 kids 字段。
 */

/**
 * 解析出执行顺序（拓扑排序，前置任务在前）
 * @param {string} target 入口任务名，例如 signReleaseApp
 * @returns {string[]}
 */
export function resolveOrder(target) {
  if (!DEPENDS[target]) {
    throw new Error(`没有这个任务：${target}\n可用的入口有：${Object.keys(DEPENDS).join(", ")}`);
  }

  const order = [];
  const done = new Set();
  const stack = new Set();

  function visit(name) {
    if (done.has(name)) return;
    if (stack.has(name)) throw new Error(`依赖成环了：${name}`);
    if (!DEPENDS[name]) throw new Error(`依赖表里缺这个任务：${name}`);

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
 * 真跑
 *
 * @param {object} taskContext 见 src/createTaskContext.js 的 createTaskContext
 * @param {string} target 入口任务名
 * @param {(line:string)=>void} [log] 进度回调，默认打控制台
 * @returns {{ok:boolean, results:Array, failedAt?:string}}
 */
export function runBuild(taskContext, target, log = console.log) {
  const order = resolveOrder(target);
  const results = [];

  log(`── ${target}：要跑 ${order.length} 个任务 ────────────────`);

  for (const name of order) {
    const task = findTask(name);

    const t0 = Date.now();
    try {
      task.run(taskContext);
      const ms = Date.now() - t0;
      results.push({ name, ok: true, ms });
      log(`✓ ${name.padEnd(32)} ${String(ms).padStart(6)} ms`);
    } catch (e) {
      const ms = Date.now() - t0;
      const first = String(e.message ?? e).split("\n")[0];
      results.push({ name, ok: false, ms, error: String(e.message ?? e) });
      log(`✗ ${name.padEnd(32)} ${String(ms).padStart(6)} ms  ${first}`);
      return { ok: false, results, failedAt: name };
    }
  }

  log(`── 完成：${results.length} 个任务全部执行 ────────────────`);
  return { ok: true, results };
}
