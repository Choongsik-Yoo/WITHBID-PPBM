import test from "node:test"; import assert from "node:assert/strict"; import { redactSettings,responseText } from "../src/lib/openai.js";
test("API 키를 노출하지 않는다",()=>{const v=redactSettings({apiKey:"sk-proj-abcdefghijklmnop"});assert.equal(v.configured,true);assert.equal("apiKey" in v,false);});
test("Responses 응답 텍스트를 읽는다",()=>assert.equal(responseText({output:[{content:[{type:"output_text",text:"{}"}]}]}),"{}"));
