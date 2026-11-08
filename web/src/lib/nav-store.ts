import { toast } from "sonner";
import { create } from "zustand";
import {
  getPrivate,
  getPublic,
  getSession,
  loginPasskey,
  loginPassword,
  logout as apiLogout,
  verifyTotp as apiVerifyTotp,
  adminDeleteLink,
  adminListAll,
  adminMoveLink,
  adminReorderCategories,
  adminReorderEngines,
  adminReorderLinks,
  adminReorderScenes,
  UnauthorizedError,
  ApiError,
  type AdminData,
  type LoginResult,
} from "@/lib/api";
import { buildMoveIds } from "@/lib/link-order";
import type {
  AdminLink,
  PrivateData,
  PublicData,
  SearchEngine,
  SiteLink,
  SiteSettings,
} from "@/lib/types";

/**
 * 登录态三态：
 * - `pending`：启动探活未回（未知）。此时既不能弹登录框，也不能渲染「未登录」UI。
 * - `authenticated`：`GET /api/auth/session` 通过，或本次已登录成功。
 * - `anonymous`：探活 401 / 会话失效 / 已登出。
 *
 * 唯一真源是后端会话（Cookie + sessions 表）：前端不持久化任何登录标志，
 * 刷新后靠探活恢复，禁止用 localStorage 冒充登录态。
 */
export type AuthStatus = "pending" | "authenticated" | "anonymous";

/** 探活与页面挂载可能同时触发 /api/private：同一个请求在飞时复用，不重复发。 */
let privateInFlight: Promise<void> | null = null;
/** 启动探活只做一次（StrictMode 双挂载 / 多次调用都复用同一个 Promise）。 */
let sessionProbe: Promise<void> | null = null;
/**
 * 站点设置的「本地写新」版本号：patchAdminSettings 每次 +1。两个作用 ——
 *  1. >0 时下一次 loadPublic 绕过 HTTP 缓存（后端 /api/public 是 `public, max-age=60`），
 *     否则「后台改完设置 → 返回公开页」会命中旧缓存，标题/背景图/主题又跳回旧值；
 *  2. >0 期间「写新之前发出、写新之后才回」的旧响应一律丢弃，不把新值盖回去。
 * 拉到服务端最新值后复归 0。
 */
let settingsRevision = 0;

/**
 * 回落未登录（anonymous）时一并清掉的会话期数据：私有区与后台数据都属于会话数据，
 * 排序簿记（reorderTracks）同样只在会话内有效。
 * 进入 anonymous 的入口共 5 处，全部使用本函数，保证「anonymous ⇒ store 里没有任何会话数据」：
 * bootstrapSession 401 / bootstrapSession 网络错误降级 / loadPrivate 401 /
 * loadAdmin 401 / logout。新增入口时同样必须带上它（不得只清 privateData）。
 */
function clearAdminSession() {
  resetAdminOrderState();
  resetHomeEditState();
  return { privateData: null, adminData: null, editMode: false } as const;
}

/**
 * 全局状态（Zustand）：登录态、公开数据、会话数据（私有区 + 后台数据）。
 * 会话数据仅在会话有效后进入 store；回落到 anonymous 时一律清空（见 clearAdminSession）。
 */
interface NavState {
  publicData: PublicData | null;
  privateData: PrivateData | null;
  authStatus: AuthStatus;
  loading: boolean;
  /** /api/private 返回 401 时置位，用于弹登录框 */
  loginPromptOpen: boolean;
  error: string | null;
  /** 后台数据（分类/链接/引擎/设置），登录后加载 */
  adminData: AdminData | null;
  /**
   * 首页编辑模式：纯前端本地状态（不持久化、不进站点设置），刷新即回正常模式。
   * 编辑模式的写口径是 adminData，privateData 每次写入后同步投影（成功不整表重拉）。
   */
  editMode: boolean;

  /** 启动探活：刷新后恢复登录态（pending → authenticated/anonymous） */
  bootstrapSession: () => Promise<void>;
  loadPublic: () => Promise<void>;
  loadAdmin: () => Promise<void>;
  /**
   * 分类 / 链接 / 搜索引擎 / 场景排序：立即乐观生效，成功后**不再回拉整表**；
   * 失败回滚并在 store 内按服务端再刷一次，然后抛错（由面板 toast）。
   * 四者的发送串行化、连续拖拽只补发最新顺序，详见文件末尾的排序簿记。
   * 分类的 sort_order 是**场景内**排序：分类面板只提交当前场景的分类全集。
   */
  reorderCategories: (ids: string[]) => Promise<void>;
  reorderLinks: (ids: string[]) => Promise<void>;
  reorderEngines: (ids: string[]) => Promise<void>;
  reorderScenes: (ids: string[]) => Promise<void>;
  /**
   * 链接换分类前调用：先等在飞的链接排序（/links/reorder）全部落库，再作废本地
   * 顺序簿记（localIds/pendingIds/beforeIds）。
   *
   * 「全部落库」包括在飞期间又拖出的顺序：发送循环会先把 pendingIds 里最新的一轮发完
   * 才结束，所以 await 返回时旧顺序既不会再有请求待发，也不会在事后写回本地。
   *
   * 为什么必须「等」而不是就地清掉：排序请求无法取消，若它在这次 PUT 之后才落库，
   * 会把这个链接的 sort_order 改回旧槽位；而它的成功回调还会把旧顺序写回 localIds，
   * 让随后的 loadAdmin 投影继续按旧槽位覆盖新位置——等到它落地再作废，才保证这次
   * PUT（全局 MAX+1）是链接顺序相关写入的最后一次。
   */
  settleLinkOrder: () => Promise<void>;

