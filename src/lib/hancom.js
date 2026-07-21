import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync=promisify(execFile);
const isHancomFile=filename=>/\.(?:hwp|hwpx)$/i.test(filename||"");
export const pdfNameForHancom=filename=>String(filename).replace(/\.(?:hwp|hwpx)$/i,"_변환.pdf");

async function defaultConvert(inputPath,outputPath,scriptPath){
  await execFileAsync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",scriptPath,"-InputPath",inputPath,"-OutputPath",outputPath],{windowsHide:true,timeout:180000,maxBuffer:1024*1024});
}

export async function convertHancomAttachments(files,{scriptPath,convertFile=defaultConvert}={}){
  const converted=[]; const errors=[];
  for(const file of files.filter(item=>isHancomFile(item.filename))){
    const tempDir=await fs.mkdtemp(path.join(os.tmpdir(),"withbid-hancom-"));
    const inputPath=path.join(tempDir,path.basename(file.filename));
    const outputName=pdfNameForHancom(file.filename); const outputPath=path.join(tempDir,outputName);
    try{await fs.writeFile(inputPath,file.buffer);await convertFile(inputPath,outputPath,scriptPath);const buffer=await fs.readFile(outputPath);if(buffer.subarray(0,4).toString()!=="%PDF")throw new Error("변환 결과가 PDF 형식이 아닙니다.");converted.push({filename:outputName,buffer,convertedFrom:file.filename});}
    catch(error){errors.push({filename:file.filename,error:error.message});}
    finally{await fs.rm(tempDir,{recursive:true,force:true});}
  }
  return {converted,errors};
}
