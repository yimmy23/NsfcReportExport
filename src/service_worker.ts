import { sleep } from "./async-pool/utils";
import { ImgResultType } from "./types";
import { checkCache, pageToast, show } from "./utils";
import { readProjectInfo, readReportPage } from "./nsfc";
import { projectImg2pdf } from "./pdf-build";
import { shouldStopRetrying } from "./report-check";
import { fetchFromOpenTab } from "./page-session";
import {
  EXTENSION_VERSION,
  ExportPageRecord,
  PAGE_INTERVAL_MS,
  buildExportManifest,
  isFinalDetailsUrl,
  isOfficialStop,
  manifestFilename,
  notLastPageMessage,
  sha256Hex,
} from "./official-page";

let downloading = false;
let tabId: number = 0;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    type: "normal",
    id: "@ejfkdev/NsfcReportExportContextMenus",
    title: "下载结题报告",
    documentUrlPatterns: ["https://kd.nsfc.cn/finalDetails*"],
  });
  checkCache();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "@ejfkdev/NsfcReportExportContextMenus") {
    void setTask(tab);
  }
});

chrome.action.onClicked.addListener((tab) => {
  void setTask(tab);
});

chrome.alarms.create("checkCache", {
  periodInMinutes: 60 * 24 * 7,
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "checkCache") {
    checkCache();
  }
});

const logLine = (fields: Record<string, unknown>) => {
  console.info(`NsfcReportExport/${EXTENSION_VERSION}`, JSON.stringify(fields));
};

const setTask = async (tab?: chrome.tabs.Tab) => {
  if (!tab?.url || !tab?.id) return;
  if (!isFinalDetailsUrl(tab.url)) {
    show(
      tab.id,
      "导出失败",
      "请先打开官网结题详情页 https://kd.nsfc.cn/finalDetails 并完成官网验证，再点扩展。未生成PDF。",
    );
    return;
  }
  const id = new URL(tab.url).searchParams.get("id");
  if (id == null || downloading) return;

  downloading = true;
  tabId = tab.id;
  logLine({ phase: "start", version: EXTENSION_VERSION });
  chrome.scripting.executeScript({
    target: { tabId },
    func: pageToast,
  });
  await chrome.action.setBadgeText({ text: "⏬" });

  try {
    await ReportExport(id, tab.url);
  } catch (error) {
    const message = (error as Error).message;
    logLine({ phase: "fail", message });
    show(tabId, "导出失败", message);
  }

  downloading = false;
  tabId = 0;
  await chrome.action.setBadgeText({ text: "" });
  checkCache();
};

const ReportExport = async (id: string, sourcePage: string) => {
  const startTime = Date.now();
  const fetchImpl = fetchFromOpenTab(tabId);
  const info = await readProjectInfo(fetchImpl, id);
  show(tabId, "正在导出", info.projectName);

  const imgCache: ImgResultType[] = [];
  const pageRecords: ExportPageRecord[] = [];
  let index = 0;
  let terminalIndex = 0;
  let consecutiveErrors = 0;

  while (++index) {
    show(tabId, "正在导出", `${info.projectName} 第${index}页`);
    try {
      const page = await readReportPage(fetchImpl, id, index);
      consecutiveErrors = 0;
      if (page.kind === "missing") {
        terminalIndex = index;
        logLine({ phase: "end", terminalIndex });
        break;
      }
      imgCache.push(page.image);
      pageRecords.push({
        index,
        byteLength: page.image.imageData.byteLength,
        sha256: await sha256Hex(page.image.imageData),
        width: page.image.width,
        height: page.image.height,
      });
      logLine({
        phase: "page",
        index,
        bytes: page.image.imageData.byteLength,
        sha256: pageRecords[pageRecords.length - 1].sha256,
      });
      await sleep(PAGE_INTERVAL_MS);
    } catch (error) {
      if (isOfficialStop(error)) throw error;
      consecutiveErrors++;
      logLine({
        phase: "retry",
        index,
        consecutiveErrors,
        detail: (error as Error).message,
      });
      if (shouldStopRetrying(consecutiveErrors)) {
        throw new Error(notLastPageMessage(index, (error as Error).message));
      }
      index--;
      await sleep(3000);
    }
  }

  show(tabId, "生成文件", `${info.projectName}.pdf 生成中`);
  const [filename, pdfUrl] = projectImg2pdf(info, imgCache, terminalIndex);
  const manifest = buildExportManifest({
    sourcePage,
    projectName: info.projectName,
    projectAdmin: info.projectAdmin,
    conclusionAbstract: info.conclusionAbstract,
    projectKeywordC: info.projectKeywordC,
    terminalIndex,
    pages: pageRecords,
    exportedAt: new Date().toISOString(),
  });
  const manifestUrl = "data:application/json;charset=utf-8," +
    encodeURIComponent(JSON.stringify(manifest, null, 2));
  const pageTabId = tabId;
  const pdfId = await downloadData(pdfUrl, filename);
  const manifestId = await downloadData(manifestUrl, manifestFilename(info.projectName));
  const elapsedMinutes = Math.ceil((Date.now() - startTime) / 1000 / 60);
  logLine({
    phase: "saved",
    pages: imgCache.length,
    pdfId,
    manifestId,
  });
  show(
    pageTabId,
    "导出完成",
    `${filename} 与清单已在浏览器默认下载目录。共${imgCache.length}页，用时${elapsedMinutes}分钟。清单里 thirdPartyImageProxy 应为 false。`,
  );
};

const readDownloadError = (): string | undefined => {
  const runtime = chrome.runtime as { lastError?: { message?: string } };
  return runtime.lastError?.message;
};

const downloadData = (url: string, filename: string): Promise<number> => {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename,
        conflictAction: "uniquify",
        saveAs: false,
      },
      (downloadId) => {
        const downloadError = readDownloadError();
        if (downloadError || downloadId == null) {
          reject(new Error(downloadError || `浏览器未开始下载 ${filename}`));
          return;
        }
        resolve(downloadId);
      },
    );
  });
};