  // ── 首页编辑模式 ──────────────────────────────────────────────────────────
  /**
   * 进入首页编辑模式：先排空后台面板在飞的链接排序，再拉一份最新后台数据
   * （编辑模式以 adminData 为写口径）。未登录 / 失败返回 false，不进入。
   */
  enterEditMode: () => Promise<boolean>;
  /** 退出编辑模式：待落库的删除立即落库（撤销窗口随之结束） */
  exitEditMode: () => void;
  /**
   * 首页拖动一块链接砖：乐观改分组 + 全局顺序，串行发 `POST /links/move`。
   * 成功不整表重拉；终止失败把本轮快照（顺序 + 分组）整体回滚并抛错。
   */
  moveLinkOnHome: (input: {
    linkId: string;
    categoryId: string;
    /** 落点前一块的 id（null = 目标分类的第一个位置） */
    afterId: string | null;
  }) => Promise<void>;
  /** 首页角标删除：立即移除 + 带撤销的 toast，约 5 秒后才落库 */
  removeLinkOnHome: (linkId: string) => void;
  /** 撤销待落库的删除：只恢复本地（不发请求） */
  undoRemoveLink: (linkId: string) => void;
  /** 退出编辑模式 / 页面卸载：待落库的删除立即落库 */
  flushPendingLinkDeletes: () => void;
  /** 后台链接弹窗保存后：就地替换 store 里的链接并投影（不重拉） */
  applyEditedLink: (link: AdminLink) => void;

  /** 设置保存成功后就地刷新 store 里所有存活的 settings 切片（三片原子更新） */
  patchAdminSettings: (settings: SiteSettings) => void;
  loadPrivate: () => Promise<void>;
  /** 密码登录第一步；返回 requires2fa 时由调用方进入 TOTP 第二步 */
  loginWithPassword: (
    username: string,
    password: string,
  ) => Promise<LoginResult>;
  verifyTotp: (tempToken: string, code: string) => Promise<void>;
  loginWithPasskey: () => Promise<void>;
  logout: () => Promise<void>;
  setLoginPrompt: (open: boolean) => void;
  defaultEngine: () => SearchEngine | null;
}

