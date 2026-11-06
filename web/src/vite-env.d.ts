/// <reference types="vite/client" />

/**
 * 构建时注入的应用版本号：vite.config.ts / vitest.config.ts 的 `define` 读取
 * 仓库根 package.json 的 `version`。源码里不得手写版本号，一律引用这个常量。
 */
declare const __APP_VERSION__: string;
