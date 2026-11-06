import { ExternalLink, Info } from "lucide-react";
import { Separator } from "@/components/ui/separator";

/**
 * 后台「关于」分区（nav #19 §A3）：零后端改动的静态信息。
 *
 * 版本号来自构建时注入的 `__APP_VERSION__`（vite.config.ts / vitest.config.ts
 * 读取仓库根 package.json 的 version），源码里不手写版本号。
 */
export function AboutPanel() {
  const year = new Date().getFullYear();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Info className="size-5 text-muted-foreground" aria-hidden="true" />
        <h2 className="font-heading text-lg font-semibold">关于</h2>
      </div>

      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[5.5rem_1fr]">
        <dt className="text-muted-foreground">应用</dt>
        <dd className="font-medium">Nav</dd>

        <dt className="text-muted-foreground">版本</dt>
        <dd>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            {__APP_VERSION__}
          </code>
        </dd>

        <dt className="text-muted-foreground">开源仓库</dt>
        <dd>
          <a
            href="https://github.com/WorkerHub/nav"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
          >
            WorkerHub/nav
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        </dd>

        <dt className="text-muted-foreground">技术栈</dt>
        <dd>
          React · TypeScript · Vite · Tailwind CSS · shadcn/ui · Cloudflare
          Workers
        </dd>
      </dl>

      <Separator />

      <p className="text-xs text-muted-foreground">
        © {year} Nav · 保留所有权利
      </p>
    </div>
  );
}