export const useNavStore = create<NavState>((set, get) => ({
  publicData: null,
  privateData: null,
  authStatus: "pending",
  loading: false,
  loginPromptOpen: false,
  error: null,
  adminData: null,
  editMode: false,

  bootstrapSession: () => {
    if (sessionProbe) return sessionProbe;
    sessionProbe = (async () => {
      try {
        await getSession();
        // 探活通过：直接进入已登录态，并拉取私有区
        set({ authStatus: "authenticated" });
        await get().loadPrivate();
      } catch (e) {
        if (e instanceof UnauthorizedError) {
          // 无会话 / Cookie 失效：回落未登录（会话数据一并清掉）
          set({ authStatus: "anonymous", ...clearAdminSession() });
          return;
        }
        // 网络错误 / 超时 / 5xx：降级为未登录，避免卡在 pending；
        // 此时不自动弹登录框（可能是后端暂时不可用），用户可手动点「登录」重试。
        set({
          authStatus: "anonymous",
          ...clearAdminSession(),
          error: (e as Error).message,
        });
      }
    })();
    return sessionProbe;
  },

  loadPublic: async () => {
    set({ loading: true, error: null });
    // 快照当前版本：请求在飞时设置又被写新，这轮响应可能是旧值
    const revision = settingsRevision;
    try {
      const data = await getPublic(revision > 0 ? "no-store" : undefined);
      if (revision !== settingsRevision) {
        set({ loading: false });
        return;
      }
      settingsRevision = 0;
      set({ publicData: data, loading: false });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  loadPrivate: () => {
    if (privateInFlight) return privateInFlight;
    const request = (async () => {
      try {
        const data = await getPrivate();
        set({
          privateData: data,
          authStatus: "authenticated",
          loginPromptOpen: false,
        });
      } catch (e) {
        if (e instanceof UnauthorizedError) {
          // 会话失效：会话数据清空，回落未登录并弹登录
          set({
            ...clearAdminSession(),
            authStatus: "anonymous",
            loginPromptOpen: true,
          });
          return;
        }
        set({ error: (e as Error).message });
      } finally {
        privateInFlight = null;
      }
    })();
    privateInFlight = request;
    return request;
  },

  loginWithPassword: async (username, password) => {
    const result = await loginPassword({ username, password });
    if ("ok" in result) {
      set({ authStatus: "authenticated", loginPromptOpen: false });
      await get().loadPrivate();
    }
    return result;
  },

  verifyTotp: async (tempToken, code) => {
    await apiVerifyTotp({ tempToken, code });
    set({ authStatus: "authenticated", loginPromptOpen: false });
    await get().loadPrivate();
  },

  loginWithPasskey: async () => {
    await loginPasskey();
    set({ authStatus: "authenticated", loginPromptOpen: false });
    await get().loadPrivate();
  },

  logout: async () => {
    await apiLogout();
    // 站内登出同样要清干净会话数据（私有区 + 后台数据），不能只清 privateData
    set({
      authStatus: "anonymous",
      ...clearAdminSession(),
      loginPromptOpen: false,
    });
  },

  setLoginPrompt: (open) => set({ loginPromptOpen: open }),

  loadAdmin: async () => {
    try {
      const data = await adminListAll();
      // 顺序以本地为准：排序前发出、排序后才落地的旧响应不得把新顺序盖回去（见文件末尾簿记）。
      set({ adminData: projectLocalOrder(data) });
    } catch (e) {
      // 会话失效（401）：后台页回落到未登录态，由 App 的 #admin 关口弹登录
      if (e instanceof ApiError && e.status === 401) {
        set({
          ...clearAdminSession(),
          authStatus: "anonymous",
          loginPromptOpen: true,
        });
        return;
      }
      set({ error: (e as Error).message });
    }
  },

  // 排序：同步乐观写新 → 串行发送最新一次 → 成功即以本地为准（不再 loadAdmin 对账）。
  // 旧方案「成功后 onChanged() 整表重拉」与乐观写入本质竞态：重拉的整份覆盖会把更晚的
  // 乐观顺序盖回旧值。这里只在**失败**后才回拉一次，见 flushReorder。
  reorderCategories: (ids) =>
    reorderList("categories", ids, adminReorderCategories),
  reorderLinks: (ids) => reorderList("links", ids, adminReorderLinks),
  reorderEngines: (ids) =>
    reorderList("searchEngines", ids, adminReorderEngines),
  reorderScenes: (ids) => reorderList("scenes", ids, adminReorderScenes),

  settleLinkOrder: async () => {
    const track = reorderTracks.links;
    // 在飞的排序失败时 flushReorder 已自行回滚 + 回拉，并由原调用者 toast；
    // 这里不能让它的失败挡住换分类的保存。
    if (track.inFlight) await track.inFlight.catch(() => {});
    // 首页编辑模式的拖动保存（POST /links/move）也是链接顺序/归属的写入：不等它
    // 落库就发 PUT，旧的 move 可能后落地、把改分类的结果写回旧分类旧槽位。
    if (homeMoves.inFlight) await homeMoves.inFlight.catch(() => {});
    track.localIds = null;
    track.pendingIds = null;
    track.beforeIds = null;
  },

  enterEditMode: () => {
    if (get().authStatus !== "authenticated") return Promise.resolve(false);
    if (get().editMode) return Promise.resolve(true);
    if (editEntryInFlight) return editEntryInFlight;
    const token = editEntryToken;
    editEntryInFlight = (async () => {
      try {
        // 后台链接面板可能还有一次排序在飞：它落库后会把 sort_order 写回旧槽位，
        // 必须排在编辑模式的第一次拖动之前（顺带作废本地顺序簿记）。
        await get().settleLinkOrder();
        // 编辑模式的写入以 adminData 为准、显示走 privateData 的投影；两者缺一不可。
        if (!get().privateData) await get().loadPrivate();
        const privateData = get().privateData;
        if (!privateData || get().authStatus !== "authenticated") return false;
        const data = await adminListAll();
        // 拉数据期间已经退出/登出/卸载：不要事后把编辑模式点亮
        if (token !== editEntryToken) return false;
        set({
          editMode: true,
          adminData: data,
          privateData: projectPrivateData(data, privateData),
        });
        return true;
      } catch (e) {
        // 与 loadAdmin 同口径：会话失效回落到未登录并弹登录，其余失败只返回 false
        if (e instanceof ApiError && e.status === 401) {
          set({
            ...clearAdminSession(),
            authStatus: "anonymous",
            loginPromptOpen: true,
          });
        }
        return false;
      } finally {
        editEntryInFlight = null;
      }
    })();
    return editEntryInFlight;
  },

  exitEditMode: () => {
    // 让还在拉数据的 enterEditMode 落地时不再把编辑模式打开（例如点完铅笔立刻离开页面）
    editEntryToken += 1;
    set({ editMode: false });
    // 撤销窗口随退出结束：待删的立即落库（失败会插回原位并 toast）
    get().flushPendingLinkDeletes();
  },

  moveLinkOnHome: ({ linkId, categoryId, afterId }) => {
    const data = get().adminData;
    if (!data) return Promise.resolve();
    const ids = buildMoveIds(data.links, linkId, categoryId, afterId);
    // 「一次突发」只在第一次拖动取快照：中途连续拖的几次失败时一起回到这里
    homeMoves.snapshot ??= data.links;
    const next: AdminData = {
      ...data,
      links: applyOrder<AdminLink>(data.links, ids).map((link) =>
        link.id === linkId ? { ...link, categoryId } : link,
      ),
    };
    set((state) => ({
      adminData: next,
      ...editProjection(next, state.privateData),
    }));
    return enqueueHomeMove({ linkId, categoryId, ids });
  },

  removeLinkOnHome: (linkId) => {
    const data = get().adminData;
    if (!data || pendingLinkDeletes.has(linkId)) return;
    const ordered = [...data.links].sort((a, b) => a.sortOrder - b.sortOrder);
    const index = ordered.findIndex((link) => link.id === linkId);
    if (index < 0) return;
    const link = ordered[index];
    const prevId = index > 0 ? ordered[index - 1].id : null;
    const next: AdminData = {
      ...data,
      links: data.links.filter((item) => item.id !== linkId),
    };
    set((state) => ({
      adminData: next,
      ...editProjection(next, state.privateData),
    }));
    const toastId = toast(`已删除「${link.title}」`, {
      duration: LINK_DELETE_DELAY_MS,
      action: { label: "撤销", onClick: () => get().undoRemoveLink(linkId) },
    });
    const timer = setTimeout(() => {
      void commitLinkDelete(linkId);
    }, LINK_DELETE_DELAY_MS);
    pendingLinkDeletes.set(linkId, { link, prevId, timer, toastId });
  },

  undoRemoveLink: (linkId) => {
    const record = pendingLinkDeletes.get(linkId);
    if (!record) return;
    clearTimeout(record.timer);
    pendingLinkDeletes.delete(linkId);
    toast.dismiss(record.toastId);
    restoreDeletedLink(record);
  },

  flushPendingLinkDeletes: () => {
    for (const linkId of [...pendingLinkDeletes.keys()]) {
      void commitLinkDelete(linkId);
    }
  },

  applyEditedLink: (link) => {
    const data = get().adminData;
    if (!data || !data.links.some((item) => item.id === link.id)) return;
    const next: AdminData = {
      ...data,
      links: data.links.map((item) => (item.id === link.id ? link : item)),
    };
    set((state) => ({
      adminData: next,
      ...editProjection(next, state.privateData),
    }));
  },

  defaultEngine: () => {
    const engines = get().publicData?.searchEngines ?? [];
    return engines.find((e) => e.isDefault) ?? engines[0] ?? null;
  },

  // 后端 PUT /api/admin/settings 返回保存后的完整设置（权威响应）：原子刷新 store 里
  // **所有存活**的 settings 切片，而不是只刷 adminData：
  //  - publicData / privateData 是公开页真正消费的数据，只刷 adminData 会让「后台改站点
  //    标题/背景图 → 返回公开页」仍是旧值，必须刷新才生效；
  //  - 壁纸/标题等设置也从这两片读，登出 / 401 失效会清空 adminData 与 privateData，
  //    只刷 adminData 会让公开页回到旧值。（主题不在 settings 里，只跟本机偏好走。）
  // 未加载的切片保持原样（不凭空造数据）。新增 settings 写入口时同样必须走这里。
  patchAdminSettings: (settings) => {
    settingsRevision += 1;
    set((s) => ({
      ...(s.adminData ? { adminData: { ...s.adminData, settings } } : {}),
      ...(s.publicData ? { publicData: { ...s.publicData, settings } } : {}),
      ...(s.privateData ? { privateData: { ...s.privateData, settings } } : {}),
    }));
  },
}));

/** 组件里判「已登录」请用这个（单一真源 authStatus，避免出现与三态不一致的布尔字段）。 */
export function useAuthenticated(): boolean {
  return useNavStore((s) => s.authStatus === "authenticated");
}

// ─── 排序簿记 ────────────────────────────────────────────────────────────────
//
// 排序**成功即以本地状态为准、不再整表回拉**（乐观更新的通行做法）：重拉的整份覆盖
// 与乐观写入本质竞态——排序前发出的 GET 若晚到，会把更晚的乐观顺序盖回旧值。
// 全量刷新只在初始加载与增删改/导入/设置保存后发生，那几次由 projectLocalOrder
// 把本地顺序投影到服务端数据上，所以旧响应同样盖不掉顺序。
// 因此这里不需要版本号/序号/时间戳对账，只需要四件事：
//   localIds    本地权威顺序（投影 + 本轮之后仍以它为准）
//   pendingIds  在飞期间又拖出的最新顺序（串行发送，只补发最新一次）
//   beforeIds   本轮排序开始前的显示顺序（终止失败时的即时回滚目标）
//   inFlight    在飞循环的 Promise（给「必须排在排序写入之后」的操作 await）

type AdminListKey = "scenes" | "categories" | "links" | "searchEngines";

/** 一次排序「突发」（用户连续拖拽/连点直到全部落地）的簿记，每个实体一份。 */
interface ReorderTrack {
  /** 本地权威顺序：排序后以它为准（loadAdmin 落地时投影），直到失败回滚或会话结束。 */
  localIds: string[] | null;
  /** 在飞期间又拖出的最新顺序：当前请求落地后补发它，更早的中间顺序直接丢弃。 */
  pendingIds: string[] | null;
  /** 本轮突发开始前的显示顺序：终止失败时用它即时回滚。 */
  beforeIds: string[] | null;
  /** 是否已有发送循环在跑（保证同一实体同一时刻只有一个请求在飞）。 */
  running: boolean;
  /**
   * 在飞发送循环的 Promise（没有则为 null）：给需要「排在排序写入之后」的操作
   * （如链接换分类）提供一个可 await 的落地点。
   */
  inFlight: Promise<void> | null;
}

const reorderTracks: Record<AdminListKey, ReorderTrack> = {
  scenes: {
    localIds: null,
    pendingIds: null,
    beforeIds: null,
    running: false,
    inFlight: null,
  },
  categories: {
    localIds: null,
    pendingIds: null,
    beforeIds: null,
    running: false,
    inFlight: null,
  },
  links: {
    localIds: null,
    pendingIds: null,
    beforeIds: null,
    running: false,
    inFlight: null,
  },
  searchEngines: {
    localIds: null,
    pendingIds: null,
    beforeIds: null,
    running: false,
    inFlight: null,
  },
};

/**
 * 会话世代号：每次 resetAdminOrderState() 自增。
 * 旧会话发出去的排序请求无法取消，它们落地时必须能识别出「自己已经过期」，否则会：
 *  - 把旧会话的顺序写回 localIds（新会话的 loadAdmin 会拿它去投影）；
 *  - 失败时用旧会话的快照回滚掉新会话刚排好的顺序；
 *  - 在 finally 里把新会话正在跑的循环的 running 清成 false（于是并发开出第二条循环）。
 */
let sessionEpoch = 0;

/** 清空排序簿记（会话结束、测试隔离）。 */
export function resetAdminOrderState(): void {
  // 旧循环靠世代号静默退出（请求本身不可取消，但落地后不得再写 track/store）。
  sessionEpoch += 1;
  for (const key of Object.keys(reorderTracks) as AdminListKey[]) {
    reorderTracks[key].localIds = null;
    reorderTracks[key].pendingIds = null;
    reorderTracks[key].beforeIds = null;
    reorderTracks[key].running = false;
    // 旧会话的循环不会清它（stale 后直接退出），这里一并置空
    reorderTracks[key].inFlight = null;
  }
}

/**
 * 按 `ids` 重排并重写 sortOrder：ids 里出现的项按 ids 顺序依次填回它们在当前数组里
 * 占据的位置，其它位置（本轮新建、尚未进入 ids 的项）原地不动；sortOrder 只给本次
 * ids 覆盖到的项重写，序号 = 它在 ids 里的位置（0..k-1）。
 *
 * 链接面板是按 sortOrder 排序渲染的（见 LinkPanel 的 categoryLinks），只换数组顺序而
 * 不改 sortOrder 会看不出变化；乐观写入、loadAdmin 投影、失败回滚都必须走这里。
 *
 * 为什么不再把**全表**重写为 0..n-1：分类的 sort_order 自此是**场景内**序号，分类
 * 面板一次只提交当前场景。若把别的场景也按全局位置重编号，本地 sortOrder 会与服务端
 * 漂移（删过分类留下空档时尤其明显），随后按「场景内最大 + 1」新建分类就会算小、
 * 插到场景中间而不是末尾。链接 / 搜索引擎 / 场景的 ids 本来就是全量，效果不变。
 *
 * 未命中项「原地保留」而不是「接到末尾」：后端新建实体的 sort_order 默认 0，下一次
 * 加载它可能落在中间（排序键 sort_order, created_at），本地接到末尾会在刷新时跳位。
 */
function applyOrder<T extends { id: string; sortOrder: number }>(
  items: readonly T[],
  ids: readonly string[],
): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered: T[] = [];
  const picked = new Set<string>();
  for (const id of ids) {
    const item = byId.get(id);
    if (item && !picked.has(id)) {
      picked.add(id);
      ordered.push(item);
    }
  }
  const result = [...items];
  let next = 0;
  items.forEach((item, index) => {
    if (picked.has(item.id)) result[index] = ordered[next++];
  });
  // 位置只由 ids 的顺序决定：重复 id 不占新位置，序号连续无空档
  const positionById = new Map<string, number>();
  for (const id of ids) {
    if (byId.has(id) && !positionById.has(id)) {
      positionById.set(id, positionById.size);
    }
  }
  return result.map((item) => {
    const position = positionById.get(item.id);
    return position === undefined ? item : { ...item, sortOrder: position };
  });
}

type AdminListItems =
  | AdminData["scenes"]
  | AdminData["categories"]
  | AdminData["links"]
  | AdminData["searchEngines"];

type AdminListItem = AdminListItems[number];

/** 取 adminData 的某个切片（显式分支，避开联合键的类型收窄问题）。 */
function listOf(data: AdminData, key: AdminListKey): AdminListItem[] {
  if (key === "scenes") return data.scenes;
  if (key === "categories") return data.categories;
  if (key === "links") return data.links;
  return data.searchEngines;
}

/** 用新数组替换 adminData 的某一个切片（显式分支，避开联合键的类型收窄问题）。 */
function withList(
  data: AdminData,
  key: AdminListKey,
  items: AdminListItem[],
): AdminData {
  if (key === "scenes")
    return { ...data, scenes: items as AdminData["scenes"] };
  if (key === "categories")
    return { ...data, categories: items as AdminData["categories"] };
  if (key === "links") return { ...data, links: items as AdminData["links"] };
  return {
    ...data,
    searchEngines: items as AdminData["searchEngines"],
  };
}

/** loadAdmin 落地时把本地权威顺序投影到服务端数据上（没有本地排序则原样返回）。 */
function projectLocalOrder(data: AdminData): AdminData {
  const scenes = reorderTracks.scenes.localIds
    ? applyOrder(data.scenes, reorderTracks.scenes.localIds)
    : data.scenes;
  const categories = reorderTracks.categories.localIds
    ? applyOrder(data.categories, reorderTracks.categories.localIds)
    : data.categories;
  const links = reorderTracks.links.localIds
    ? applyOrder(data.links, reorderTracks.links.localIds)
    : data.links;
  const searchEngines = reorderTracks.searchEngines.localIds
    ? applyOrder(data.searchEngines, reorderTracks.searchEngines.localIds)
    : data.searchEngines;
  return { ...data, scenes, categories, links, searchEngines };
}

/** 当前 adminData 里某个实体的 id 顺序（未加载时为空）。 */
function currentIds(key: AdminListKey): string[] {
  const data = useNavStore.getState().adminData;
  return data ? listOf(data, key).map((item) => item.id) : [];
}

/**
 * 本次提交的「作用域」：补发比较只看作用域内的集合，而不是整张表。
 *
 * 分类的 sort_order 是**场景内**排序（#16 契约），分类面板一次只提交当前场景的全集。
 * 若补发时拿全量分类去比，lastSent 永远「不等」于全量 → 每次排序都多补发一次全量顺序，
 * 等于把别的场景的 sort_order 也一并重写（服务端虽不报错，但不是契约口径）。
 * 链接 / 搜索引擎 / 场景仍是全局顺序，作用域就是全量。
 */
function scopeIds(key: AdminListKey, sent: readonly string[]): string[] {
  const data = useNavStore.getState().adminData;
  if (!data) return [];
  if (key !== "categories") return currentIds(key);
  const sentIds = new Set(sent);
  const sceneIds = new Set(
    data.categories
      .filter((category) => sentIds.has(category.id))
      .map((category) => category.sceneId),
  );
  return data.categories
    .filter((category) => sceneIds.has(category.sceneId))
    .map((category) => category.id);
}

/** 两份 id 顺序是否完全一致（长度 + 逐位）。 */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * 一次排序调用：先同步写新（界面立刻定住，不等网络），再交给发送循环。
 * 已有循环在跑时只登记最新顺序并立即返回——本次调用不负责报错，报错由本轮
 * 第一个调用者的 Promise 承载（一次突发最多弹一次失败提示）。
 */
function reorderList(
  key: AdminListKey,
  ids: string[],
  send: (ids: string[]) => Promise<void>,
): Promise<void> {
  const data = useNavStore.getState().adminData;
  if (!data) return Promise.resolve(); // 未加载：防御性空转
  const track = reorderTracks[key];
  // 失败回滚快照取「本次提交的作用域」：分类只回滚当前场景，不把别的场景也重编号
  track.beforeIds ??= scopeIds(key, ids);
  track.localIds = ids;
  track.pendingIds = ids;
  useNavStore.setState({
    adminData: withList(
      data,
      key,
      applyOrder<AdminListItem>(listOf(data, key), ids),
    ),
  });
  if (track.running) return Promise.resolve();
  const run = flushReorder(key, send);
  // flushReorder 同步设 running；若它没开循环就收尾了（无可发顺序），running
  // 已是 false，这里不登记（否则会留一个已结束的 inFlight 永远不清）。
  if (track.running) track.inFlight = run;
  return run;
}

/**
 * 发送循环：同一实体一次只发一个请求，永远发「最新一次」顺序，因此旧请求不可能晚于
 * 新请求落地、把服务端的顺序写成旧值。
 *
 * 失败处理：若期间又产生了更新的顺序，就不回滚（否则会盖掉用户最新的拖拽），直接补发；
 * 只有「没有更新顺序待发」的终止失败才回滚到本轮开始前的显示顺序，并按服务端再刷一次
 * —— 后端 reorder 是逐条 UPDATE、无事务，失败时可能已部分生效，本地回滚只能保证
 * 「回到操作前」，真实落库状态以这次刷新为准。
 *
 * 补发：排序在飞期间若发生增删（onChanged → loadAdmin 落地后集合变了），本次提交的
 * ids 里没有新项，它的 sort_order 会留在新建默认值 0（后端按 sort_order, created_at
 * 排 → 下次加载它落在中间），服务端与界面就不一致了。因此一轮成功之后若当前列表的
 * ids 与刚提交的不同，就用当前全量顺序补发一次（最多 2 次，防病态循环）。
 *
 * 会话：入口记住世代号，每次 await 之后先比对；世代已变说明会话已经换了（登出/401），
 * 本循环直接静默退出——不写 track、不写 store、不抛错，也不清 running。
 */
async function flushReorder(
  key: AdminListKey,
  send: (ids: string[]) => Promise<void>,
): Promise<void> {
  const track = reorderTracks[key];
  const epoch = sessionEpoch;
  const stale = () => epoch !== sessionEpoch;
  track.running = true;
  let error: unknown = null;
  let lastSent: string[] | null = null;
  let resends = 0;
  try {
    for (;;) {
      let ids = track.pendingIds;
      track.pendingIds = null;
      if (!ids) {
        const current: string[] = lastSent ? scopeIds(key, lastSent) : [];
        if (
          !lastSent ||
          resends >= 2 ||
          current.length === 0 ||
          sameIds(current, lastSent)
        )
          break;
        resends += 1;
        ids = current;
      }
      try {
        await send(ids);
        if (stale()) return; // 旧会话的请求落地：不得写 localIds
        lastSent = ids;
        // 有更新顺序待发时不能把 localIds 退回这份旧的：它是「本地权威」，会被
        // loadAdmin 投影；写回旧值会把界面盖回旧顺序，补发再把旧顺序真的写进服务端。
        if (!track.pendingIds) track.localIds = ids;
      } catch (e) {
        if (stale()) return; // 旧会话的失败：不得回滚、不得触发回拉
        if (track.pendingIds) continue;
        error = e;
        break;
      }
    }
  } finally {
    // 旧循环不得清掉新会话正在跑的循环的 running（否则会并发开出第二条循环）
    if (!stale()) {
      track.running = false;
      track.inFlight = null;
    }
  }
  if (!error) {
    track.beforeIds = null; // 本轮全部落库，下次排序重新取快照
    return;
  }
  const before = track.beforeIds;
  const data = useNavStore.getState().adminData;
  track.localIds = null;
  track.pendingIds = null;
  track.beforeIds = null;
  if (data && before) {
    useNavStore.setState({
      adminData: withList(
        data,
        key,
        applyOrder<AdminListItem>(listOf(data, key), before),
      ),
    });
  }
  void useNavStore.getState().loadAdmin();
  throw error;
}

// ─── 首页编辑模式 ────────────────────────────────────────────────────────────
//
// 首页编辑模式以 adminData 为**写口径**（乐观写、串行发送），privateData 是公开页
// 真正渲染的数据，每次写入后同步投影一次 —— 成功不整表重拉，退出编辑模式也不回跳。
// 删除是延迟落库的：先本地移除、给约 5 秒撤销窗口，窗口结束 / 退出编辑模式才真删除。

/** 撤销窗口：窗口内的删除不发任何请求（撤销只恢复本地，服务端从未删过） */
const LINK_DELETE_DELAY_MS = 5000;

/** 进入编辑模式的一次性请求（连点两次不并发拉数据） */
let editEntryInFlight: Promise<boolean> | null = null;
/** 进入编辑模式的世代号：退出 / 会话结束自增，让在飞的 enter 不再落地 */
let editEntryToken = 0;

interface QueuedHomeMove {
  linkId: string;
  categoryId: string;
  ids: string[];
  resolve: () => void;
  reject: (error: unknown) => void;
}

const homeMoves: {
  /** 本轮（一次连续拖动）开始前的 links 快照：失败时顺序 + 分组一起回到这里 */
  snapshot: AdminLink[] | null;
  queue: QueuedHomeMove[];
  running: boolean;
  /** 发送循环本身：settleLinkOrder 等它落库，避免旧的 move 晚于 PUT 落地 */
  inFlight: Promise<void> | null;
} = { snapshot: null, queue: [], running: false, inFlight: null };

interface PendingLinkDelete {
  link: AdminLink;
  /** 删除前的全局前驱：撤销 / 落库失败时据此插回原位 */
  prevId: string | null;
  timer: ReturnType<typeof setTimeout>;
  toastId: string | number;
}

const pendingLinkDeletes = new Map<string, PendingLinkDelete>();

function toSiteLink(link: AdminLink): SiteLink {
  return {
    id: link.id,
    categoryId: link.categoryId,
    title: link.title,
    url: link.url,
    iconUrl: link.iconUrl,
    description: link.description,
    sortOrder: link.sortOrder,
  };
}

/**
 * 把 adminData 投影成公开页消费的 privateData.categories。
 * 分类与组内链接都按 sortOrder 排，场景 / 引擎 / 设置原样保留（本单不动它们）。
 */
function projectPrivateData(data: AdminData, prev: PrivateData): PrivateData {
  const linksByCategory = new Map<string, SiteLink[]>();
  for (const link of [...data.links].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  )) {
    const bucket = linksByCategory.get(link.categoryId) ?? [];
    bucket.push(toSiteLink(link));
    linksByCategory.set(link.categoryId, bucket);
  }
  const categories = [...data.categories]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((category) => ({
      id: category.id,
      name: category.name,
      icon: category.icon,
      sceneId: category.sceneId,
      sortOrder: category.sortOrder,
      links: linksByCategory.get(category.id) ?? [],
    }));
  return { ...prev, categories };
}

