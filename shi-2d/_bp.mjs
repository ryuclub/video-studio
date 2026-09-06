import { createRequire } from 'node:module';
const require = createRequire('E:/ryu/project/vidgen/package.json');
const { Resvg } = require('@resvg/resvg-js');
import fs from 'node:fs';
import { buildFrame } from 'file:///E:/ryu/%E7%9F%B3%E6%80%BB/SVG/%E6%AD%A3%E9%9D%A2new/make/render3.mjs';
const O = process.argv[2];
const C = [[-16,-8],[-22,-10],[-26,-6],[-22,-18],[18,10],[24,12]];
C.forEach(([a,e],i)=>{
  const p = a<0 ? { armL:a, elbowL:e, mouth:'E' } : { armR:a, elbowR:e, mouth:'E' };
  const s = buildFrame(p).replace('<svg ', '<svg width="520" height="705" ');
  fs.writeFileSync(`${O}/b${i}.png`, new Resvg(s,{font:{loadSystemFonts:false},background:'rgba(255,255,255,1)'}).render().asPng());
});
console.log('ok');
