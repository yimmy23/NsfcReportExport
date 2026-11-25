import { CacheData, GetterSetter, ToastMsg } from "./types";

export const show = (
    tabId: number | null | undefined,
    title: string,
    message: string,
) => {
    let notiId = "ReportExportNotificationId";
    try {
        notiId && chrome.notifications.create(notiId.toString(), {
            type: "basic",
            iconUrl: "images/logo.png",
            title,
            message,
            silent: true,
        });
    } catch {}

    try {
        notiId && chrome.notifications.update(notiId.toString(), {
            type: "basic",
            iconUrl: "images/logo.png",
            title,
            message,
            silent: true,
        });
    } catch {}

    tabId && chrome.tabs.sendMessage(tabId, {
        title: "正在导出",
        message,
    });
};

export const sortByProperty = <T>(array: T[], key: keyof T): T[] => {
    return array.sort((a, b) => {
        const valueA = a[key];
        const valueB = b[key];
        if (valueA < valueB) return -1;
        if (valueA > valueB) return 1;
        return 0;
    });
};

// 本地缓存
export const setCachedData = async (
    key: string,
    data: any,
    ttl: number = 60 * 60 * 24 * 7,
) => {
    const now = Date.now();
    const cacheData = {
        data,
        expire: now + ttl * 1000, // ttl是秒
    } as CacheData;
    await chrome.storage.local.set({ [key]: cacheData });
};

// 获取本地缓存
export const getCachedData = async (key: string): Promise<CacheData | null> => {
    const result = await chrome.storage.local.get(key);
    const cacheData = result[key] as CacheData;
    if (cacheData) {
        return cacheData;
    } else {
        return null;
    }
};

// 清理过期缓存
export const checkCache = async () => {
    const keys = await chrome.storage.local.getKeys();
    for (const key of keys) {
        const cacheData = await getCachedData(key);
        if (!cacheData || cacheData.expire < Date.now()) {
            await chrome.storage.local.remove(key);
        }
    }
};

// 网页内进度通知
export const pageToast = () => {
    const callback = (data: ToastMsg) => {
        let root = document.querySelector(
            `div#NsfcReportExportToastRoot`,
        ) as HTMLDivElement;
        let title = document.querySelector(
            `div#NsfcReportExportToastTitle`,
        ) as HTMLDivElement;
        let message = document.querySelector(
            `div#NsfcReportExportToastMessage`,
        ) as HTMLDivElement;
        if (document.querySelector(`div#NsfcReportExportToastRoot`) == null) {
            root = document.createElement("div");
            root.id = `NsfcReportExportToastRoot`;
            root.style.cssText = `
        top: 80%;
        left: 0;
        right: 0;
        margin: 0 auto;
        padding: 0.5rem;
        position: fixed;
        display: flex;
        flex-direction: column;
        width: 20rem;
        outline: 0.25rem solid rgb(0 128 255 / 30%);
        border-radius: 1.25rem;
        background-color: rgb(255 255 255 / 50%);
        backdrop-filter: blur(1rem);`;
            title = document.createElement("div");
            title.id = `NsfcReportExportToastTitle`;
            title.style.cssText =
                `font-size:1.25rem; font-weight:bold; color:#444;`;
            message = document.createElement("div");
            message.id = `NsfcReportExportToastMessage`;
            message.style.cssText =
                `color:#666; text-wrap: pretty; word-break: break-word;`;
            root.appendChild(title);
            root.appendChild(message);
            document.body.appendChild(root);
        } else {
            //@ts-ignore
            clearInterval(window["NsfcReportExportToastRootSetTimeout"]);
        }

        title.innerText = data.title;
        message.innerText = data.message;

        if (data.title === "导出完成" || data.title === "导出失败") {
            // chrome.runtime.onMessage.removeListener(callback);
            //@ts-ignore
            window["NsfcReportExportToastRootSetTimeout"] = setTimeout(
                () => document.body.removeChild(root),
                10000,
            );
        }
        return undefined;
    };
    chrome.runtime.onMessage.addListener(callback);
};

/**
 * 创建一个简单的 getter/setter 对
 * @template T - 数据类型，默认为 any
 * @returns [getter, setter] - 返回一个包含 getter 和 setter 函数的数组
 * - getter: () => T - 获取存储的值
 * - setter: (v: T) => T - 设置新值并返回设置的值
 *
 * @example
 * const [getValue, setValue] = getset<string>();
 * setValue("hello"); // 设置值
 * console.log(getValue()); // 获取值，输出 "hello"
 */
export const getset = <T = any>(initVal?: T): GetterSetter<T> => {
    let data: T;
    if (initVal != undefined) data = initVal;
    return [
        () => {
            return data;
        },
        (v: T) => {
            return data = v;
        },
    ];
};
