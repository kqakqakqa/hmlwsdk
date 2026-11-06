import fs from "fs";
import path from "path";

import { writeZip } from "./readWriteZip.js";

/**
 * 打 .app —— 把文件树形态的 hap 和 pack.info 装进一个 zip
 *
 * 实测产物（devdemo release，同一份源码）：
 *   build/outputs/app/release/
 *     devdemo-release-unsigned.app   188260 B
 *     pack.info                        1142 B   ← 同时打进 .app
 *     appInfo.json                      203 B   ← 中间文件，不进 .app
 *
 * .app 内部只有两个条目，都是 deflate 压缩（method=8）：
 *   entry-release-lite.hap   2304041 B   ← 注意去掉了 "-unsigned"
 *   pack.info                   1142 B
 *
 * 过滤规则（PackageApp.getHapPathFiles）：
 *   非 .hap 的跳过；文件名含 "-bin-" 且 deviceType 含 liteWearable 的也跳过。
 *   所以 .bin 形态的 hap 进不了 .app，只有文件树形态进得去。
 *   实测印证：.app 里那份 hap 的字节数与 entry-release-lite-unsigned.hap 完全相同。
 */

/**
 * @param {object} opts
 * @param {string} opts.outDir       work/app
 * @param {string} opts.treeHapPath  文件树形态的 hap（.bin 形态的进不了 .app）
 * @param {object} opts.config       最终版 config
 * @returns {{appBuf:Buffer, appPath:string, packInfoPath:string}}
 */
export function packApp(opts) {
  const { outDir, hapBuf, hapName, config } = opts;

  fs.mkdirSync(outDir, { recursive: true });

  const moduleName = hapName.replace(/\.hap$/, "");

  // pack.info：summary（来自 config）+ packages（来自 hap 文件名）
  const packInfoText = JSON.stringify(buildPackInfo(config, moduleName), null, 4);
  const packInfoPath = path.join(outDir, "pack.info");
  fs.writeFileSync(packInfoPath, packInfoText);

  // .app 本体：两个条目，都 deflate 压缩
  const appBuf = writeZip(
    [
      { name: hapName, content: hapBuf },
      { name: "pack.info", content: Buffer.from(packInfoText) }
    ],
    { compress: true }
  );

  const projectName = config.app.bundleName.split(".").pop();
  const appPath = path.join(outDir, `${projectName}-release-unsigned.app`);
  fs.writeFileSync(appPath, appBuf);

  // appBuf 也返回：签名直接用它，不用把刚写下去的文件再读回来
  return { appBuf, appPath, packInfoPath };
}

/**
 * 从 config 拼出 pack.info
 *
 * 字段顺序照抄实测产物：deviceType → abilities → distro → apiVersion。
 * abilities 只保留 name 和 label，icon / type / homeAbility / iconId / labelId 都丢掉。
 */
function buildPackInfo(config, moduleName) {
  const m = config.module ?? {};
  const distro = m.distro ?? {};

  return {
    summary: {
      app: {
        bundleName: config.app.bundleName,
        version: config.app.version
      },
      modules: [
        {
          deviceType: m.deviceType ?? ["liteWearable"],
          abilities: (m.abilities ?? []).map((ab) => ({ name: ab.name, label: ab.label })),
          // 重新构造，不能直接引用 config 里的对象 —— 键序必须和 Gradle 一致：
          //   distro     moduleType → deliveryWithInstall → moduleName
          //   apiVersion compatible → releaseType → target
          distro: {
            moduleType: distro.moduleType ?? "entry",
            deliveryWithInstall: distro.deliveryWithInstall ?? true,
            moduleName: distro.moduleName ?? "entry"
          },
          apiVersion: {
            compatible: config.app.apiVersion.compatible,
            releaseType: config.app.apiVersion.releaseType,
            target: config.app.apiVersion.target
          }
        }
      ]
    },
    packages: [
      {
        deviceType: m.deviceType ?? ["liteWearable"],
        moduleType: distro.moduleType ?? "entry",
        deliveryWithInstall: distro.deliveryWithInstall ?? true,
        name: moduleName
      }
    ]
  };
}
