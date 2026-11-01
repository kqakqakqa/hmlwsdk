/**
 * signReleaseHap —— 给 hap 文件本身再签一层
 *
 * status: not planned
 *
 * 为什么不做：
 * Gradle 的 signReleaseHap 会在 hap 的中央目录前插一个 "HAP Sig Block 42"
 * （调 `hapsigntoolv2.jar sign -mode binlocaljks`），实测块结构已经逆出来了
 * （24 B 头 + p7b + CMS + 32 B 尾，7 个真实样本交叉验证过摘要算法）——
 * 但它不是本项目要的东西。liteWearable 的包在设备上验的是**里面那份 .bin
 * 自己的签名块**，hap 只是一个装着 bin 的 zip。所以按 hap-sign-utils 的做法，
 * 签好 bin、打成 hap 就够了，hap 这一层不加签。
 *
 * 这也意味着不产出 hapInfo.json —— packageReleaseHap 已经把 hap 出全了。
 *
 * Gradle 原本的动作（留档）：
 *   1. 按设备类型把 unsigned hap 分成 rich / lite 两组
 *   2. 逐个算出 signed 文件名（unsigned → signed）
 *   3. 配了证书就调 SignUtil → java -jar hapsigntoolv2.jar sign -mode binlocaljks
 *   4. signed 文件存在就用它，否则退回原包
 *   5. 按 packedMode 把 hap 复制到各设备目录
 *   6. 汇总写出 hapInfo.json（实测 apps/_empty 的 debug 产物 104 B）
 *
 * 保留这个文件只是让任务清单和 doc/gradle-build-report.html 的卡片对得上。
 */

export const name = "signReleaseHap";
export const status = "not planned";
export const produces = "无";

export function run() {
  return null;
}