/** set() 里用：privateData 未加载时不做投影（不凭空造数据） */
function editProjection(data: AdminData, prev: PrivateData | null) {
  return prev ? { privateData: projectPrivateData(data, prev) } : {};
}

function enqueueHomeMove(op: {
  linkId: string;
  categoryId: string;
  ids: string[];
}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    homeMoves.queue.push({ ...op, resolve, reject });
    if (!homeMoves.running) {
      homeMoves.running = true;
      const run = drainHomeMoves();
      // 循环若已同步收尾（running 已清），不登记一个永不落地的 inFlight
      if (homeMoves.running) homeMoves.inFlight = run;
    }
  });
}

/**
 * 拖动失败回滚：只把「拖动前就存在、现在还在」的链接改回原来的归属与槽位。
 *
 * 不能直接拿快照整表覆盖：拖动在飞期间用户可能删掉链接（已本地移除、几秒后真删）
 * 或撤销删除；整表覆盖会把待删的链接复活、把刚撤销的链接抹掉 —— 定时器照常落库后，
 * 界面就和服务端永久不一致。成员集合以当前为准，顺序按恢复后的 sortOrder 重排。
 */
function rollbackHomeLinks(
  current: readonly AdminLink[],
  snapshot: readonly AdminLink[],
): AdminLink[] {
  const before = new Map(snapshot.map((link) => [link.id, link]));
  return current
    .map((link) => {
      const original = before.get(link.id);
      return original
        ? {
            ...link,
            categoryId: original.categoryId,
            sortOrder: original.sortOrder,
          }
        : link;
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * 首页拖动的发送循环：同一时刻只有一个 `POST /links/move` 在飞，按用户操作顺序逐条发。
 * 每条请求带的是它那一刻重建的全局 ids；串行发送保证后一次写入不会先落地、被前一次覆盖。
 * 终止失败时本轮全部乐观写入（含排队中还没发的）一起回滚到快照，并只让失败那条 reject
 * （由看板 toast 一次），排队中的直接 resolve，不再重复报错。
 */
async function drainHomeMoves(): Promise<void> {
  const epoch = sessionEpoch;
  const stale = () => epoch !== sessionEpoch;
  try {
    for (;;) {
      const op = homeMoves.queue.shift();
      if (!op) break;
      try {
        await adminMoveLink({
          linkId: op.linkId,
          categoryId: op.categoryId,
          ids: op.ids,
        });
        op.resolve();
        if (stale()) return; // 旧会话的请求落地：不再写 store
      } catch (error) {
        if (stale()) {
          op.resolve();
          continue;
        }
        const pending = homeMoves.queue.splice(0);
        const snapshot = homeMoves.snapshot;
        homeMoves.snapshot = null;
        op.reject(error);
        for (const rest of pending) rest.resolve();
        if (snapshot) {
          const current = useNavStore.getState().adminData;
          if (current) {
            const rolledBack: AdminData = {
              ...current,
              links: rollbackHomeLinks(current.links, snapshot),
            };
            useNavStore.setState((state) => ({
              adminData: rolledBack,
              ...editProjection(rolledBack, state.privateData),
            }));
          }
        }
        return;
      }
    }
    homeMoves.snapshot = null; // 本轮全部落库，下一次拖动重新取快照
  } finally {
    // 旧会话的循环不得清掉新会话正在跑的循环的 running / inFlight
    if (!stale()) {
      homeMoves.running = false;
      homeMoves.inFlight = null;
    }
  }
}

async function commitLinkDelete(linkId: string): Promise<void> {
  const record = pendingLinkDeletes.get(linkId);
  if (!record) return;
  pendingLinkDeletes.delete(linkId);
  clearTimeout(record.timer);
  toast.dismiss(record.toastId);
  try {
    await adminDeleteLink(linkId);
  } catch (error) {
    // 落库失败：服务端没删，界面必须把这一块放回去
    restoreDeletedLink(record);
    toast.error(`删除失败：${(error as Error).message}`);
  }
}

/**
 * 把被撤下（撤销 / 删除失败）的链接插回删除前的位置：锚定它删除前的前驱 id，
 * 再按新顺序本地重编号（不发请求 —— 删除请求还没发过，服务端本来就是原顺序）。
 */
function restoreDeletedLink(record: PendingLinkDelete): void {
  const data = useNavStore.getState().adminData;
  if (!data || data.links.some((link) => link.id === record.link.id)) return;
  const ordered = [...data.links].sort((a, b) => a.sortOrder - b.sortOrder);
  const anchorIndex = record.prevId
    ? ordered.findIndex((link) => link.id === record.prevId)
    : -1;
  const insertAt = anchorIndex >= 0 ? anchorIndex + 1 : 0;
  const byId = new Map<string, AdminLink>();
  for (const link of data.links) byId.set(link.id, link);
  byId.set(record.link.id, record.link);
  const ids = ordered.map((link) => link.id);
  ids.splice(insertAt, 0, record.link.id);
  const links: AdminLink[] = [];
  ids.forEach((id, index) => {
    const link = byId.get(id);
    if (link) links.push({ ...link, sortOrder: index });
  });
  const next: AdminData = { ...data, links };
  useNavStore.setState((state) => ({
    adminData: next,
    ...editProjection(next, state.privateData),
  }));
}

/**
 * 清空首页编辑的队列与待删计时器（会话结束 / 测试隔离）。
 * 已发出的请求不可取消，靠 sessionEpoch 让旧循环静默退出。
 */
export function resetHomeEditState(): void {
  sessionEpoch += 1;
  editEntryToken += 1;
  homeMoves.snapshot = null;
  homeMoves.queue.splice(0);
  homeMoves.running = false;
  homeMoves.inFlight = null;
  for (const record of pendingLinkDeletes.values()) {
    clearTimeout(record.timer);
    toast.dismiss(record.toastId);
  }
  pendingLinkDeletes.clear();
  editEntryInFlight = null;
}
