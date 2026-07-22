import test from "node:test";
import assert from "node:assert/strict";
import { buildQuoteGroups, isPriceableRequirement } from "../src/lib/quote-structure.js";

test("완제품 본체와 행정 요구사항은 가격 검색에서 제외한다",()=>{
  assert.equal(isPriceableRequirement({category:"데스크탑 컴퓨터 본체 사양 1",quantity:4,priceRole:"complete_system"}),false);
  assert.equal(isPriceableRequirement({category:"입찰보증서",quantity:null,priceRole:"non_price"}),false);
  assert.equal(isPriceableRequirement({category:"CPU 사양 1",condition:"Ultra 7 265K",quantity:4,priceRole:"component"}),true);
});

test("여러 본체 사양을 분리하고 전체수량을 1대당 수량으로 환산한다",()=>{
  const groups=buildQuoteGroups([
    {category:"데스크탑 컴퓨터 본체 사양 1",quantity:4,priceRole:"complete_system",specificationGroup:"본체사양 1"},
    {category:"CPU 사양 1",requirement:"Ultra 7",quantity:4,unitQuantity:1,systemQuantity:4,priceRole:"component",specificationGroup:"본체사양 1"},
    {category:"메모리 사양 1",requirement:"32GB",quantity:8,unitQuantity:2,systemQuantity:4,priceRole:"component",specificationGroup:"본체사양 1"},
    {category:"CPU 사양 2",requirement:"Ultra 5",quantity:5,unitQuantity:1,systemQuantity:5,priceRole:"component",specificationGroup:"본체사양 2"},
  ]);
  assert.deepEqual(groups.map(group=>[group.name,group.systemQuantity]),[["본체사양 1",4],["본체사양 2",5]]);
  assert.deepEqual(groups[0].items.map(item=>[item.category,item.unitQuantity]),[["CPU",1],["RAM",2]]);
});

test("SSD의 DRAM과 GPU의 VRAM 문구를 메모리 품목으로 오인하지 않는다",()=>{
  const groups=buildQuoteGroups([
    {category:"SSD 사양 1",requirement:"2TB DRAM 탑재",quantity:4,specificationGroup:"본체사양 1"},
    {category:"GPU 사양 1",requirement:"VRAM 16GB",quantity:4,specificationGroup:"본체사양 1"},
    {category:"메모리 사양 1",requirement:"DDR5 64GB",quantity:8,specificationGroup:"본체사양 1"},
  ]);
  assert.deepEqual(groups[0].items.map(item=>item.category),["M.2","VGA","RAM"]);
});
