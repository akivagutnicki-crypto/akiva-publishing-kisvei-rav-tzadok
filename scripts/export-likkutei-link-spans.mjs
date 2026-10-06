// Plain-text positions let the Word editor add real external hyperlinks while
// keeping the user's existing run formatting and paragraph boundaries intact.
import fs from 'node:fs';
import { linkLikkuteiCitations } from './likkutei-citations.mjs';
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const decode = s => s.replace(/&quot;/g,'"').replace(/&#x27;|&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const output = input.map(({id, text}) => {
  const html = linkLikkuteiCitations(esc(text));
  let at=0, open=null;
  const links=[];
  for(const part of html.split(/(<[^>]+>)/)) {
    if(part.startsWith('<')) {
      const m=/^<a data-ref="([^"]+)">$/.exec(part);
      if(m) { if(open) throw Error('Nested link'); open={start:at,ref:decode(m[1])}; }
      else if(part==='</a>') { if(!open) throw Error('Unmatched link'); links.push({...open,end:at}); open=null; }
    } else at+=decode(part).length;
  }
  if(open || at!==text.length) throw Error('Text changed while linking '+id);
  return {id,links};
});
fs.writeFileSync(process.argv[3],JSON.stringify(output));
