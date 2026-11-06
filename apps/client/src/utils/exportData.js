import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import { toPng, toSvg } from "html-to-image";

const IMAGE_EXPORT_TYPE = {
  png: toPng,
  svg: toSvg,
};

const formatFilename = (name) =>
  name ? String(name).replace(/[\\/:*?"<>|]/g, "_") : "";

const exportToPDF = async (elementRef, fileName = "pdf export") => {
  const element = elementRef?.current;

  if (!element) {
    throw new Error("PDF export failed: graph element not found.");
  }

  const width = element.scrollWidth;
  const height = element.scrollHeight;

  if (!width || !height) {
    throw new Error("PDF export failed: graph has no dimensions.");
  }

  const imageData = await toPng(element, {
    backgroundColor: "white",
    pixelRatio: 2,
    width,
    height,
    cacheBust: true,
  });

  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const margin = 10;
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;

  const scaledHeight = (height * contentWidth) / width;

  let remainingHeight = scaledHeight;
  let page = 0;

  while (remainingHeight > 0) {
    if (page > 0) {
      pdf.addPage();
    }

    pdf.addImage(
      imageData,
      "PNG",
      margin,
      margin - page * contentHeight,
      contentWidth,
      scaledHeight,
      undefined,
      "FAST",
    );

    remainingHeight -= contentHeight;
    page++;
  }

  pdf.save(`${formatFilename(fileName)}.pdf`);
};

const exportToCSV = (data, fileName = "csv export") => {
  if (!Array.isArray(data)) {
    throw new Error("CSV export data must be an array");
  }

  const worksheet = XLSX.utils.aoa_to_sheet(data);

  const csvOutput = XLSX.utils.sheet_to_csv(worksheet, {
    FS: ",",
    RS: "\n",
    blankrows: true,
  });

  const blob = new Blob(["\uFEFF", csvOutput], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `${formatFilename(fileName)}.csv`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const exportToImage = async (graphRef, imageName = "image", type = "png") => {
  const graph = graphRef?.current;

  if (!graph) {
    throw new Error("PDF export failed: graph element not found.");
  }

  const exportImage = IMAGE_EXPORT_TYPE[type];

  const dataUrl = await exportImage(graph, {
    cacheBust: true,
    backgroundColor: "white",
  });

  const link = document.createElement("a");
  link.download = formatFilename(imageName);
  link.href = dataUrl;
  link.click();
};

export { exportToPDF, exportToCSV, exportToImage };
