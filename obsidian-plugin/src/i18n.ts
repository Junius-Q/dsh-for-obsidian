import { getLanguage } from "obsidian";

/**
 * Minimal i18n that follows the Obsidian app language.
 * Uses `getLanguage()` (Obsidian >= 1.8.7) which returns the ISO code of the
 * configured UI language (e.g. "zh", "en"), defaulting to "en".
 */

type Dict = { [key: string]: string };

const en: Dict = {
  appName: "dsh",
  appSubtitle: "DeepSeek Harness",
  conversations: "Conversations",
  newSession: "New session",
  attachNote: "Attach active note",
  inputPlaceholder: "Message dsh…",
  send: "Send",
  stop: "Stop",
  newChat: "New chat",
  noConversations: "No conversations yet.",
  newConversationStarted: "New conversation started.",
  welcomeHint:
    "Chat with dsh — your local DeepSeek Harness agent. Press ☰ to see past conversations.",
  errorPrefix: "Error",
  noOutput: "(dsh returned no text)",
  dshOk: "dsh OK",
  dshTestFailed: "dsh connection failed",
  runTest: "Run test",
  running: "Running…",
  replyPrefix: "Reply with exactly",
  chattingWithDsh: "dsh Chat",
  testConnection: "Test dsh connection",
  testConnectionDesc: "Run a quick headless call to verify dsh works before using the plugin.",
  modelSwitch: "Switch model",
  dshNotConnected: "dsh service is not running. Open the chat and send a message, or check dsh is installed.",
  copy: "Copy",
  copied: "Copied",
  copyFailed: "Copy failed",
  commands: "Commands",
  permission: "Permission",
  reasoning: "Reasoning",
  rename: "Rename",
  archive: "Archive",
  fork: "Fork (new from here)",
  renameTitle: "New conversation title",
  renamePrompt: "Enter a new title for this conversation:",
  renamed: "Renamed",
  archived: "Archived",
  forked: "Forked new conversation",
  dshSessionRequired: "This conversation has no dsh session (send a message first).",
  permissionPresetReadOnly: "Read-only",
  permissionPresetWorkspaceWrite: "Read & write vault",
  permissionPresetDangerFullAccess: "Full access (no prompts)",
  permissionPresetCustom: "Custom",
  permissionUnknown: "Permission",
  dshNoStats: "No usage data yet",
  cmdCompact: "Compact",
  cmdCompactDesc: "Compact older conversation history",
  cmdExport: "Export",
  cmdExportDesc: "Download this session log as a ZIP archive",
  cmdFeedback: "Feedback",
  cmdFeedbackDesc: "Record feedback about this session",
  cmdGoal: "Goal",
  cmdGoalDesc: "Set or view the goal for a long-running task",
  cmdPermission: "Permission",
  cmdPermissionDesc: "Switch the permission preset (sandbox mode + approval policy)",
  cmdPlan: "Plan mode",
  cmdPlanDesc: "Enter or leave plan mode",
  noCommands: "No commands",
  settingsMenu: "Settings",
  configureKey: "Configure API key",
  openWeb: "Open dsh web",
  cmdCancel: "Cancel",
  cmdSaveKey: "Save key",
  cmdClearKey: "Clear",
  cmdClearConfirm: "Clear the saved DeepSeek API key?",
  cmdKeyCleared: "Key cleared",
  cmdKeyEmpty: "Please enter an API key",
  cmdKeySaved: "Saved to dsh config (works across plugin/CLI/web)",
  confirmTitle: "Confirm",
  cmdConfirm: "OK",
};

const zh: Dict = {
  appName: "dsh",
  appSubtitle: "DeepSeek Harness",
  conversations: "会话历史",
  newSession: "新建会话",
  attachNote: "附带当前笔记",
  inputPlaceholder: "给 dsh 发消息…",
  send: "发送",
  stop: "停止",
  newChat: "新对话",
  noConversations: "还没有会话",
  newConversationStarted: "已开始新对话",
  welcomeHint:
    "与 dsh（DeepSeek Harness）对话。点 ☰ 查看历史会话。",
  errorPrefix: "错误",
  noOutput: "（dsh 无返回内容）",
  dshOk: "dsh 连接正常",
  dshTestFailed: "dsh 连接失败",
  runTest: "运行测试",
  running: "运行中…",
  replyPrefix: "请只回复",
  chattingWithDsh: "dsh 对话",
  testConnection: "测试 dsh 连接",
  testConnectionDesc: "运行一次无头调用来验证 dsh 是否可用。",
  modelSwitch: "切换模型",
  dshNotConnected: "dsh 服务未运行。请先打开聊天并发一条消息，或确认 dsh 已安装。",
  copy: "复制",
  copied: "已复制",
  copyFailed: "复制失败",
  commands: "命令",
  permission: "权限",
  reasoning: "推理",
  rename: "重命名",
  archive: "归档",
  fork: "分叉（从此处新建）",
  renameTitle: "新会话标题",
  renamePrompt: "为此会话输入新标题：",
  renamed: "已重命名",
  archived: "已归档",
  forked: "已分叉新会话",
  dshSessionRequired: "此会话没有 dsh 会话（请先发一条消息）。",
  permissionPresetReadOnly: "只读",
  permissionPresetWorkspaceWrite: "读写工作区",
  permissionPresetDangerFullAccess: "完全访问",
  permissionPresetCustom: "自定义",
  permissionUnknown: "权限",
  dshNoStats: "暂无数据",
  cmdCompact: "压缩",
  cmdCompactDesc: "压缩较早的对话历史",
  cmdExport: "导出",
  cmdExportDesc: "将会话日志下载为 ZIP 压缩包",
  cmdFeedback: "反馈",
  cmdFeedbackDesc: "记录关于本会话的反馈",
  cmdGoal: "目标",
  cmdGoalDesc: "设置或查看长期任务的目标",
  cmdPermission: "权限",
  cmdPermissionDesc: "切换权限预设（沙箱模式 + 审批策略）",
  cmdPlan: "计划模式",
  cmdPlanDesc: "进入或退出计划模式",
  noCommands: "无命令",
  settingsMenu: "设置",
  configureKey: "配置 API key",
  openWeb: "打开 dsh web",
  cmdCancel: "取消",
  cmdSaveKey: "保存 key",
  cmdClearKey: "清除",
  cmdClearConfirm: "清除已保存的 DeepSeek API key？",
  cmdKeyCleared: "已清除",
  cmdKeyEmpty: "请输入 API key",
  cmdKeySaved: "已保存到 dsh 配置（插件/CLI/web 通用）",
  confirmTitle: "确认",
  cmdConfirm: "确定",
};

// Map non-zh variants to zh fallback (e.g. zh-cn, zh-tw, zh-hk)
function isChinese(lang: string): boolean {
  return lang ? lang.toLowerCase().startsWith("zh") : false;
}

function currentDict(): Dict {
  try {
    const lang = (getLanguage() || "en").toLowerCase();
    return isChinese(lang) ? zh : en;
  } catch {
    return en;
  }
}

/** Get a translated string for the current Obsidian UI language. */
export function t(key: keyof Dict): string {
  const dict = currentDict();
  return dict[key] ?? en[key] ?? key;
}

/** Returns true when the Obsidian UI language is a Chinese variant. */
export function isChineseUI(): boolean {
  try {
    return isChinese((getLanguage() || "").toLowerCase());
  } catch {
    return false;
  }
}
