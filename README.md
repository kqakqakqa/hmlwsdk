# hmlwsdk

纯 JavaScript 实现的 HarmonyOS **liteWearable（轻智能手表）**应用打包链。输入一个标准 DevEco 工程目录，输出 `.bin`、hap 和 `.app`。

```bash
hmlwsdk buildSignedApp /path/to/your/project --p7b my.p7b --key private-pkcs8.pem
```

运行只需要 Node.js 18 以上。不读本机安装的 HarmonyOS SDK，不需要 JDK、Gradle，也不依赖 native 二进制。

---

## 目录

- [覆盖范围](#覆盖范围)
- [环境要求](#环境要求)
- [安装](#安装)
- [快速开始](#快速开始)
- [命令参考](#命令参考)
- [工程要求](#工程要求)
- [产物](#产物)
- [构建流程](#构建流程)
- [签名](#签名)
- [已验证的部分](#已验证的部分)
- [已知差异与局限](#已知差异与局限)
- [故障排查](#故障排查)
- [作为库使用](#作为库使用)
- [目录结构](#目录结构)
- [参与开发](#参与开发)

---

## 覆盖范围

一条 liteWearable 应用的构建链从工程目录走到可安装的包，涉及五个环节：

| 环节 | Gradle 插件的做法 | 这里的实现 |
|---|---|---|
| 资源编译 | `restool.exe` 出 `resources.index` / `R.txt` / `*.bin` | `src/compileResources.js`。格式按华为开源的 `developtools_global_resource_tool` 复现，再用 api6 的 `restool.exe` 跑样本逐字节核对 |
| JS/HML/CSS 编译 | `node + webpack`（ace-loader） | 同一份 ace-loader，以 submodule 形式放在 `src/ace-loader/` |
| JS 字节码 | `jerry-snapshot.exe` 出 `*.bc` | `src/jerry-parser-wasm/`：jerryscript v2.1.0 编译成的 wasm，进程内调用，产物与 `jerry-snapshot.exe` 逐字节一致 |
| 打包 `.bin` | `hmos_haptobin_tool.jar` | `src/readWriteBin.js` |
| 签名 | `hapsigntoolv2.jar` | `src/sign/` |

表中后四个环节都是纯 JS。签名算法和 `.bin` 容器格式都来自 `hap-sign-utils`，在它的基础上改造而成；资源编译的格式细节取自上面提到的开源 C++ 源码。

产物与 Gradle 插件的产物字节级一致，逐项对照见[已验证的部分](#已验证的部分)。

### 规模与耗时

Gradle 的 `assembleRelease` 实测进 117 个 task。这里没有任务系统，`src/build.js` 一条顺序函数走完，
按命令不同是 6~10 步（`buildBin` 6 步、`buildApp` 8 步、`buildSignedApp` 10 步，给了 `--p7b` 各加一步签名）。

实测 devdemo 的 release 全链，资源编译 66 ms、webpack 5.3 s，其余步骤都在毫秒级。

| 依赖 | Gradle 插件 | hmlwsdk |
|---|---|---|
| JDK | 需要 | 不需要 |
| HarmonyOS SDK | 需要 | 不需要（ace-loader 随仓库提供） |
| DevEco Studio | 需要 | 不需要 |
| Node.js | 由 DevEco 内置 | >= 18 |

---

## 环境要求

- **Node.js >= 18**（`package.json` 的 `engines` 字段）
- 磁盘空间：`src/ace-loader/node_modules` 约 133 MB（含图片转换用的 `sharp`）
- 不需要 JDK、Python、CMake、emsdk

Windows / macOS / Linux 上行为一致。`.bc` 由 `src/jerry-parser-wasm/` 在进程内生成，不起子进程。

---

## 安装

```bash
git clone --recursive https://github.com/kqakqakqa/hmlwsdk.git
cd hmlwsdk
npm install

# ace-loader 是 git submodule，要单独装依赖
cd src/ace-loader
npm install
cd ../..
```

然后把 `bin/` 加进 PATH，就能直接敲 `hmlwsdk`：

```bash
# Windows（PowerShell，写进用户环境变量，重开终端生效）
[Environment]::SetEnvironmentVariable("Path", "E:\path\to\hmlwsdk\bin;" + $env:Path, "User")

# macOS / Linux（写进 ~/.bashrc 或 ~/.zshrc）
export PATH="/path/to/hmlwsdk/bin:$PATH"
```

```bash
hmlwsdk buildBin /path/to/project
```

`bin/` 下有三个文件，都是入口，只是装法不同：

| 文件 | 谁用 |
|---|---|
| `bin/hmlwsdk.js` | 真正的实现，`package.json` 的 `bin` 字段指向它（`npm link` / `npm install -g` 用） |
| `bin/hmlwsdk.cmd` | Windows 的 cmd / PowerShell。**Windows 不认 shebang**，缺了它把 `bin/` 加进 PATH 也敲不动 |
| `bin/hmlwsdk` | macOS / Linux 的 sh 包装。从 Windows 上 clone 的仓库没有执行位，要 `chmod +x bin/hmlwsdk` |

不想动 PATH 也可以走 `npm link`，它会在 npm 的全局 bin 目录里生成同类的 shim：

```bash
npm link
hmlwsdk buildBin /path/to/project
```

如果克隆时忘了 `--recursive`：

```bash
git submodule update --init
```

根目录只有一个第三方依赖：

- `jsrsasign` —— CMS SignedData 的 ASN.1 编码

PNG 压缩用 Node 内置的 `node:zlib`，不额外引包。压缩参数按 libpng 的规则配（level 9 / memLevel 8 / Z_FILTERED），产物字节随 Node 内置 zlib 的版本走，不与 Gradle 逐字节一致 —— PNG 是无损的，解压后像素相同，设备读的也是像素。详见 [`src/compressPng.js`](src/compressPng.js) 的注释。

---

## 快速开始

```bash
# 只出 .bin
hmlwsdk buildBin /path/to/apps/devdemo/devdemo

# 出 .app（顺带把两种 hap 和 .bin 都出了）
hmlwsdk buildApp /path/to/apps/devdemo/devdemo

# 出「里面那个 .bin 已签名」的 hap
hmlwsdk buildSignedHap /path/to/apps/devdemo/devdemo --p7b my.p7b --key private-pkcs8.pem

# 出签名的 app
hmlwsdk buildSignedApp /path/to/apps/devdemo/devdemo --p7b my.p7b --key private-pkcs8.pem
```

---

## 命令参考

### 基本形式

```
hmlwsdk <命令> <工程目录> [选项]
```

四条命令 = 两个停止点（`.bin` / hap 或 `.app`）× 有没有签名配置。

| 命令 | 做什么 | 产出（相对 work） |
|---|---|---|
| `buildBin` | 只构建 `.bin` | `bin/entry-release-unsigned.bin` |
| `buildApp` | 构建到 `.app`，顺带把两种 hap 和 `.bin` 都出了 | `app/<工程名>-release-unsigned.app` + `pack.info`<br>`hap/entry-bin-release-lite-unsigned.hap`<br>`hap/entry-release-lite-unsigned.hap`<br>`bin/entry-release-unsigned.bin` |
| `buildSignedHap` | 构建 + 签名，出可以装表的 hap | `hap/entry-bin-release-lite-signed.hap` |
| `buildSignedApp` | 构建 + 签名，出签名的 `.app` | `app/<工程名>-release-signed.app` |

`buildSignedHap` / `buildSignedApp` **必须给 `--p7b`**，不给直接报错 —— 命令名承诺了要出签名产物，静默退回 unsigned 是坑。
`buildBin` / `buildApp` 给了 `--p7b` 也会顺带签名，与 Gradle 没配 `signingConfig` 就出 unsigned 的行为一致。

**没有单独的签名命令，也没有 `buildHap`。** 未签名的 hap 和 `.bin` 都是中间产物，照样留在 work 目录里。

### 构建步骤

没有任务系统、没有依赖图 —— `src/build.js` 就是一条顺序函数，命令只是它的 `target` 别名：

```
buildBin       → bin
buildApp       → app
buildSignedHap → signedHap
buildSignedApp → signedApp
```

| 步骤 | 做什么 | 产出（相对 work） |
|---|---|---|
| `read project` | 读 build.gradle 的版本号 + 源码 config.json | 无 |
| `merge config` | 注入 apiVersion、abilities 默认值 | 无（传对象，不落盘） |
| `compile resources` | 编译资源（JS 实现，原 restool 的活） | `source/assets/entry/resources.index` + `resources/`<br>`R.txt` |
| `compile js` | node + webpack 编译，再出 `.bc` | `source/assets/js/<组件>/*.js` `*.bc`<br>`manifest/<组件>/manifest.json` |
| `assemble assets` | 回填资源 id、定型 config、删多余文件 | `source/config.json` |
| `write bin` | 打成 `.bin` 私有容器 | `bin/entry-release-unsigned.bin` |
| `sign bin` | 签 `.bin`（有 `--p7b` 才跑） | `bin/entry-release-signed.bin` |
| `pack bin hap` | `.bin` 装进 hap —— **设备直接装的就是这种** | `hap/entry-bin-release-lite-unsigned.hap` |
| `pack tree hap` | 文件树形态的 hap，只进 `.app` | `hap/entry-release-lite-unsigned.hap` |
| `pack app` | 打 `.app` | `app/<工程名>-release-unsigned.app` + `pack.info` |
| `sign app` | 签 `.app`（有 `--p7b` 才跑） | `app/<工程名>-release-signed.app` |

中间态一律用变量传，不落盘：资源直接编译进 `source/assets/entry`（没有独立的资源输出目录再拷一遍），
`.bin` 和 hap 的 Buffer 留在内存里给下一步用，不会写完再读回来。必须落盘的只有三类 ——
webpack 的输入 manifest、webpack 的输出目录、最终产物；前两个是因为 webpack 是独立进程，只能靠文件系统交接。

### 选项

| 选项 | 说明 |
|---|---|
| `--work <目录>` | 中间产物目录，默认 `<工程目录>/build/hmlwsdk` |
| `--p7b <文件>` | HarmonyOS profile。`buildSignedHap` / `buildSignedApp` 必给；`buildBin` / `buildApp` 给了才签 |
| `--p12 <文件>` | PKCS#12 私钥库，配合 `--p12pwd` |
| `--p12pwd <密码>` | p12 密码 |
| `--key <文件>` | 直接给 PEM 私钥，与 `--p12` 二选一 |
| `--cert <文件>` | 替换内置的华为根 + 中间证书链 |

`buildBin` / `buildApp` 不给 `--p7b` 就是「不签」，与 Gradle 没配 `signingConfig` 时的行为一致 —— 出 unsigned 包，下游拿 unsigned 当 signed 用。

### 示例

```bash
# 只出 .bin，不签名
hmlwsdk buildBin apps/devdemo/devdemo

# 出签名的 app，PKCS#12 私钥库
hmlwsdk buildSignedApp apps/devdemo/devdemo \
  --p7b my.p7b --p12 my.p12 --p12pwd 123456

# 出签名的 hap，裸 PEM 私钥
hmlwsdk buildSignedHap apps/devdemo/devdemo \
  --p7b my.p7b --key private-pkcs8.pem

# 中间产物放到别处
hmlwsdk buildApp apps/devdemo/devdemo --work /tmp/hmlw-build
```

---

## 工程要求

### 目录形状

`<工程目录>` 指向**含 `entry/` 的那一级**，不是 `entry` 本身：

```
<工程目录>/
  entry/
    build.gradle              ← 必须有 compileSdkVersion / compatibleSdkVersion
    src/main/
      config.json             ← 必须有
      resources/              ← 资源根
        base/element/         ← string.json 之类，按 resType 分
        base/media/           ← 图片
        rawfile/              ← 原样拷进包的文件
        dark/  zh_CN/  …      ← 其它限定目录，可选
      js/
        default/              ← 组件目录，名字由 config.json 的 module.js 指定
          app.js              ← 必须有，否则 webpack 报 missing app.js
          pages/
          …
```

组件目录下**不需要**放 `manifest.json` —— 那是 `compile js` 按 `config.json` 拼出来传给 webpack 当 `aceManifestPath` 的。

CLI 启动时会检查 `entry/src/main/config.json` 存在，不存在直接报错退出。

### build.gradle 的两个字段

```
compileSdkVersion 6
compatibleSdkVersion 3
```

`key value` 和 `key = value` 两种写法都认。这两个值决定 `config.json` 里的 `app.apiVersion.target` / `.compatible`。

**读不到就报错，不猜默认值** —— 静默用错版本比直接失败更难查（早先这两个值写死成 6 / 3，换个工程 `apiVersion` 就是错的）。

### config.json

`module.js` 至少有 1 个组件；每个组件在 `src/main/js/<组件名>/` 下必须有 `app.js`，否则 webpack 报 `ERROR: missing app.js`（ace-loader 检查的就是这个文件）。

### 资源限制

`element/` 下的 JSON 支持这些 `resType`：

```
integer  string  strarray  intarray  boolean  color
theme    plural  float     pattern
```

api6 的 restool **不支持** `symbol`（报 `Json tag symbol is invalid`）和 `id`（报 `ParseJsonNodeByType unsupport ResType15`），本 SDK 照此拒收。`id` 资源要走 `base/element/id_defined.json`，不是普通 JSON。

---

## 产物

### 最终交付物

| 产物 | 路径（相对 work） | 说明 |
|---|---|---|
| `.bin`（未签名） | `bin/entry-release-unsigned.bin` | 私有容器，设备真正验签的对象 |
| `.bin`（签名） | `bin/entry-release-signed.bin` | 有 `--p7b` 时才有 |
| hap（`.bin` 形态） | `hap/entry-bin-release-lite-unsigned.hap` | 单条目，只有那个 `.bin`，stored 不压缩。**设备直接装的就是这种** |
| hap（`.bin` 形态，已签名） | `hap/entry-bin-release-lite-signed.hap` | `buildSignedHap` 的产物：里面那个 `.bin` 已签名，**不带 zip 签名块**。Gradle 的同名产物会多插一个 `HAP Sig Block 42`（实测差 6585 B），本 SDK 不插，理由见[签名](#签名) |
| hap（文件树形态） | `hap/entry-release-lite-unsigned.hap` | 所有源文件打平成一个 zip（devdemo 实测 92 个条目），全部 stored，无目录条目。只进 `.app` |
| `.app`（未签名） | `app/<工程名>-release-unsigned.app` | 装一份文件树形态 hap + `pack.info`，deflate 压缩 |
| `.app`（签名） | `app/<工程名>-release-signed.app` | 有 `--p7b` 时才有 |

注意两点：

- **两种 hap 形态是 release 独有的**。反编译 `SingleLiteOptionsBuilder.executePack` 确认：liteWearable 一定先跑 `binBuilder` 出 `.bin` 形态，要不要再跑 `jsBundleBuilder` 出文件树形态看 `VariantData.isNeedPackage()`，而 `selectedBuildType` 默认取 `RELEASE`。debug 只出 `.bin` 形态。
- **进 `.app` 的只有文件树形态**。`PackageApp.getHapPathFiles()` 会过滤掉「文件名含 `-bin-` 且 deviceType 含 liteWearable」的包。实测印证：`.app` 里那份 hap 的字节数与 `entry-release-lite-unsigned.hap` 完全相同。

### `.bin` 内部布局

```
config.json
assets/entry/resources.index
assets/entry/resources/base/media/*.key|*.bin|*.png
assets/entry/resources/rawfile/*
assets/js/default/app.js / app.bc / manifest.json
assets/js/default/common/*.bin|*.png
assets/js/default/pages/ 下每个页面各一个 .js 和一个 .bc
```

其中 `.png` 和 `.bin` 并存的那些 `.bin` **不是资源编译的产物** —— 是 ace-loader 的 `lib/lite/lite-image2bin.js` 在 webpack 阶段顺手做的图片转换（`webpack.lite.config.js` 第 185 行）。它同时写 `xxx.bin` 和 `xxx.png.bin` 两份，`assembleAssets` 负责把双后缀那份删掉 —— Gradle 的产物里一个 `.png.bin` 都没有。

图片转 `.bin` 的格式（本 SDK 不负责转，但换 ace-loader 版本时要靠它判断）：

```
offset 0   LE uint32   固定 256
offset 4   LE uint32   width | (height << 16)
offset 8   width*height*4 字节，裸 BGRA 像素，无压缩
```

### work 目录怎么清

没有增量缓存 —— 重复跑会覆盖，要干净重来就删掉 work 目录。完整布局：

```
work/
  R.txt                       资源 id 表（只用来回填 config，不进包）
  manifest/<组件>/manifest.json   webpack 的输入
  cache/                      webpack 缓存
  source/
    config.json               最终打进包的 config
    assets/entry/             资源编译的产物（+ img2bin 补的 icon.bin）
    assets/js/<组件>/          webpack 的产物
  bin/                        *.bin
  hap/                        *.hap
  app/                        *.app + pack.info
```

⚠ `assembleAssets` **不能**整体清空 `source/`：webpack 已经把 `assets/js/**` 写在那儿了，整体清空会把 81 个文件删掉（之前 `.bin` 里只剩 `config.json` 一个条目就是这个原因）。它只清根下多余的东西和双后缀 `.png.bin`。

⚠ 反过来，`compile resources` 那一步**要**先清 `source/assets/entry` —— 工程里删掉的资源不会自己消失，留下的旧文件会被打进 `.bin`。

---

## 构建流程

### 唯一顺序来源

`src/build.js`。没有任务表、没有依赖图、没有跨步骤的 context 对象 —— 那些在 Gradle 里是为了声明式地拼装 117 个 task 才需要的，这里整条链 6~10 步，顺序写出来一眼能看完。

形状是这样（资源和 JS 两支并行，在组装处汇合）：

```
读工程 → 加工 config ┬─ 编译资源 ─┬─ 定型 source/ → 写 .bin ─┬─ 签 .bin ─┐
                     └─ 编译 JS ──┘                         │          ├→ 打 hap（.bin 形态）
                                                            └→ 打 hap（文件树）→ 打 .app → 签 .app
```

`target` 决定停在哪个产物上。表里「有 `--p7b` 才跑」的那两步，对应 Gradle 没配 `signingConfig` 就出 unsigned 的行为。

### 每步做的具体事

| 步骤 | 关键点 |
|---|---|
| `read project` | 从模块的 `build.gradle` 读 `compileSdkVersion` / `compatibleSdkVersion`，读不到直接报错，不猜默认值 |
| `merge config` | 按 `build.gradle` 填 `app.apiVersion`、release **不写** `deviceConfig.default.debug`、`abilities` 里缺 `homeAbility` 的补 `false`。Gradle 的 `processProfile` 那一步实测只调键顺序，已合并到这里 |
| `compile resources` | 直接编进 `source/assets/entry`。扫 `resources/` → 发 id → 写 `resources.index` / `R.txt` / 复制文件 / 压缩 PNG |
| `compile js` | `aceModuleRoot` 必须是**组件目录**（`src/main/js/<组件>`），传 `src/main` 会直接报 `missing app.js`。产物目录必须带 `assets/js/<组件名>` 这一层，否则 webpack 把 `app.js` 写在根下，与 Gradle 结构差 83 个条目。每个组件自己拼一份 manifest，不落成独立的中间产物 |
| `assemble assets` | 回填 `iconId` / `labelId`、`deviceType` 只写回 `liteWearable`、删双后缀 `.png.bin`。不搬文件 —— 资源编译和 webpack 都已经写在最终位置了 |
| `write bin` | `writeBin` 把目录序列化成 `.bin`，Buffer 留给下一步 |
| `sign bin` | 纯 JS 签名块。没配证书时跳过 |
| `pack bin hap` | 把 `.bin` 塞进 zip。直接拿 Buffer 打，不拆开再装回去 |
| `pack tree hap` | 只收文件树形态，`config.json` 和 `manifest.json` 换成紧凑单行版 |
| `pack app` | 文件树形态的 hap + `pack.info` 装进一个 zip，deflate 压缩 |
| `sign app` | 往 `.app` 的中央目录前插 `HAP Sig Block 42` |

### release 变体的差异

只做 release，debug 构建**不做** —— debug 只出 1 个 `.bin` 形态的包、webpack 不压缩，发布用不上。已落地的 release 差异：

- webpack 换 `mode production`。实测 devdemo `app.js` 6187 → 1604
- `.bc` 由 `src/generateJsSnapshot.js` → `jerry-parser-wasm` 在进程内生成。ace-loader 的 `SnapshotPlugin` 用 `--isPreview=true` 关掉，它原本靠 exec `jerry-snapshot.exe` 出 `.bc`
- sourcemap 输出到 `_releaseMap/`，打包前删掉，不交付
- webpack 的中间产物（`image_convert_result.txt`、`preview_css.json`、`_releaseMap/`）一律清掉，Gradle 的产物里没有这些
- 缓存目录必须放在产物目录**外面**。默认的 `<buildDir>/../cache` 会落在 `assets/js/cache/` 下被打进 `.bin`，实测多出 2 个 `.pack.gz`

---

## 签名

### 实现了什么

`.bin` 和 `.app` 都在 `src/sign/` 里用纯 JS 实现，不调 `hapsigntoolv2.jar`：

| 文件 | 职责 |
|---|---|
| `signBin.js` | `.bin` 签名块（移植自 `hap-sign-utils/sign-app-to-hap.js` 的 `signBin()`，算法原样照抄） |
| `signZip.js` | 给 zip 插 `HAP Sig Block 42`，hap 和 `.app` 共用同一套块格式 |
| `buildCms.js` | CMS SignedData 的 ASN.1 编码 |
| `computeDigest.js` | 分片摘要（两套：`.bin` 用 4096 分片，zip 用 1 MB 分片） |
| `parseP7b.js` | 解析 profile，取叶子证书 |
| `loadPrivateKey.js` | PKCS#12 或裸 PEM |
| `loadCerts.js` | 内置的华为根 + 中间证书链 |
| `index.js` | `prepareSigning()` 入口 |

### hap 层签的是什么

设备验的是 `.bin` 自己的签名块，hap 只是装着 bin 的 zip。所以 `buildSignedHap` 做的事是：先签 `.bin`（`sign bin`），再把它装进 hap —— 产物 `entry-bin-release-lite-signed.hap`，里面那份 `.bin` 与 `bin/entry-release-signed.bin` 逐字节相同。早先的实现是「打成 hap → 拆开读出 `.bin` → 判断已签 → 装回去」，那个拆包一步已经删掉了。

Gradle 的 `signReleaseHap` 在同样的事情之外，还会往 hap 这个 zip 的中央目录前再插一个 `HAP Sig Block 42`（格式已经逆出来了，就在 `signZip.js` 里，`.app` 用的同一套）。实测 `apps/_3rd/随机事件` 的一对 debug 产物：

```
entry-bin-debug-lite-unsigned.hap   6906826 B   里面是 entry-debug-signed.bin（6906662 B，已签）
entry-bin-debug-lite-signed.hap     6913411 B   同一个 .bin，字节完全相同
```

差的 6585 B 全是那个 zip 签名块。**本 SDK 不插它** —— 设备认的是 `.bin` 的签名，这层块没有验证价值，加了反而让产物和 Gradle 多一处需要对照的差异。

`.app` 里的 hap 也保持原样不重签 —— 实测用 jar 签出的 `.app` 里，`entry-release-lite.hap` 仍是未签的 144 条目文件树形态；`.app` 自己的签名是 zip 层的 `HAP Sig Block 42`，那个是要插的（`buildSignedApp` 会做），因为验证方（`hapsigntoolv2.jar verify`）读的就是它。

### 移植时的四个坑

1. **私钥是硬编码的**（`sign-app-to-hap.js` 第 8 行），华为根 + 中间证书也硬编码（第 9 行），叶子证书从 p7b 的 `bundle-info.development-certificate` 取。能不能签出设备认的包，取决于手头 p7b 的叶子证书是否与那把 key 配对 —— **不是任意 p7b 都能用**。华为 AGC 申请的 debug profile 绑定的是自己的证书，跟硬编码那把 key 不配对，用不了。
2. **`signHap()` 有副作用**：会顺手把 hap 里 `config.json` 的 `app.bundleName` 改成 p7b 里的 `bundle-name`，并把 `version.code` 置 0。那是换壳流程的痕迹，本 SDK 有自己的 bundleName，这段没照搬 —— 直接对 `.bin` 的 buffer 签，绕开 `.app` 那一层。
3. **`p7bLen` 只有 uint16**，p7b 超过 65535 B 会溢出。正常 p7b 2~4 KB，仍要加断言。
4. **分片 SHA256 的 chunkSize = 4096 是自定义算法**，不是标准 SHA256。要与设备验签一致就得原样照抄。

### p7b 从哪来

`hap-sign-utils` 的 `extract-hap-to-app-p7b.js` 能从任意已签名 hap 里把 p7b 和 unsigned hap 抽出来。

---

## 已验证的部分

每条都是拿真实产物对照出来的。**不要在没有对照的情况下改这些模块。**

| 模块 | 验证方式 | 结果 |
|---|---|---|
| `.bin` 读写 | 4 个真实 `.bin` 解析后重建，比对 SHA256 | 字节级一致 |
| `.bin` 条目排序 | `_empty` 15 个、`devdemo` 92 个条目对比 Gradle 产物 | 顺序完全一致（按路径深度 + 字节序） |
| hap 打包/解包 | 单 `.bin` 形态与文件树形态往返 | 内容一致 |
| config 加工 | 源码 → 加工 → 回填资源号，逐阶段对比 | 三阶段内容一致 |
| 资源编译 | 与 restool 1.022 的产物逐文件比对 | `R.txt` / `resources.index` 字节一致；png 像素一致（压缩字节差几 B） |
| `.bc` 生成 | devdemo 22 个 bundle 分别喂 wasm 和 SDK 的 `jerry-snapshot.exe`（debug、release 各一轮） | 22/22 逐字节一致 |
| `.bin` 签名 | 与 Gradle 产物逐段对比 | `proBlock` / `signBlock` / econtent 头完全一致 |
| hap 签名 | `buildSignedHap` 产出的 hap 里那份 `.bin` 与 `entry-release-signed.bin` 比对 | 逐字节相同（devdemo，2.3 MB / 92 条目） |
| `.app` 签名 | 产出的包交给 `hapsigntoolv2.jar` 跑 `verify` | Verify success |
| 端到端 | devdemo release 的 `.bin` 对比 Gradle 的 `entry-release-unsigned.bin` | 92 个条目一条不差；其中 83 个字节相同，9 个不同（原因见[已知差异](#已知差异与局限)） |

具体样本与数字：

- **`.bin`** — `_empty`(15 条目 / 110958 B)、`atri-mdm`(903 / 10786572 B)、`腕上词典 6.4.0`(201 / 9662763 B)、`openCrab`(112 / 8893516 B)，重建 SHA256 全部相同
- **hap** — `_empty` 单 `.bin` 形态；`devdemo` 文件树形态 92 条目；`stock` 单 `.bin` 2505 KB
- **config** — `_empty` 源码 690 B → 加工后 1016 B（release，不写 `deviceConfig.default.debug`）→ 最终 1089 B（多了 `iconId` / `labelId`）。JSON 内容全对，键顺序与 Gradle 不同属正常（Gradle 用 Java HashMap，顺序无语义）
- **资源编译** — `_empty` / `devdemo` / 自造 probe（全套 element 类型）的 `resources.index` 与 `R.txt` 字节一致；png 像素一致、压缩字节差几 B
- **`.bc`** — 22 个文件 397 ms，平均 18 ms/个，比每次 exec 起进程还快

---

## 已知差异与局限

### 已知差异（不是功能问题）

1. `openCrab` / `腕上词典` 的 Gradle 产物是 **api7 的 restool 1.028** 生成的，`resources.index` 头部版本串写的是 `Restool 1.028`，本 SDK 统一写 `Restool 1.022` 对齐 api6 —— **只差第 12 个字节**。
2. `atri-mdm` 的 `rawfile/momentplay_res/moments` 下有 3 个 `.dat` 与构建产物不同。源文件是 2026-10-30 改的，Gradle 产物是 2026-08-20 的，属于产物过期，不是复制逻辑的问题（同目录另外 4 个文件字节一致）。
3. `.bin` 里 CMS 的 ECDSA 签名值不可能字节一致 —— 那取决于私钥。
4. **`resources/` 下的 png 压缩字节与 Gradle 不同**。压缩用 Node 内置 zlib，restool 用的是 zlib 1.2.11，两者压出来的字节流有差异（devdemo 的 `icon.png` 3621 → 3593 B）。PNG 无损，解压后像素相同，这是有意接受的取舍，不再追求字节一致。
5. **`assets/js/<组件>/common/` 下由 SVG 转出来的 png 与 Gradle 不同**。ace-loader 已经把 pngquant.exe 换成了 libimagequant-wasm（`src/ace-loader` 的提交 `3d7d192`），编码器从 libpng 换成 png-rs，色数 / 质量阈值的语义对齐、字节不对齐。这条差异属于 ace-loader，不在本 SDK 的控制范围内。

devdemo 端到端那 9 个不同条目就由上面三条构成：2 个资源 png（第 4 条）、6 个 `common/` 下的 png 与对应 `.bin`（第 5 条）、1 个 `config.json`（键顺序）。

### 未验证

- **图片缩放规则**。`icon.bin` 的宽高直接来自源 png，未验证遇到非目标尺寸时 Gradle 怎么处理。别假设是简单拉伸。

### 不支持

| 项 | 状态 |
|---|---|
| debug 变体 | 不做。debug 只出 `.bin` 形态且不压缩，发布用不上 |
| hap 的 zip 层签名（`HAP Sig Block 42`） | 不做。`buildSignedHap` 只保证里面那个 `.bin` 已签名，理由见[签名](#签名) |
| `symbol` 类型的资源 | 不支持，api6 的 restool 也拒收 |
| `id` 类型的资源 | 不支持，要走 `id_defined.json` |
| 多模块 / Har 依赖 | 未实现，目前只处理单个 `entry` 模块 |
| 增量构建 | 没有，重复跑直接覆盖 |
| 非 8bit / 隔行 / 调色板 PNG | 原样复制，不重编码（这几类 restool 认不认也没验证过） |

### 待查

- `needPackageBin` 开关：插件字节码里有这个名字，对应 Gradle 的哪个配置项仍未确认
- `assembleDebug` 里那些 Java 相关任务为什么一个都不跑：`transformClasses` 的 condition 在本工程不满足、没注册，整条 Java 链在装配侧是断的

---

## 故障排查

| 报错 | 原因 |
|---|---|
| `找不到 <工程>/entry/src/main/config.json，确认工程目录指对了` | 工程目录要指到**含 `entry/` 的那一级**，不是 `entry` 自己 |
| `src/ace-loader 缺构建工具 …` | submodule 没拉或没装依赖。`git submodule update --init`，再 `cd src/ace-loader && npm install` |
| `<…> 下没有 app.js，确认组件名 default 对不对` | `config.json` 的 `module.js[].name` 与 `src/main/js/` 下的目录名不一致 |
| `找不到 <…>/build.gradle，没法确定 compileSdkVersion` | 模块目录没有 `build.gradle`，或里面少了这两个键 |
| `compile js: webpack failed for component default (exit N)` | webpack 报错。异常里附了最后 2000 字符的 stdout / stderr，往前翻能看到具体哪个文件 |
| `Json tag symbol is invalid` | 用了 `symbol` 资源。api6 的 restool 也不支持 |
| `ParseJsonNodeByType unsupport ResType15` | 用了 `id` 资源。要走 `base/element/id_defined.json` |
| `签名至少要给 p7b 路径（--p7b）` | 给了 `--p12` / `--key` 但没给 `--p7b` |
| `证书链里只找到 N 张证书，至少要根+中间两张` | `--cert` 给的文件里证书不全 |
| 签出来了但装不上 | p7b 的叶子证书与私钥不配对。见[签名](#签名)第 1 条坑 |
| `没有这个命令：xxx` | 命令名拼错。`hmlwsdk` 不带参数跑一次会打印四条命令 |

产物不对的两种情况：

- **`.bin` 里只有 `config.json` 一个条目** —— `source/` 被整体清空过（早期 bug）。删掉 work 目录重跑
- **产物里多出 `.png.bin` / `image_convert_result.txt` / `source/assets/js/cache/*.pack.gz`** —— 这些 Gradle 的产物里都没有。前者说明 `assembleAssets` 的清理没跑到，后两者说明 webpack 的缓存目录落在了产物目录里（应该由 `cacheDir` 指到 `work/cache`）

---

## 作为库使用

整条链一个函数：

```js
import { build } from "hmlwsdk";

const outputs = await build({
  projectDir: "apps/devdemo/devdemo",
  target: "signedApp",          // bin | signedHap | app | signedApp
  signingConfig: { p7b: "my.p7b", keyFile: "private-pkcs8.pem" },
  log: console.log              // 可选，每步一行进度；默认 console.log
});
console.log(outputs.signedApp, outputs.bin, outputs.signedBin);
```

不给 `signingConfig` 就出 unsigned 产物（`signedHap` / `signedApp` 两个 target 除外，它们会直接报错）。

也可以只取单个模块用：

```js
import {
  readBin, writeBin, isSignedBin, stripSignature, SIGN_HEAD_ASCII,
  readZip, writeZip, crc32, collectFiles,
  packBinHap, packTreeHap, packApp, signApp,
  mergeProfile, stringifyConfig, stringifyConfigMinified,
  parseRTable, fillResourceIds,
  compileResources, compressPng, isSupportedPng,
  runWebpack, compileJs,
  readProject,
  prepareSigning, signBin, signZip, parseP7b, loadPrivateKey, slicedSha256,
  resolveTools, resolveNode
} from "hmlwsdk";
```

| 函数 | 用途 |
|---|---|
| `build({projectDir, target, ...})` | 整条链，返回各产物路径 |
| `readProject(projectDir)` | 读 build.gradle 版本号 + 源码 config.json |
| `readBin(buf)` / `writeBin({bundleName, entries})` | `.bin` 私有容器读写 |
| `stripSignature(buf)` / `isSignedBin(buf)` | 剥签名块 / 判断是否已签 |
| `collectFiles(dir)` | 递归扫目录成条目列表（按路径深度 + 字节序） |
| `packBinHap(binBuf, name)` / `packTreeHap(sourceRoot, config)` | 两种形态的 hap |
| `packApp({outDir, hapBuf, hapName, config})` / `signApp({appBuf, signingConfig})` | `.app` 打包与签名，都只处理 Buffer |
| `readZip` / `writeZip` / `crc32` | 手写 zip 读写（已字节级验证） |
| `mergeProfile` / `stringifyConfig` | config 加工与序列化 |
| `compileResources({moduleRoot, outDir, rTxtPath, compressImage})` | 资源编译总入口 |
| `compressPng(buf)` | PNG 重编码（原 restool 的 `-z`） |
| `compileJs({moduleDir, config, work, sourceRoot, iconDir})` | 编译 JS：每组件写 manifest → webpack → `.bc` |
| `runWebpack({moduleRoot, buildDir, manifestPath, ...})` | 只跑一次 webpack，不管 manifest 和 `.bc` |
| `prepareSigning(cfg)` / `signBin` / `signZip` | 签名 |
| `resolveTools()` / `resolveNode()` | 定位 `src/ace-loader` 和 node |

---

## 目录结构

```
bin/hmlwsdk.js          CLI 实现，package.json 的 bin 字段指向它
bin/hmlwsdk.cmd         Windows 的 cmd / PowerShell 入口（Windows 不认 shebang）
bin/hmlwsdk             macOS / Linux 的 sh 入口
src/
  index.js              包的统一导出
  build.js              整条链 ← 查执行顺序看这里
  readProject.js        读 build.gradle 版本号 + 源码 config.json
  findTools.js          定位 src/ace-loader，以及用哪个 node

  ── 配置 ──
  processConfig.js      mergeProfile / stringifyConfig / stringifyConfigMinified
  parseResourceTable.js R.txt 解析、config 里资源号回填

  ── 资源 ──
  compileResources.js   资源编译总入口（扫目录 → 发 id → 写 index / R.txt / 复制文件）
  scanResourceFiles.js  扫 resources/，解析限定目录名（base / dark / zh_CN …）
  parseElementJson.js   element 下的 JSON → 记录数据段（全套类型）
  writeResourceIndex.js 写 resources.index（restool 私有格式）
  writeResourceTable.js 写 R.txt
  copyResourceFiles.js  复制 media / profile / rawfile，写 4 个空 .key
  compressPng.js        PNG 重编码，复现 restool 的 -z（用 node:zlib，像素一致）

  ── JS ──
  compileJs.js          每组件写 manifest → webpack → 清中间文件 → 出 .bc
  runWebpack.js         只跑一次 node + webpack
  generateJsSnapshot.js .js 编成 .bc（进程内跑 wasm）

  ── 组装与打包 ──
  assembleAssets.js     定型 source/：回填资源 id、写 config、删双后缀 .png.bin
  collectFiles.js       递归扫目录成条目列表（按路径深度 + 字节序）
  packHap.js            两种形态的 hap（单 .bin / 文件树）
  packApp.js            .app 打包
  signApp.js            .app 签名
  readWriteZip.js       zip 读写 + crc32
  readWriteBin.js       .bin 私有容器：读 / 写 / 签名块剥离

  sign/                 签名，8 个文件
  ace-loader/           git submodule，JS 构建链（webpack + sharp）
  jerry-parser-wasm/    js2bc：JS → JRRY v24 字节码（jerryscript v2.1.0 编的 wasm）
```

### 三条命名规矩

- **全部平铺在 `src/` 下，不建目录**。只有三个例外：`sign/`、`ace-loader/`（submodule，本来就是一整棵目录）、`jerry-parser-wasm/`（wasm 产物 + 60 行封装）。
- **文件名一律「动词 + 名词」**，不许用缩写、不许加角色后缀，也不带变体词（`debug` 不做，`release` 是唯一变体，写进名字只是噪音）。`processConfig.js` 是「加工配置」、`collectFiles.js` 是「收集文件」、`build.js` 是「构建」。这条是踩过三次坑换来的（`ctx.js`、`rtable.js` 这种只有写的人懂的缩写，后来又变成 `-Transform` / `-Runner` / `-file` 三套后缀混用）。
- **`bin/` 和 `src/readWriteBin.js` 不是一回事**。`bin/` 是可执行入口目录（npm 惯例），`readWriteBin.js` 管 `.bin` 私有容器。

---

## 参与开发

### 三条硬规矩

1. **有现成的库就直接用，别自己造轮子。** 只有两种情况才自己写：没有现成实现，或者别人的实现压不出我们要的那串字节（`resources.index` 这种私有格式、`.bin` 私有容器，全世界只有华为的 C++ 代码会写它）。
2. **依赖要锁在能对上字节的版本上。** `jsrsasign` 的 ASN.1 编码不能随便升，升了要重新对一遍签名产物。
3. **每个模块必须有对照。** 改 `.bin` 就用真实文件往返比对 SHA256，改 config 就逐阶段对比 Gradle 产物。没有对照的改动不算完成。对照结论写在各自模块的注释里（「`R.txt` 73 B 字节一致」这种），改代码前先读那段，改完重跑一遍。

已经手写并验证过的（`readWriteZip.js`、`readWriteBin.js`、`writeResourceIndex.js`）**保持不动** —— 它们有对照基准是字节级 SHA256，换库就得重新对一遍，风险大于收益。`compressPng.js` 是例外：它的验收标准是像素一致，底层换成 `node:zlib` 没问题，但里面那些 libpng 的细节（按代价函数挑每行 filter、IDAT 按 8192 硬切）必须原样保留，改了压缩效果会退步。

### 加新步骤的步骤

1. 想清楚它插在 `src/build.js` 的哪两行之间 —— 没有依赖图，顺序就是代码顺序
2. 有实质逻辑就在 `src/` 下建 `<动词+名词>.js`；只有几行胶水就直接写在 `build.js` 里（`write bin`、`pack bin hap` 都是这么处理的）
3. 想让它能从命令行停在那个产物上，就在 `build.js` 的 `TARGETS` 里加一项、在 `bin/hmlwsdk.js` 的 `COMMANDS` 里加一条别名
4. 拿真实工程跑一遍，把产物字节数写进注释

### 重新验证 `.bc` 生成

`jerry-parser-wasm` 的产物是以 SDK 里的 `jerry-snapshot.exe` 为基准对齐的。换了 jerryscript 版本要重新验证时，先把那份 exe 拷回 `src/ace-loader/bin/`：

```bat
copy "%LOCALAPPDATA%\Huawei\Sdk\hmscore\2.2.0\js\build-tools\ace-loader\bin\jerry-snapshot.exe" src\ace-loader\bin\
```

（上面是 Windows 上的 SDK 常见位置，其它平台对应 DevEco 的 SDK 目录。）

SHA256 应为 `259A75D5972482CE712AE1696DB0E4B9D8B3A0C6334C524B811999BC3F0AB5EB`（310784 B）。

验法：拿一批真实 bundle，对这个 exe 和 wasm 各跑一次 `generate -o <out> <in>`，逐字节比。

⚠ **每生成一个 `.bc` 必须新建 emscripten 实例**。同一实例连续 `callMain` 时 jerry 内部堆不清零，实测 22 个文件里只有前 2 个正确、第 3 个起全部漂移（长度相同，24~89 个单字节不同）。

### 本地文档

仓库根目录的 `AGENTS.md` 和 `doc/gradle-build-report.html` 是**本地文档，不进 git**（`.gitignore` 里排除了）。它们记着：

- `AGENTS.md` —— 每个模块的完整格式档案、踩过的坑、验证样本清单。改格式相关逻辑前必读
- `doc/gradle-build-report.html` —— 72 张任务卡片的完整 Gradle 构建图。`src/build.js` 的步骤划分和每步的关键点都是从这张图里反推出来的

### 参考项目

| 目录 | 用途 |
|---|---|
| `hap-sign-utils/` | `.bin` 容器读写、签名、图片转 `.bin` 的来源。`src/readWriteBin.js` 和 `src/sign/` 都是在它基础上改造的 |
| `hmlw.pages.dev/tools/` | `.bin` 的只读解析逻辑（`getHapInfo.js` 等），用来交叉印证容器格式 |
| `apps/_empty/_empty` | 最小 liteWearable 工程，所有对照验证的基准 |
| `apps/devdemo/devdemo` | 同时有 `.bin` 形态和文件树形态的 hap，端到端基准 |
| `apps/atri-mdm`、`apps/_3rd/*` | 不同规模的样本工程 |

Gradle 插件 jar（要查 Gradle 具体行为时反编译它）：

```
~/.gradle/caches/modules-2/files-2.1/com.huawei.ohos/hap/3.1.5.0/*/hap-3.1.5.0-unshaded.jar
```

常用：`javap -p -c -classpath <jar> <类名>`，字符串常量在 `// String` 行里。

---

## License

ISC
