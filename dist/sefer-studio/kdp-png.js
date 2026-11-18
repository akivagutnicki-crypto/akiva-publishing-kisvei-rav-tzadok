/* Set physical resolution on browser-generated PNGs without resampling pixels. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.KdpPng=api;})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
  function withDpi(input,dpi){
    const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
    if(!(dpi>0&&dpi<=600)||bytes.length<33||![137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))throw new Error('Invalid PNG or resolution.');
    const chunk=new Uint8Array(21),v=new DataView(chunk.buffer),ppm=Math.round(dpi/0.0254);
    v.setUint32(0,9);chunk.set([112,72,89,115],4);v.setUint32(8,ppm);v.setUint32(12,ppm);chunk[16]=1;v.setUint32(17,crc32(chunk.subarray(4,17)));
    const parts=[bytes.subarray(0,8)];let pos=8,inserted=false,ended=false;
    while(pos+12<=bytes.length){const n=new DataView(bytes.buffer,bytes.byteOffset+pos,4).getUint32(0);if(pos+n+12>bytes.length)throw new Error('Incomplete PNG.');const kind=String.fromCharCode(...bytes.subarray(pos+4,pos+8));if(kind!=='pHYs')parts.push(bytes.subarray(pos,pos+n+12));if(kind==='IHDR'){parts.push(chunk);inserted=true;}pos+=n+12;if(kind==='IEND'){ended=true;break;}}
    if(!inserted||!ended)throw new Error('Incomplete PNG.');const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const p of parts){out.set(p,offset);offset+=p.length;}return out;
  }
  return{withDpi};
});
