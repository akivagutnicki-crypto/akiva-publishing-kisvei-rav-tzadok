// Match the reader's default edition at the section level. Paragraph numbering
// and even its separator can change when a reviewed study edition is added.
// Combining editions by paragraph reference would count superseded paragraphs
// and could approve a quotation that the default reader never displays.
export function studySections(book) {
  const selected=new Map();
  book.sections.forEach((section,index)=>{
    const previous=selected.get(section.ref);
    if(!previous || Number(Boolean(section.il))>Number(Boolean(previous.section.il))) {
      selected.set(section.ref,{section,index,order:previous?.order ?? index});
    }
  });
  return selected;
}
