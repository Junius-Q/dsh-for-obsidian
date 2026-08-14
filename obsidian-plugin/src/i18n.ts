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
