import { todo } from "./_util.js";

/**
 * packageReleaseApp —— 把各模块的 hap 合成一个 .app
 *
 * Gradle 的动作：
 *   1. 收集各模块 PackageHap 的输出，按规则过滤
 *   2. 生成 pack.info 与 app.info 写进输出目录
 *   3. 把过滤后的 hap 复制到 outDir/app/*-unsigned.hap
 *   4. 有 EntryCard 时先跑一次 --mode res
 *   5. 调 java -jar 打包工具 --mode app --hap-path … --pack-info-path … --out-path … --force
 *   6. 失败抛 Package app failed
 *
 * 过滤规则是关键（PackageApp.getHapPathFiles）：
 *   非 .hap 的跳过；文件名含 -bin- 且 deviceType 含 liteWearable 的也跳过。
 *   所以 .bin 形态的 hap 进不了 .app，只有文件树形态进得去 —— 这正好解释了
 *   为什么进 app 的那个 hap 与 entry-release-lite.hap 字节数完全相同。
 *
 * 输出：outputs/app/release/<工程名>-release-unsigned.app
 */

export const name = "packageReleaseApp";
export const produces = "app/release/<工程名>-release-unsigned.app";

export function run(ctx) {
  todo(
    name,
    "要生成 pack.info / app.info，过滤掉 -bin- 形态的 hap，再打成 .app 容器。" +
      "输入是各模块文件树形态的 hap，而那个形态目前也还没实现（见 packageReleaseHap）"
  );
}

export function verify(ctx) {
  const theirs = ctx.appSample
    ? `${ctx.appSample}/outputs/app/release`
    : "(没有配置 app 样本目录)";
  return { ok: false, detail: `还没实现。对照物应该在 ${theirs}` };
}
