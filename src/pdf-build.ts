import { jsPDF } from "jspdf";
import { ImgResultType, ProjectInfo } from "./types";
import { assertReportPagesComplete, pdfFilename } from "./report-check";
import { sortByProperty } from "./utils";

/**
 * 将已取到的页面图合成 PDF。页不齐时先抛错，不返回文件。
 * @returns [filename, pdfUrl]
 */
export const projectImg2pdf = (
    info: ProjectInfo,
    imgCache: ImgResultType[],
    terminalIndex: number,
): [string, string] => {
    assertReportPagesComplete(
        imgCache.map((page) => ({
            index: page.index,
            byteLength: page.imageData?.byteLength ?? 0,
            width: typeof page.width === "number" ? page.width : undefined,
            height: typeof page.height === "number" ? page.height : undefined,
        })),
        terminalIndex,
    );

    const doc = new jsPDF({
        compress: true,
    });

    doc.setDocumentProperties({
        title: info.projectName,
        subject: info.conclusionAbstract,
        author: info.projectAdmin,
        keywords: info.projectKeywordC,
        creator: "NsfcReportExport/1.5.2 direct",
    });

    doc.deletePage(1);

    const ordered = sortByProperty(imgCache.slice(), "index");

    for (const data of ordered) {
        doc.addPage([data.width, data.height], data.orientation);
        doc.addImage({
            imageData: data.imageData,
            x: 0,
            y: 0,
            width: data.width,
            height: data.height,
            compression: "FAST",
        });
    }

    const pdfUrl = doc.output("datauristring");
    const filename = pdfFilename(info.projectName);
    return [filename, pdfUrl];
};
