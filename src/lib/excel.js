import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const isExcelFile = (filename) => /\.(?:xls|xlsx|xlsm|xlsb)$/i.test(filename || "");
export const pdfNameForExcel = (filename) => String(filename).replace(/\.(?:xls|xlsx|xlsm|xlsb)$/i, "_변환.pdf");

async function defaultConvert(inputPath, outputPath, scriptPath) {
  await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-InputPath", inputPath, "-OutputPath", outputPath], { windowsHide: true, timeout: 240000, maxBuffer: 1024 * 1024 });
}

export async function convertExcelAttachments(files, { scriptPath, convertFile = defaultConvert } = {}) {
  const converted = [];
  const errors = [];
  for (const file of files.filter((item) => isExcelFile(item.filename))) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "withbid-excel-"));
    const normalizedName = String(file.filename).replace(/\\/g, "/");
    const inputPath = path.join(tempDir, path.posix.basename(normalizedName));
    const outputName = path.posix.join(path.posix.dirname(normalizedName), pdfNameForExcel(path.posix.basename(normalizedName)));
    const outputPath = path.join(tempDir, path.basename(outputName));
    try {
      await fs.writeFile(inputPath, file.buffer);
      await convertFile(inputPath, outputPath, scriptPath);
      const buffer = await fs.readFile(outputPath);
      if (buffer.subarray(0, 4).toString() !== "%PDF") throw new Error("변환 결과가 PDF 형식이 아닙니다.");
      converted.push({ filename: outputName, buffer, convertedFrom: file.filename });
    } catch (error) {
      errors.push({ filename: file.filename, error: error.message });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
  return { converted, errors };
}
