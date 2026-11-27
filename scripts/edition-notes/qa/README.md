Quality pass over the Word editions' notes (November 2026), run locally (needs the converter in /home/claude/rdr4,
/home/claude/fin/reader and the Sefaria library in /home/claude/oh): pipeline.sh WORKDIR [review drops] [review fixes].
1 wrong part of the daf quoted -> the segment whose words the passage quotes (Hebrew, English, link; same amud);
2 the neighbouring amud when the cited words stand there; 3 Talmud notes with nothing tying them to the passage dropped;
4 reviewed pasuk/midrash notes that do not belong dropped (nontal_drop.json); 5 doubled notes, Ashkenazi labels, overlong
quotations trimmed; 6 older notes linked to Sefaria; 7 note markers moved to the phrase naming or quoting the source.
